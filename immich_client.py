#!/usr/bin/env python3
"""
Zentrix Homelab Dashboard — Immich background client
====================================================
Optional module: fetches a random photo from an Immich album to serve as the
dashboard background. Stdlib only. All Immich credentials stay inside the
server process — the browser only ever talks to zentrix-server.

Config precedence (first non-empty wins):
  1. GUI configuration   (data file immich.json, written via PUT /api/immich/config)
  2. Environment         IMMICH_URL / IMMICH_API_KEY / IMMICH_ALBUM / IMMICH_INTERVAL
  3. Secret files        IMMICH_URL_FILE / IMMICH_API_KEY_FILE / IMMICH_ALBUM_FILE

Rotation: shuffle-bag — every photo of the album exactly once per cycle,
recently shown photos cannot reappear at the start of the next cycle.
"""
import json
import os
import random
import unicodedata
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ZENTRIX_DATA_FILE", str(BASE_DIR / "links.json"))).parent
STATE_FILE = DATA_DIR / "immich-state.json"     # shuffle-bag persistence
CONFIG_FILE = DATA_DIR / "immich.json"          # GUI-written config

MIN_INTERVAL = 60            # seconds
DEFAULT_INTERVAL = 3600      # 1 h
HTTP_TIMEOUT = 10


# ------------------------------------------------------------------ config
def _read_secret_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _load_gui_config() -> dict:
    try:
        cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if isinstance(cfg, dict):
            return cfg
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def get_config() -> dict:
    """Effective config: GUI > env > secret files. Never exposes the key."""
    gui = _load_gui_config()
    url = (gui.get("url") or os.environ.get("IMMICH_URL", "")
           or _read_secret_file(os.environ.get("IMMICH_URL_FILE", ""))).strip().rstrip("/")
    key = (gui.get("key") or os.environ.get("IMMICH_API_KEY", "")
           or _read_secret_file(os.environ.get("IMMICH_API_KEY_FILE", ""))).strip()
    album = (gui.get("album") or os.environ.get("IMMICH_ALBUM", "")
             or _read_secret_file(os.environ.get("IMMICH_ALBUM_FILE", ""))).strip()
    try:
        interval = int(gui.get("interval") or os.environ.get("IMMICH_INTERVAL") or DEFAULT_INTERVAL)
    except (TypeError, ValueError):
        interval = DEFAULT_INTERVAL
    interval = max(MIN_INTERVAL, min(interval, 86400 * 7))
    return {"url": url, "key": key, "album": album, "interval": interval}


