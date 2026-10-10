"""Zentrix sources config — sources.json management (spec §8).

Precedence: GUI (sources.json) > ENV > defaults. Secrets write-only:
config files/GET responses never contain secret values, only "secret_set": true.
ENV fallbacks: OPNSENSE_URL, OPNSENSE_API_KEY, OPNSENSE_API_SECRET,
FRITZBOX_URL, FRITZBOX_USER, FRITZBOX_PASSWORD (+ *_FILE for docker secrets).
"""
import json
import os
from pathlib import Path

DEFAULTS = {
    "opnsense": {"enabled": False, "url": "", "poll_s": 300,
                 "areas": [], "key_set": False, "secret_set": False},
    "tr064": {"enabled": False, "url": "", "user": "", "poll_s": 300,
              "password_set": False},
    "mdns": {"enabled": False, "poll_s": 300},
}


def _read_secret(env_name: str) -> str:
    """ENV value, or contents of <name>_FILE (docker secret pattern)."""
    v = os.environ.get(env_name, "").strip()
    if v:
        return v
    fp = os.environ.get(env_name + "_FILE", "").strip()
    if fp:
        try:
            return Path(fp).read_text().strip()
        except OSError:
            return ""
    return ""


class SourcesConfig:
    def __init__(self, config_file: Path):
        self.config_file = Path(config_file)
        self._lock = __import__("threading").Lock()
        self._secrets = {}   # source_id -> dict of secret values (never persisted in clear form is ok:
                             # the FILE lives in the data volume like immich.json with the immich key)
        self.state = self._load()

    # -- persistence ------------------------------------------------------
    def _load(self) -> dict:
        state = {k: dict(v) for k, v in DEFAULTS.items()}
        try:
            raw = json.loads(self.config_file.read_text(encoding="utf-8"))
            for src, cfg in (raw or {}).items():
                if src in state and isinstance(cfg, dict):
                    state[src].update({k: v for k, v in cfg.items() if k in state[src]})
        except (OSError, json.JSONDecodeError, ValueError):
            pass
        # ENV fallback (GUI explicitly saved empty values win over ENV)
        if not state["opnsense"].get("url"):
            state["opnsense"]["url"] = os.environ.get("OPNSENSE_URL", "").strip()
        if not state["tr064"].get("url"):
            state["tr064"]["url"] = os.environ.get("FRITZBOX_URL", "").strip()
        if not state["tr064"].get("user"):
            state["tr064"]["user"] = os.environ.get("FRITZBOX_USER", "").strip()
        self._reload_secrets(state)
        return state

    def _reload_secrets(self, state: dict):
        """Load secret values from ENV/FILE or from the config file (stored masked-free)."""
        opn_key = _read_secret("OPNSENSE_API_KEY")
        opn_secret = _read_secret("OPNSENSE_API_SECRET")
        fb_pw = _read_secret("FRITZBOX_PASSWORD")
        # secrets may also live inside sources.json (data volume, like immich.json)
        try:
            raw = json.loads(self.config_file.read_text(encoding="utf-8")) or {}
        except (OSError, json.JSONDecodeError, ValueError):
            raw = {}
        if not opn_key:
            opn_key = raw.get("opnsense", {}).get("key", "")
        if not opn_secret:
            opn_secret = raw.get("opnsense", {}).get("secret", "")
        if not fb_pw:
            fb_pw = raw.get("tr064", {}).get("password", "")
        self._secrets["opnsense"] = {"key": opn_key, "secret": opn_secret}
        self._secrets["tr064"] = {"password": fb_pw}
        state["opnsense"]["key_set"] = bool(opn_key)
        state["opnsense"]["secret_set"] = bool(opn_secret)
        state["tr064"]["password_set"] = bool(fb_pw)

    # -- public ------------------------------------------------------------
    def public_state(self) -> dict:
        """GUI-safe view: no secret values, only *_set flags (spec A2)."""
        with self._lock:
            out = {k: dict(v) for k, v in self.state.items()}
        for src in out:
            for k in list(out[src]):
                if k in ("key", "secret", "password"):
                    del out[src][k]
        return out

    def update_from_gui(self, patch: dict) -> None:
        """Token-protected GUI update. Merge semantics like immich config:
        omitted fields keep their value; empty secret field keeps old secret."""
        with self._lock:
            st = self.state
            for src, vals in (patch or {}).items():
                if src not in st or not isinstance(vals, dict):
                    continue
                secret_fields = {"opnsense": {"key", "secret"}, "tr064": {"password"}}.get(src, set())
                for k, v in vals.items():
                    if k in secret_fields:
                        continue  # secrets handled below
                    if k in st[src]:
                        st[src][k] = v
                # safety: a source without URL can never be enabled
                if src in ("opnsense", "tr064") and not str(st[src].get("url", "")).strip():
                    st[src]["enabled"] = False
                if src not in self._secrets:
                    self._secrets[src] = {}
                for k in secret_fields:
                    v = str(vals.get(k, "") or "").strip()
                    if v:                      # write-only: only set, never cleared by empty
                        self._secrets[src][k] = v
            # persist
            self._save()
            self._reload_secrets(st)

    def _save(self) -> None:
        """Atomic write including secret values (file lives in the data volume)."""
        blob = {}
        for src, cfg in self.state.items():
            entry = {k: v for k, v in cfg.items() if not k.endswith("_set")}
            entry.update(self._secrets.get(src, {}))
            blob[src] = entry
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = None, None
        try:
            import tempfile
            fd, tmp = tempfile.mkstemp(dir=str(self.config_file.parent),
                                       prefix=".sources-", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(blob, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.config_file)
        except OSError:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    def secret(self, source_id: str, field_name: str) -> str:
        with self._lock:
            return self._secrets.get(source_id, {}).get(field_name, "")

    def get(self, source_id: str) -> dict:
        with self._lock:
            return dict(self.state.get(source_id, {}))


# ---------------------------------------------------------------- shared instance
# Config file lives in the data volume (like immich.json); env ZENTRIX_SOURCES_FILE
# overrides for container deployments.
import pathlib as _pl

def _default_sources_path() -> _pl.Path:
    env = os.environ.get("ZENTRIX_SOURCES_FILE", "").strip()
    if env:
        return _pl.Path(env)
    data_file = os.environ.get("ZENTRIX_DATA_FILE", "").strip()
    if data_file:
        return _pl.Path(data_file).parent / "sources.json"
    return _pl.Path(__file__).resolve().parent / "sources.json"

SOURCES_CONFIG = SourcesConfig(_default_sources_path())
