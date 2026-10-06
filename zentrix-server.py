#!/usr/bin/env python3
"""
Zentrix Homelab Dashboard — Server
==================================
Zero-dependency HTTP backend (Python stdlib only) for the Zentrix dashboard.

Endpoints:
  GET  /                → index.html
  GET  /api/links       → links JSON (from data file)
  PUT  /api/links       → save links JSON (requires X-Auth-Token header)
  GET  /api/health      → {"status":"ok"}

Auth: bearer token in X-Auth-Token header. Token is set via
  - environment variable  ZENTRIX_TOKEN, or
  - file                  token.txt next to this script (first line)
If neither exists, a random token is generated on first start and written
to token.txt (chmod 600) — print the token once at startup.

Data:   links.json next to this script (atomic write via temp file + rename).
        If missing or corrupt, an empty structure is served (no data embedded
        in code — the client shows an empty state).

Security:
  - Binds to 0.0.0.0:8080 by default (override: ZENTRIX_PORT / ZENTRIX_BIND).
    Put it behind your reverse proxy (nginx/OPNsense/Caddy) for TLS.
  - No HTML parsing, no template injection: index.html served as static bytes.
  - PUT body limited to 512 KB and must parse as JSON with the expected shape.
  - Write token compared with hmac.compare_digest (timing-safe).
  - Security headers set on every response (CSP, X-Frame-Options, ...).
  - No write access beyond links.json; server never executes user content.

Run:    python3 zentrix-server.py
        (or: ZENTRIX_TOKEN="my-secret" ZENTRIX_PORT=8080 python3 zentrix-server.py)
"""
import json
import hmac
import os
import secrets
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# localized error messages (24 languages)
try:
    from server_i18n import MESSAGES as LANG_MESSAGES
except ImportError:
    LANG_MESSAGES = {}
DEFAULT_LANG = "de"

BASE_DIR = Path(__file__).resolve().parent
# Overrides for container deployments (Docker/Kubernetes): keep state on a volume
# and the token in a secret, e.g.
#   ZENTRIX_DATA_FILE=/data/links.json  ZENTRIX_TOKEN_FILE=/run/secrets/zentrix_token
DATA_FILE = Path(os.environ.get("ZENTRIX_DATA_FILE", str(BASE_DIR / "links.json")))
INDEX_FILE = BASE_DIR / "index.html"
TOKEN_FILE = Path(os.environ.get("ZENTRIX_TOKEN_FILE", str(BASE_DIR / "token.txt")))

MAX_BODY = 512 * 1024  # 512 KB

# ---------------------------------------------------------------- token
def load_token() -> str:
    env = os.environ.get("ZENTRIX_TOKEN", "").strip()
    if env:
        return env
    if TOKEN_FILE.exists():
        tok = TOKEN_FILE.read_text().strip().splitlines()
        if tok and tok[0]:
            return tok[0]
    tok = secrets.token_urlsafe(32)
    try:
        TOKEN_FILE.write_text(tok + "\n")
        try:
            TOKEN_FILE.chmod(0o600)
        except OSError:
            pass
    except OSError:
        # e.g. read-only filesystem or unwritable secrets dir in containers —
        # fall back to the legacy location next to this script
        fallback = BASE_DIR / "token.txt"
        try:
            fallback.write_text(tok + "\n")
            fallback.chmod(0o600)
            print(f"[zentrix] {TOKEN_FILE} not writable — token saved to {fallback.name}", file=sys.stderr)
        except OSError:
            print("[zentrix] could not persist token anywhere — using ephemeral in-memory token "
                  "(set ZENTRIX_TOKEN to avoid this)", file=sys.stderr)
    print(f"[zentrix] generated write token (saved to {TOKEN_FILE.name}):\n")
    print(f"  {tok}\n")
    return tok

TOKEN = load_token()

# ---------------------------------------------------------------- data io
def load_data() -> dict:
    if DATA_FILE.exists():
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            if validate_shape(data):
                return data
            print("[zentrix] links.json has wrong shape — serving empty structure", file=sys.stderr)
        except (json.JSONDecodeError, OSError) as e:
            print(f"[zentrix] links.json unreadable ({e}) — serving empty structure", file=sys.stderr)
    return {"groups": []}

