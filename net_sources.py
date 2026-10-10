"""Zentrix network sources — Phase 1 device discovery framework.

Implements the Router-Adapter-Spec (adapter-spec.md §3-§5):
  - DeviceSource protocol + SourceError
  - Device dataclass with field normalization (A5)
  - OUI vendor lookup (lazy-loaded gzip JSON, 58k entries)
  - Merge engine: one device per MAC (or IP), field-wise capability priority,
    confidence scoring, forgetting curve (§5)
  - SourcesConfig: sources.json in the data dir, GUI > ENV > default precedence,
    secrets write-only (A2)
  - SourceRegistry: polling with jitter, per-source error isolation (§9)

Stdlib only (A4). Read-only toward routers (A1).
"""
import gzip
import hmac
import json
import os
import random
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------- errors
class SourceError(Exception):
    """Stable error codes per spec A6."""
    def __init__(self, code: str, message: str = ""):
        self.code = code  # auth | unreachable | timeout | format | config
        super().__init__(message or code)


# ---------------------------------------------------------------- helpers
def norm_mac(mac):
    """Normalize MAC to lowercase colon-separated; None if absent/invalid."""
    if not mac:
        return None
    m = str(mac).strip().lower().replace("-", ":")
    parts = [p for p in m.split(":") if p]
    if len(parts) == 6 and all(len(p) == 2 and all(c in "0123456789abcdef" for c in p) for p in parts):
        return ":".join(parts)
    return None


def norm_ip(ip):
    """Valid IPv4 (or IPv6) or None. Rejects garbage like 192.168.60.999 (spec A5)."""
    if not ip:
        return None
    s = str(ip).strip()
    if not s or s in ("0.0.0.0", "::"):
        return None
    import ipaddress
    try:
        ipaddress.ip_address(s)
        return s
    except ValueError:
        return None


def norm_hostname(name):
    if name is None:
        return None
    s = str(name).strip()
    return s or None


# ---------------------------------------------------------------- OUI
class OUILookup:
    """Lazy-loading vendor lookup: OUI prefix (24 bit) + masked 28/36-bit blocks."""
    def __init__(self, path):
        self.path = Path(path)
        self._data = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._data is not None:
                return
            try:
                with gzip.open(self.path, "rt", encoding="utf-8") as f:
                    self._data = json.load(f)
            except OSError:
                self._data = {}

    def lookup(self, mac: str):
        """Vendor name or None. mac must be normalized (aa:bb:cc:dd:ee:ff)."""
        if not mac:
            return None
        self._load()
        prefix = mac[:8].replace(":", "")
        v = self._data.get(prefix)
        if v:
            return v
        for bits in (36, 32, 28):
            v = self._data.get(prefix + "/" + str(bits))
            if v:
                return v
        return None


# ---------------------------------------------------------------- device model
@dataclass
class Device:
    mac: str | None = None
    ip: str | None = None
    hostname: str | None = None
    vendor: str | None = None
    active: bool | None = None
    address_source: str | None = None
    lease_remaining_s: int | None = None
    interface_type: str | None = None
    area_hint: str | None = None
    source_id: str = ""
    last_seen: int = 0
    confidence: float = 0.0
    raw: dict | None = None

    @staticmethod
    def from_raw(source_id: str, *, mac=None, ip=None, hostname=None, active=None,
                 address_source=None, lease_remaining_s=None, interface_type=None,
                 area_hint=None, raw=None) -> "Device":
        """Build + normalize (A5). Raises SourceError('format') when neither MAC nor IP."""
        d = Device(
            mac=norm_mac(mac),
            ip=norm_ip(ip),
            hostname=norm_hostname(hostname),
            active=bool(active) if active is not None else None,
            address_source=(str(address_source).strip().lower() or None) if address_source else None,
            lease_remaining_s=int(lease_remaining_s) if lease_remaining_s is not None else None,
            interface_type=(str(interface_type).strip().lower() or None) if interface_type else None,
            area_hint=(str(area_hint).strip() or None) if area_hint else None,
            source_id=source_id,
            last_seen=int(time.time()),
            raw=raw,
        )
        if not d.mac and not d.ip:
            raise SourceError("format", "device has neither MAC nor IP")
        if d.lease_remaining_s is not None and d.lease_remaining_s < 0:
            d.lease_remaining_s = None
        return d

    @property
    def key(self) -> str:
        """Merge key: MAC if present, else IP (spec §5)."""
        return self.mac or ("ip:" + self.ip if self.ip else "")


