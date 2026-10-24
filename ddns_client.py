#!/usr/bin/env python3
"""
Zentrix Homelab Dashboard — DDNS (Dynamic DNS) background client
================================================================
Optional module: keeps a public DNS A record in sync with the current
dynamic public IP. Stdlib only. All DDNS credentials stay inside the
server process — the browser only ever talks to zentrix-server.

Config precedence (first non-empty wins):
  1. GUI configuration   (data file ddns.json, written via PUT /api/ddns/config)
  2. Environment         DDNS_UPDATE_URL / DDNS_HOST / DDNS_USER / DDNS_PASSWORD
  3. Secret files        DDNS_UPDATE_URL_FILE / DDNS_HOST_FILE / DDNS_USER_FILE
                         / DDNS_PASSWORD_FILE

Update URL placeholders: {ip} {host} {user} {pass}
If the URL contains no {user}/{pass}, credentials are sent as HTTP Basic auth.

Semantics (Martin, 10/2026):
  - Prüfintervall (check_s): Takt für den Vergleich  DNS-A-Record  ↔  öffentliche IP
  - Updateintervall (update_min_s): Mindestabstand zwischen zwei Update-Aufrufen
    (Rate-Limit gegen IP-Flapping und Provider-Sperren) — KEIN Keepalive:
    Updates werden nur bei Abweichung gesendet.
  - Backoff: 3 Fehler in Folge → 5 Minuten Pause (Provider sperren bei Abuse).

DynDNS protocol responses: "good <ip>" / "nochg <ip>" = Erfolg;
"badauth", "notfqdn", "abuse", "badagent", "dnserr" = Fehler mit Klartext.
"""
import base64
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ZENTRIX_DATA_FILE", str(BASE_DIR / "links.json"))).parent
CONFIG_FILE = DATA_DIR / "ddns.json"            # GUI-written config

MIN_CHECK_S = 60                # Prüfintervall: mindestens 1 Minute
DEFAULT_CHECK_S = 300           # Default: alle 5 Minuten prüfen
MIN_UPDATE_SPACING_S = 60      # Mindestabstand zwischen zwei Updates
DEFAULT_UPDATE_SPACING_S = 300
HTTP_TIMEOUT = 10
FAILURE_PAUSE_S = 300           # Backoff nach 3 Fehlern
PUBLIC_IP_DEFAULT = "http://checkip.dyndns.org/"

_RESULT_OK = ("good", "nochg")


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
    """Effective config: GUI > env > secret files. Never exposes the password."""
    gui = _load_gui_config()
    update_url = (gui.get("update_url") or os.environ.get("DDNS_UPDATE_URL", "")
                  or _read_secret_file(os.environ.get("DDNS_UPDATE_URL_FILE", ""))).strip()
    host = (gui.get("host") or os.environ.get("DDNS_HOST", "")
            or _read_secret_file(os.environ.get("DDNS_HOST_FILE", ""))).strip()
    user = (gui.get("user") or os.environ.get("DDNS_USER", "")
            or _read_secret_file(os.environ.get("DDNS_USER_FILE", ""))).strip()
    password = (gui.get("password") or os.environ.get("DDNS_PASSWORD", "")
                or _read_secret_file(os.environ.get("DDNS_PASSWORD_FILE", ""))).strip()
    ip_host = (gui.get("ip_host") or "").strip()
    if not ip_host:
        # leer = Dashboard-Default (öffentliche IP wie im Gateway-Dashboard)
        try:
            from sources_config import get_public_ip_url
            ip_host = get_public_ip_url() or PUBLIC_IP_DEFAULT
        except Exception:
            ip_host = PUBLIC_IP_DEFAULT
    def _iv(key, env, default, minimum):
        raw = gui.get(key) or os.environ.get(env) or default
        try:
            return max(minimum, int(raw))
        except (TypeError, ValueError):
            return default
    check_s = _iv("check_s", "DDNS_CHECK_S", DEFAULT_CHECK_S, MIN_CHECK_S)
    update_min_s = _iv("update_s", "DDNS_UPDATE_S", DEFAULT_UPDATE_SPACING_S, MIN_UPDATE_SPACING_S)
    enabled = bool(gui.get("enabled", False)) if gui.get("enabled") is not None \
        else bool(os.environ.get("DDNS_ENABLED", "").strip().lower() in ("1", "true", "yes"))
    complete = bool(update_url and host and user and password)
    return {"enabled": enabled, "update_url": update_url, "host": host, "user": user,
            "password": password, "ip_host": ip_host, "check_s": check_s,
            "update_s": update_min_s, "complete": complete,
            "password_set": bool(password)}


def public_state() -> dict:
    """GUI-safe view: no secret values, only flags (spec A2)."""
    c = get_config()
    c.pop("password", None)
    return c


def save_gui_config(patch: dict) -> bool:
    """Persist GUI config (password write-only: empty keeps the stored one)."""
    if not isinstance(patch, dict):
        return False
    current = _load_gui_config()
    for k in ("enabled", "update_url", "host", "user", "ip_host", "check_s", "update_s"):
        if k in patch:
            current[k] = patch[k]
    pw = str(patch.get("password", "") or "").strip()
    if pw:
        current["password"] = pw           # write-only: nur setzen, nie leeren
    elif "password" in current and patch.get("password", "") == "":
        pass                                 # leeres Feld = altes Passwort behalten
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
        return True
    except OSError:
        return False