def validate_shape(data) -> bool:
    """Groups: list of {id:str, name:str, links:[{name:str, url:str, icon:str|null}]}"""
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        return False
    for g in data["groups"]:
        if not isinstance(g, dict) or not isinstance(g.get("name"), str):
            return False
        if not isinstance(g.get("links"), list):
            return False
        for l in g["links"]:
            if not isinstance(l, dict) or not isinstance(l.get("name"), str) or not isinstance(l.get("url"), str):
                return False
            if "icon" in l and not (l["icon"] is None or isinstance(l["icon"], str)):
                return False
    return True

def save_data(data: dict) -> bool:
    if not validate_shape(data):
        return False
    # atomic write: temp file in the SAME directory as the data file —
    # rename(2) is only atomic within one filesystem, and BASE_DIR may be a
    # read-only image layer in container deployments while the data file
    # lives on a writable volume (ZENTRIX_DATA_FILE).
    data_dir = DATA_FILE.parent
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    try:
        fd, tmp = tempfile.mkstemp(dir=str(data_dir), prefix=".links-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, DATA_FILE)
        return True
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False

# ---------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):

    # --- localized error messages ---
    def _lang(self):
        """Client language: ?lang= query param first, then Accept-Language, then default."""
        try:
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            lang = (qs.get("lang", [""])[0] or "").lower()
            if lang in LANG_MESSAGES:
                return lang
            base = lang.split("-")[0]
            if base in LANG_MESSAGES:
                return base
        except Exception:
            pass
        al = (self.headers.get("Accept-Language", "") or "").lower()
        for part in al.split(","):
            code = part.split(";")[0].strip()
            if code in LANG_MESSAGES:
                return code
            base = code.split("-")[0]
            if base in LANG_MESSAGES:
                return base
        return DEFAULT_LANG

    def _msg(self, key, **vars):
        """Localized error message with {var} substitution; falls back to German."""
        lang = self._lang()
        table = LANG_MESSAGES.get(lang) or LANG_MESSAGES.get(DEFAULT_LANG) or {}
        text = table.get(key) or key
        for k, v in vars.items():
            text = text.replace("{" + k + "}", str(v))
        return text

    def _err(self, code, key, **vars):
        self._json(code, {"error": self._msg(key, **vars)})
    server_version = "ZentrixServer/1.0"
    protocol_version = "HTTP/1.1"

    # --- security headers on every response ---
    def _headers(self, code: int, ctype: str, length: int, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()

    def _json(self, code: int, obj, extra: dict | None = None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._headers(code, "application/json; charset=utf-8", len(body), extra)
        self.wfile.write(body)

    def _authorized(self) -> bool:
        tok = self.headers.get("X-Auth-Token", "")
        return hmac.compare_digest(tok.encode(), TOKEN.encode())

    # --- routes ---
    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        # path traversal guard: no "..", only files from the allowlist below
        if ".." in path:
            self._err(404, "err_not_found")
            return
        if path in ("/", "/index.html"):
            try:
                body = INDEX_FILE.read_bytes()
            except OSError:
                self._err(500, "err_missing_file", file="index.html")
                return
            self._headers(200, "text/html; charset=utf-8", len(body), {
                "Content-Security-Policy":
                    "default-src 'self'; "
                    "img-src 'self' https://cdn.jsdelivr.net http: data:; "
                    "style-src 'self' 'unsafe-inline'; "
                    "script-src 'self'; "
                    "connect-src 'self' https://cdn.jsdelivr.net; "
                    "frame-ancestors 'none'",
            })
            self.wfile.write(body)
        elif path == "/bg.js":
            try:
                body = (BASE_DIR / "bg.js").read_bytes()
            except OSError:
                self._err(404, "err_missing_file", file="bg.js")
                return
            self._headers(200, "application/javascript; charset=utf-8", len(body), {"Cache-Control": "public, max-age=86400"})
            self.wfile.write(body)
        elif path == "/app.js":
            try:
                body = (BASE_DIR / "app.js").read_bytes()
            except OSError:
                self._err(404, "err_missing_file", file="app.js")
                return
            self._headers(200, "application/javascript; charset=utf-8", len(body))
            self.wfile.write(body)
        elif path == "/i18n.js":
            try:
                body = (BASE_DIR / "i18n.js").read_bytes()
            except OSError:
                self._err(404, "err_missing_file", file="i18n.js")
                return
            self._headers(200, "application/javascript; charset=utf-8", len(body), {"Cache-Control": "public, max-age=86400"})
            self.wfile.write(body)
        elif path == "/api/links":
            self._json(200, load_data())
        elif path == "/api/health":
            self._json(200, {"status": "ok", "token_required_for_write": True})
        elif path == "/api/immich/state":
            # public status for the background client (never contains the key);
            # rotate_if_due() triggers the hourly fetch — cheap when not due
            from immich_client import STATE, masked_config
            body, current_etag, meta = STATE.rotate_if_due()
            mc = masked_config()
            self._json(200, {"configured": meta.get("configured", mc.get("configured", False)),
                             "etag": current_etag,
                             "error": meta.get("error", ""),
                             "interval": mc["interval"],
                             "album": mc["album"],
                             "key_set": mc["key_set"]})
        elif path == "/api/immich/photo":
            from immich_client import STATE
            body, etag, meta = STATE.rotate_if_due()
            if not body:
                self._err(503, "err_not_found")
                return
            self._headers(200, "image/jpeg", len(body), {
                "ETag": f'"{etag}"',
                "Cache-Control": "no-store",
            })
            self.wfile.write(body)
        elif path == "/api/immich/config":
            if not self._authorized():
                self._err(401, "err_auth")
                return
            from immich_client import masked_config
            self._json(200, masked_config())
        else:
            self._err(404, "err_not_found")

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/immich/test":
            if not self._authorized():
                self._err(401, "err_auth")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if length > 64 * 1024:
                self._err(413, "err_too_large", kb=64)
                return
            raw = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                data = {}
            from immich_client import get_config, STATE
            cfg = get_config()
            # probe with the submitted values (fall back to stored config)
            cfg = {
                "url": str(data.get("url", "")).strip().rstrip("/") or cfg["url"],
                "key": str(data.get("key", "")).strip() or cfg["key"],
                "album": str(data.get("album", "")).strip() or cfg["album"],
                "interval": cfg["interval"],
            }
            self._json(200, STATE.probe(cfg))
            return
        self._err(404, "err_not_found")

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/immich/config":
            if not self._authorized():
                self._err(401, "err_auth")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._err(400, "err_content_length")
                return
            if length <= 0 or length > 64 * 1024:
                self._err(413, "err_too_large", kb=64)
                return
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._err(400, "err_bad_json")
                return
            from immich_client import save_gui_config, STATE
            if not save_gui_config(data):
                self._err(400, "err_bad_format")
                return
            # config changed → force next photo fetch + album re-resolve (thread-safe)
            STATE.reset_runtime()
            self._json(200, {"status": "saved"})
            return
        if path != "/api/links":
            self._err(404, "err_not_found")
            return
        if not self._authorized():
            self._err(401, "err_auth")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._err(400, "err_content_length")
            return
        if length <= 0 or length > MAX_BODY:
            self._err(413, "err_too_large", kb=MAX_BODY // 1024)
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._err(400, "err_bad_json")
            return
        if not save_data(data):
            self._err(400, "err_bad_format")
            return
        self._json(200, {"status": "saved"})

    def log_message(self, fmt, *args):
        # quieter logging: only errors and writes
        if args and any(s in str(args[0]) for s in ("PUT", "401", "413", "500")):
            super().log_message(fmt, *args)

def main():
    bind = os.environ.get("ZENTRIX_BIND", "0.0.0.0")
    port = int(os.environ.get("ZENTRIX_PORT", "8080"))
    server = ThreadingHTTPServer((bind, port), Handler)
    print(f"[zentrix] serving {INDEX_FILE.name} on http://{bind}:{port}")
    print(f"[zentrix] data file: {DATA_FILE}")
    print(f"[zentrix] write token: {'from env/file' if (os.environ.get('ZENTRIX_TOKEN') or TOKEN_FILE.exists()) else 'see above'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[zentrix] bye")
        server.server_close()

if __name__ == "__main__":
    main()
