"""Zentrix source registry — polling orchestration + device cache (spec §3/§9).

Owns the adapters, drains sightings on each poll tick, merges them via
net_sources.merge_devices and keeps a thread-safe cache served by the HTTP API.

- Per-source error isolation: last_error + consecutive-failure counter with
  5-min backoff after 3 failures ("degraded").
- Poll intervals per source (poll_s, default 300) with ±10 % jitter.
"""
import threading
import time

from net_sources import OUILookup, merge_devices


class SourceEntry:
    def __init__(self, adapter, cfg_getter, secret_getter, secret_fields):
        self.adapter = adapter
        self.cfg_getter = cfg_getter          # -> dict (public config)
        self.secret_getter = secret_getter    # -> (field, value) pairs
        self.secret_fields = secret_fields
        self.last_error = ""
        self.error_code = ""
        self.failures = 0
        self.last_poll = 0.0
        self.last_latency_ms = 0
        self.degraded_until = 0.0

    def build_cfg(self) -> dict:
        cfg = dict(self.cfg_getter())
        for f in self.secret_fields:
            cfg["_" + f] = self.secret_getter(f)
        return cfg


class SourceRegistry:
    def __init__(self, oui_path, poll_tick_s: float = 30.0):
        self.oui = OUILookup(oui_path)
        self.entries: dict[str, SourceEntry] = {}
        self._devices: list = []
        self._by_key: dict = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.poll_tick_s = poll_tick_s

    # -- registration ---------------------------------------------------------
    def register(self, adapter, cfg_getter, secret_getter, secret_fields=()):
        self.entries[adapter.source_id] = SourceEntry(adapter, cfg_getter,
                                                      secret_getter, secret_fields)

    # -- polling ---------------------------------------------------------------
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="zentrix-sources")
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.wait(self.poll_tick_s):
            now = time.time()
            for sid, entry in list(self.entries.items()):
                cfg = entry.build_cfg()
                if not cfg.get("enabled"):
                    continue
                poll_s = max(30, int(cfg.get("poll_s") or 300))
                interval = poll_s * (0.9 + 0.2 * (hash(sid) % 100 / 100.0))  # stable jitter
                if now - entry.last_poll < interval:
                    continue
                if now < entry.degraded_until:
                    continue
                try:
                    sightings = entry.adapter.fetch_devices(cfg)
                    self._absorb(sid, sightings)
                    entry.last_poll = now
                    entry.failures = 0
                    entry.last_error = ""
                    entry.error_code = ""
                except Exception as e:
                    entry.failures += 1
                    entry.last_error = str(e) or e.__class__.__name__
                    entry.error_code = getattr(e, "code", "error")
                    if entry.failures >= 3:
                        entry.degraded_until = now + 300  # 5-min backoff (spec §9)
            self._remerge()

    def _absorb(self, source_id: str, sightings: list):
        """Store latest sightings per source, then merge."""
        with self._lock:
            for d in sightings:
                caps = getattr(self.entries[source_id].adapter, "capabilities", frozenset())
                setattr(d, "_caps", caps)
                self._by_key[(source_id, d.key)] = d

    def _remerge(self):
        with self._lock:
            sightings = list(self._by_key.values())
            now = int(time.time())
            self._devices = merge_devices(sightings, self.oui, now)

    # -- mdns pseudo-source (event-driven) --------------------------------------
    def absorb_mdns(self, listener):
        try:
            sightings = listener.drain()
        except Exception:
            return
        if sightings:
            self._absorb("mdns", sightings)
            self._remerge()

    # -- topology 2.0: interfaces + vpn branches ---------------------------------
    # -- public IP (external echo service, cached 10 min) --------------------------
    _pub_ip_cache = {"ip": None, "at": 0.0}

    def fetch_public_ip(self):
        """Öffentliche IP via externem Echo-Dienst (NICHT aus der WAN-Schnittstelle).
        10 min Cache; Fehler → None (UI zeigt —). Getrennt von Router-Quellen."""
        import re as _re
        c = self._pub_ip_cache
        if time.time() - c["at"] < 600 and c["ip"]:
            return c["ip"]
        from sources_config import get_public_ip_url
        url = get_public_ip_url()
        if not url:
            return None
        import urllib.request as _u
        try:
            with _u.urlopen(url, timeout=5) as resp:
                text = resp.read(512).decode("utf-8", "replace")
            m = _re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", text)
            if m:
                c["ip"], c["at"] = m.group(1), time.time()
                return c["ip"]
        except Exception:
            pass
        return None

    def fetch_topology_data(self) -> dict:
        """Pull interfaces + vpn branches from the first capable source (spec §3).
        Read-only; errors per branch isolated — fehlende Module liefern leere Zweige."""
        interfaces, vpn_branches, vpn_sightings = [], {}, []
        active_source = None
        for sid, entry in list(self.entries.items()):
            cfg = entry.build_cfg()
            if not cfg.get("enabled"):
                continue
            adapter = entry.adapter
            try:
                if hasattr(adapter, "fetch_interfaces"):
                    interfaces = adapter.fetch_interfaces(cfg) or []
                    if interfaces:
                        active_source = sid
            except Exception as e:
                pass  # isolated
            try:
                if hasattr(adapter, "fetch_vpns"):
                    s, branches = adapter.fetch_vpns(cfg)
                    vpn_sightings = s or []
                    vpn_branches = branches or {}
            except Exception:
                pass
            if interfaces or vpn_branches:
                break  # first source wins (multi-router merge comes later)
        if vpn_sightings:
            self._absorb("opnsense", vpn_sightings)
            self._remerge()
        now = int(time.time())
        devs = []
        with self._lock:
            for d in list(self._devices):
                if d.raw and (d.raw.get("vpn_type") or d.address_source == "vpn"):
                    devs.append(d)
        return {"interfaces": interfaces,
                "source": active_source,
                "public_ip": self.fetch_public_ip(),
                "vpn": {"branches": vpn_branches,
                        "devices": [{"mac": d.mac, "ip": d.ip, "hostname": d.hostname,
                                     "interface_type": d.interface_type,
                                     "active": d.active, "raw": d.raw} for d in devs]}}

    # -- API view -----------------------------------------------------------------
    def snapshot(self) -> dict:
        """Devices + per-source status for the HTTP API (no secrets!)."""
        with self._lock:
            devices = [d for d in self._devices]
        now = int(time.time())
        out = []
        for d in devices:
            out.append({
                "mac": d.mac, "ip": d.ip, "ip6": d.ip6, "hostname": d.hostname,
                "vendor": d.vendor, "active": d.active,
                "address_source": d.address_source,
                "lease_remaining_s": d.lease_remaining_s,
                "interface_type": d.interface_type,
                "area_hint": d.area_hint,
                "confidence": d.confidence,
                "age_s": max(0, now - d.last_seen),
                "sources": (d.raw or {}).get("sources", []),
                "lease": {k: (d.raw or {}).get(k) for k in
                          ("man", "starts", "ends", "descr", "if_descr")
                          if (d.raw or {}).get(k)},
                "vpn": {k: (d.raw or {}).get(k) for k in
                        ("vpn_type", "pubkey", "handshake", "handshake_ts", "transfer-rx", "transfer-tx",
                         "real_address", "connected_since", "peer")
                        if (d.raw or {}).get(k) is not None},
            })
        sources = {}
        for sid, e in self.entries.items():
            cfg = e.build_cfg()
            sources[sid] = {
                "enabled": bool(cfg.get("enabled")),
                "poll_s": cfg.get("poll_s"),
                "last_poll": int(e.last_poll) if e.last_poll else None,
                "last_error": e.last_error,
                "error_code": e.error_code,
                "failures": e.failures,
                "degraded": time.time() < e.degraded_until,
            }
        return {"now": now, "devices": out, "sources": sources}


# ---------------------------------------------------------------- shared instance
REGISTRY = SourceRegistry(oui_path=__import__("pathlib").Path(__file__).resolve().parent
                          / "oui-manuf.json.gz")


# ---------------------------------------------------------------- mdns handle
# The server registers its MdnsListener here at boot; the PUT handler uses it to
# start/stop the listener live when the GUI toggle changes (no restart needed).
MDNS_LISTENER = None

def apply_runtime_config():
    """Sync mdns listener state after a GUI config change (spec §8)."""
    global MDNS_LISTENER
    if MDNS_LISTENER is None:
        return
    try:
        from sources_config import SOURCES_CONFIG
        enabled = bool(SOURCES_CONFIG.public_state().get("mdns", {}).get("enabled"))
        if enabled and not (MDNS_LISTENER._thread and MDNS_LISTENER._thread.is_alive()):
            MDNS_LISTENER.start()
        elif not enabled:
            MDNS_LISTENER.stop()
    except Exception:
        pass