def save_gui_config(cfg: dict) -> bool:
    """Persist GUI config (key write-only: empty key keeps the stored one)."""
    if not isinstance(cfg, dict):
        return False
    current = _load_gui_config()
    # partial update semantics: empty fields keep their stored values
    # (key is always write-only: empty = keep existing)
    url_in = str(cfg.get("url", "")).strip().rstrip("/")
    album_in = str(cfg.get("album", "")).strip()
    merged = {
        "url": url_in or current.get("url", ""),
        "album": album_in or current.get("album", ""),
        "interval": cfg.get("interval", current.get("interval", DEFAULT_INTERVAL)),
    }
    new_key = str(cfg.get("key", "")).strip()
    if new_key:
        merged["key"] = new_key
    elif "key" in current:
        merged["key"] = current["key"]
    # validate interval type
    try:
        merged["interval"] = int(merged["interval"])
    except (TypeError, ValueError):
        merged["interval"] = DEFAULT_INTERVAL
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = __import__("tempfile").mkstemp(dir=str(DATA_DIR), prefix=".immich-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=1)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, CONFIG_FILE)
        return True
    except OSError:
        return False


def masked_config(cfg: dict | None = None) -> dict:
    """Config as seen by the GUI — the API key is never sent back."""
    cfg = cfg or get_config()
    key = cfg.get("key", "")
    return {
        "url": cfg.get("url", ""),
        "album": cfg.get("album", ""),
        "interval": cfg.get("interval", DEFAULT_INTERVAL),
        "key_set": bool(key),
        "key_hint": ("••••" + key[-4:]) if len(key) >= 8 else ("••••" if key else ""),
        "configured": bool(cfg.get("url") and cfg.get("key") and cfg.get("album")),
    }


# ------------------------------------------------------------------ bag
class ShuffleBag:
    """Every photo exactly once per cycle; the last k=n/4 photos shown cannot
    reappear in the first n/4 draws of the next cycle (no fast repeats)."""
    def __init__(self, n: int, seed=None):
        self.n = n
        self.rng = random.Random(seed)
        self.bag = []
        self.recent = deque(maxlen=max(2, n // 4))

    def next_index(self) -> int:
        n = self.n
        if not self.bag:
            k = max(2, n // 4) if n >= 8 else max(1, n // 2)
            k = min(k, n - 1) if n > 1 else 1
            avoid = set(self.recent)
            if n <= 200:
                bag = None
                for _ in range(80):
                    cand = list(range(n))
                    self.rng.shuffle(cand)
                    if cand[-1] not in avoid and all(c not in avoid for c in cand[n - k:]):
                        bag = cand
                        break
                if bag is None:
                    cand = list(range(n))
                    self.rng.shuffle(cand)
                    for idx in range(n - k, n):
                        if cand[idx] in avoid:
                            opts = [j for j in range(n - k) if cand[j] not in avoid]
                            if opts:
                                j = self.rng.choice(opts)
                                cand[idx], cand[j] = cand[j], cand[idx]
                    bag = cand
            else:
                # deterministic construction: head (first k draws) avoids recent
                others = [x for x in range(n) if x not in avoid]
                self.rng.shuffle(others)
                avoid_list = list(avoid)
                self.rng.shuffle(avoid_list)
                head = others[:k]
                rest = others[k:] + avoid_list
                self.rng.shuffle(rest)
                bag = (head + rest)[::-1]      # pop() takes from the end
            self.bag = bag
        picked = self.bag.pop()
        self.recent.append(picked)
        return picked

    def to_json(self) -> dict:
        return {"bag": self.bag, "recent": list(self.recent)}


# ------------------------------------------------------------------ state
class ImmichState:
    def __init__(self):
        self.lock = threading.Lock()
        self._rotating = False
        self.ids = []                  # album asset ids (list)
        self.bag = None                # ShuffleBag over ids
        self.pos = {}                  # id → index for bag continuity
        self.photo_bytes = b""
        self.etag = "0"                # changes whenever the photo changes
        self.fetched_at = 0.0
        self.last_error = ""
        self.album_id = ""
        self.albums_resolved_at = 0.0
        self.album_cache = {}          # name → id
        self.current_id = ""
        self._load()

    # -- persistence --
    def _load(self):
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            self.ids = data.get("ids", [])
            bag = data.get("bag", [])
            self.bag = ShuffleBag(len(self.ids))
            self.bag.bag = [i for i in bag if isinstance(i, int) and 0 <= i < len(self.ids)]
            self.bag.recent = deque(data.get("recent", []), maxlen=max(2, len(self.ids) // 4))
            self.etag = str(data.get("etag", "0"))
            self.current_id = data.get("current_id", "")
        except (OSError, json.JSONDecodeError, ValueError):
            pass

    def _save(self):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            payload = {"ids": self.ids, "etag": self.etag,
                       "current_id": self.current_id, **(self.bag.to_json() if self.bag else {})}
            import tempfile
            fd, tmp = tempfile.mkstemp(dir=str(DATA_DIR), prefix=".immichstate-", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f)
            os.replace(tmp, STATE_FILE)
        except OSError:
            pass

    # -- immich api --
    def _api(self, cfg, path, method="GET", body=None, raw=False):
        req = urllib.request.Request(cfg["url"] + path, method=method)
        req.add_header("x-api-key", cfg["key"])
        req.add_header("Accept", "application/json")
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, data=data, timeout=HTTP_TIMEOUT) as resp:
            payload = resp.read()
            return payload if raw else json.loads(payload.decode("utf-8"))

    @staticmethod
    def _norm(s: str) -> str:
        """Tolerant album-name matching: NFKC + casefold (umlauts, spaces, casing)."""
        return unicodedata.normalize("NFKC", s or "").casefold().strip()

    def _resolve_album(self, cfg, force=False):
        """Album name → id (cached 10 min). Handles names with spaces, umlauts,
        special characters via NFKC+casefold matching; exact match wins."""
        if not force and self.album_cache and time.time() - self.albums_resolved_at < 600:
            return self.album_cache.get(cfg["album"], "")
        albums = self._api(cfg, "/api/albums")
        self.album_cache = {a.get("albumName", ""): a.get("id", "") for a in albums}
        self.albums_resolved_at = time.time()
        if cfg["album"] in self.album_cache:
            return self.album_cache[cfg["album"]]
        # tolerant fallback: normalized comparison
        want = self._norm(cfg["album"])
        for name, aid in self.album_cache.items():
            if self._norm(name) == want:
                return aid
        return ""

    def _load_album_ids(self, cfg, album_id):
        ids = []
        body = {"albumIds": [album_id], "type": "IMAGE", "size": 1000, "page": 1}
        while True:
            page = self._api(cfg, "/api/search/metadata", method="POST", body=body)
            items = (page.get("assets") or {}).get("items") or []
            ids.extend(a.get("id", "") for a in items if a.get("id"))
            nc = (page.get("assets") or {}).get("nextCursor") or (page.get("assets") or {}).get("nextPage")
            if not nc:
                break
            body["cursor"] = nc if isinstance(nc, str) else None
            body["page"] = body["page"] + 1 if not isinstance(nc, str) else body["page"]
            if not isinstance(nc, str) and not items:
                break
        return ids

    def _fetch_photo(self, cfg, asset_id) -> bytes:
        return self._api(cfg, f"/api/assets/{asset_id}/thumbnail?size=preview", raw=True)

    # -- rotation --
    def reset_runtime(self):
        """Config changed: drop cached album/photo state so the next fetch re-resolves.
        In-flight rotations keep their own local cfg snapshot and finish safely."""
        with self.lock:
            self.albums_resolved_at = 0.0
            self.album_cache = {}
            self.album_id = ""
            self.ids = []
            self.fetched_at = 0.0

    def rotate_if_due(self):
        """Called by the HTTP handlers; returns (bytes, etag, meta). Thread-safe."""
        cfg = get_config()
        with self.lock:
            now = time.time()
            due = (now - self.fetched_at) >= cfg["interval"] or not self.photo_bytes
            if not cfg["url"] or not cfg["key"] or not cfg["album"]:
                self.last_error = "not_configured"
                return b"", self.etag, {"configured": False}
            if not due:
                return self.photo_bytes, self.etag, {"configured": True, "current": self.current_id}
            try:
                album_id = self._resolve_album(cfg)
                if not album_id:
                    self.last_error = "album_not_found"
                    return self.photo_bytes or b"", self.etag, {"error": self.last_error}
                if album_id != self.album_id or not self.ids:
                    ids = self._load_album_ids(cfg, album_id)
                    if not ids:
                        self.last_error = "album_empty"
                        return self.photo_bytes or b"", self.etag, {"error": self.last_error}
                    # album changed: new bag (fresh cycle)
                    if album_id != self.album_id:
                        self.ids = ids
                        self.bag = ShuffleBag(len(ids))
                    else:
                        # refresh ids, drop vanished, keep bag position roughly
                        known = set(self.ids)
                        added = [i for i in ids if i not in known]
                        self.ids = [i for i in ids]
                        if added and self.bag:
                            self.bag = ShuffleBag(len(self.ids))
                    self.album_id = album_id
                if not self.bag or self.bag.n != len(self.ids):
                    self.bag = ShuffleBag(len(self.ids))
                idx = self.bag.next_index()
                asset_id = self.ids[idx]
                self.photo_bytes = self._fetch_photo(cfg, asset_id)
                self.current_id = asset_id
                self.fetched_at = now
                self.etag = str(int(now))
                self.last_error = ""
                self._save()
                return self.photo_bytes, self.etag, {"configured": True, "current": asset_id}
            except Exception as e:  # noqa: BLE001 — keep the dashboard alive
                self.last_error = str(e)[:200]
                return self.photo_bytes or b"", self.etag, {"error": self.last_error}

    def probe(self, cfg):
        """GUI test button: verify url/key/album without changing state."""
        try:
            albums = self._api(cfg, "/api/albums")
            names = {a.get("albumName", ""): a.get("id", "") for a in albums}
            album_id = names.get(cfg["album"], "")
            if not album_id:
                want = self._norm(cfg["album"])
                for name, aid in names.items():
                    if self._norm(name) == want:
                        album_id = aid
                        break
            if not album_id:
                return {"ok": False, "error": "album_not_found",
                        "albums": sorted(n for n in names if n)[:30]}
            ids = self._load_album_ids(cfg, album_id)
            return {"ok": True, "album_id": album_id, "photos": len(ids)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)[:200]}


STATE = ImmichState()