# ---------------------------------------------------------------- capabilities
CAPS = {
    "CAP_DNS": 0.6,
    "CAP_ARP": 0.90,
    "CAP_DHCP_LEASES": 0.95,
    "CAP_ACTIVE_STATE": 0.0,   # base for activity source (weight via priority, not score)
    "CAP_INTERFACE_TYPE": 0.0,
    "CAP_TOPOLOGY": 0.0,
    "CAP_MDNS": 0.50,
}

FIELD_PRIORITY = [
    # field: (preferred capabilities in order, fallback = any source)
    ("active", ["CAP_ACTIVE_STATE", "CAP_ARP", "CAP_DHCP_LEASES", "CAP_MDNS"]),
    ("ip", ["CAP_DHCP_LEASES", "CAP_ARP", "CAP_MDNS"]),
    ("hostname", ["CAP_DHCP_LEASES", "CAP_ARP", "CAP_MDNS"]),
    ("interface_type", ["CAP_INTERFACE_TYPE", "CAP_ARP", "CAP_MDNS"]),
    ("address_source", ["CAP_DHCP_LEASES", "CAP_ARP"]),
    ("lease_remaining_s", ["CAP_DHCP_LEASES"]),
    ("area_hint", ["CAP_ARP", "CAP_DHCP_LEASES", "CAP_MDNS"]),
]


def merge_devices(sightings: list[Device], oui: OUILookup, now: int) -> list[Device]:
    """Merge all source sightings into one Device per key (spec §5).
    Vendor ALWAYS comes from the OUI registry (adapter vendor claims discarded)."""
    by_key: dict[str, list[Device]] = {}
    for d in sightings:
        if d.key:
            by_key.setdefault(d.key, []).append(d)

    # cross-key join: a no-MAC sighting (e.g. mDNS) merges into the MAC-keyed
    # device when the IP matches (spec §5 "ggf. zusätzlich pro IP, wenn MAC fehlt")
    mac_groups = [v for k, v in by_key.items() if not k.startswith("ip:")]
    for k in [k for k in by_key if k.startswith("ip:")]:
        ip = k[3:]
        target = next((g for g in mac_groups if g[0].ip == ip), None)
        if target is not None:
            target.extend(by_key.pop(k))

    merged = []
    for key, group in by_key.items():
        base = Device(mac=group[0].mac, ip=group[0].ip, source_id="merged", last_seen=now)
        caps_by_src = {}
        for d in group:
            caps_by_src[d.source_id] = getattr(d, "_caps", frozenset())

        def pick(field_name):
            prefs = dict(FIELD_PRIORITY).get(field_name, [])
            best = None
            best_rank = 10 ** 9
            for d in group:
                caps = caps_by_src.get(d.source_id, frozenset())
                rank = 10 ** 8
                for i, cap in enumerate(prefs):
                    if cap in caps and getattr(d, field_name) is not None:
                        rank = i * 10 ** 4 - int(d.last_seen % 10 ** 4)
                        break
                else:
                    if getattr(d, field_name) is not None:
                        rank = 5 * 10 ** 8 - int(d.last_seen % 10 ** 4)
                if getattr(d, field_name) is not None and rank < best_rank:
                    best, best_rank = getattr(d, field_name), rank
            return best

        for f, _ in FIELD_PRIORITY:
            setattr(base, f, pick(f))

        # vendor strictly from OUI registry
        base.vendor = oui.lookup(base.mac) if base.mac else None

        # confidence: best capability weight, minus staleness, plus OUI hit
        cap_scores = [CAPS.get(c, 0.0) for d in group for c in caps_by_src.get(d.source_id, frozenset())]
        score = max(cap_scores) if cap_scores else 0.3
        age_days = max(0.0, (now - max(d.last_seen for d in group)) / 86400.0)
        score = max(0.1, score - 0.1 * age_days)
        if base.vendor:
            score = min(1.0, score + 0.05)
        base.confidence = round(score, 2)

        # remember contributing sources + lease extras (first non-empty wins)
        extras = {}
        for k in ("man", "starts", "ends", "descr", "if_descr",
                  "vpn_type", "pubkey", "handshake", "transfer-rx", "transfer-tx",
                  "real_address", "connected_since", "peer"):
            for d in group:
                v = (d.raw or {}).get(k)
                if v:
                    extras[k] = v
                    break
        base.raw = {"sources": sorted({d.source_id for d in group}), **extras}
        merged.append(base)
    return merged