class DDNSClient:
    """Background thread: prüft A-Record ↔ öffentliche IP und sendet Updates."""

    def __init__(self):
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.state = {
            "running": False, "last_check": None, "last_ip": None,
            "dns_ip": None, "last_update": None, "last_result": None,
            "last_result_text": "", "errors": 0, "paused_until": None,
        }
        # überladbar für Tests
        self._resolver = self._resolve_via_system
        self._ip_fetcher = self._public_ip_http

    # -- I/O (testbar) -----------------------------------------------------
    @staticmethod
    def _resolve_via_system(host):
        """A-Record per System-DNS auflösen (stdlib)."""
        try:
            return socket.gethostbyname(host)
        except OSError:
            return None

    @staticmethod
    def _public_ip_http(ip_host):
        """Öffentliche IP via Echo-Dienst (gleiche Technik wie das Dashboard)."""
        try:
            with urllib.request.urlopen(ip_host, timeout=HTTP_TIMEOUT) as resp:
                text = resp.read(512).decode("utf-8", "replace")
            m = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", text)
            return m.group(1) if m else None
        except Exception:
            return None

    # -- update ------------------------------------------------------------
    def _send_update(self, cfg, ip):
        """Update-URL rufen. {user}:{pass}@ im URL wird in Basic-Auth übersetzt
        (urllib unterstützt keine userinfo-URLs); übrige Platzhalter ersetzt."""
        url = cfg["update_url"]
        url = re.sub(r"\{user\}(?::\{pass\})?@", "", url)   # user:pass@ → Basic-Auth
        url = url.replace("{ip}", ip).replace("{host}", cfg["host"])
        url = url.replace("{user}", urllib.parse.quote(cfg["user"], safe=""))
        url = url.replace("{pass}", urllib.parse.quote(cfg["password"], safe=""))
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "Zentrix-Homelab-Dashboard/1.12")
        if cfg["user"]:
            token = base64.b64encode(
                f"{cfg['user']}:{cfg['password']}".encode()).decode()
            req.add_header("Authorization", "Basic " + token)
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                body = resp.read(512).decode("utf-8", "replace").strip()
                status = resp.status
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read(256).decode("utf-8", "replace").strip()
            except Exception:
                pass
            status = e.code
        except (urllib.error.URLError, TimeoutError, OSError):
            return None, "unreachable", "update host not reachable"
        text = body.splitlines()[0].strip() if body else ""
        low = text.lower()
        if status == 200 and any(low.startswith(k) for k in _RESULT_OK):
            return True, "good" if low.startswith("good") else "nochg", text
        for code in ("badauth", "notfqdn", "abuse", "badagent", "dnserr"):
            if low.startswith(code):
                return False, code, text
        if status in (200, 201, 204) and status == 200 and not text:
            return True, "ok-empty", ""          # manche APIs antworten leer
        if status in (200, 201, 204):
            return True, f"http{status}", text    # nicht-DynDNS-API: HTTP-Erfolg
        return False, f"http{status}", text or f"HTTP {status}"

    # -- core loop ----------------------------------------------------------
    def check_once(self, force=False):
        """Ein Prüfzyklus. force=True überspringt das Update-Rate-Limit."""
        cfg = get_config()
        now = time.time()
        with self._lock:
            if not cfg["enabled"]:
                self.state["last_result_text"] = "disabled"
                return {"ok": False, "reason": "disabled"}
            if self.state.get("paused_until") and now < self.state["paused_until"]:
                return {"ok": False, "reason": "backoff"}
        ip = self._ip_fetcher(cfg["ip_host"])
        dns_ip = self._resolver(cfg["host"])
        with self._lock:
            self.state["last_check"] = int(now)
            self.state["last_ip"] = ip
            self.state["dns_ip"] = dns_ip
        if not ip:
            with self._lock:
                self._fail("public IP unknown")
            return {"ok": False, "reason": "no-ip"}
        if not dns_ip:
            with self._lock:
                self._fail("A record not resolvable")
            return {"ok": False, "reason": "no-dns"}
        if ip == dns_ip:
            with self._lock:
                self.state["errors"] = 0
                self.state["last_result"] = "match"
                self.state["last_result_text"] = "match"
            return {"ok": True, "reason": "match", "ip": ip, "dns_ip": dns_ip}
        # Abweichung → Update (Rate-Limit)
        last_update = self.state.get("last_update") or 0
        if not force and now - last_update < cfg["update_s"]:
            with self._lock:
                self.state["last_result"] = "rate-limit"
                self.state["last_result_text"] = "rate-limit"
            return {"ok": True, "reason": "rate-limit", "ip": ip, "dns_ip": dns_ip}
        ok, code, text = self._send_update(cfg, ip)
        with self._lock:
            self.state["last_update"] = int(now)
            self.state["last_result"] = code
            self.state["last_result_text"] = text
            if ok:
                self.state["errors"] = 0
                self.state["paused_until"] = None
            else:
                self._fail(text or code)
        return {"ok": ok, "reason": code, "ip": ip, "dns_ip": dns_ip, "text": text}

    def _fail(self, why):
        self.state["errors"] = int(self.state.get("errors") or 0) + 1
        self.state["last_result_text"] = str(why)[:120]
        if self.state["errors"] >= 3:
            self.state["paused_until"] = time.time() + FAILURE_PAUSE_S
            self.state["errors"] = 0

    def run(self):
        while not self._stop.wait(5):
            try:
                cfg = get_config()
                if not cfg["enabled"]:
                    continue
                last = self.state.get("last_check") or 0
                if time.time() - last >= cfg["check_s"]:
                    self.check_once()
            except Exception:
                pass                     # Loop stirbt nie (Pattern: Registry)

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self.state["running"] = True
        self._thread = threading.Thread(target=self.run, daemon=True,
                                        name="zentrix-ddns")
        self._thread.start()

    def stop(self):
        self._stop.set()


STATE = DDNSClient()          # shared instance (Pattern: REGISTRY/ImmichState)
