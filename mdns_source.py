"""Zentrix passive mDNS listener — Pseudo-Quelle (spec §11, CAP_MDNS only).

Listens on UDP 5353 (multicast 224.0.0.251), parses A/PTR records enough to
map service instances to IP + optional hostname. Passive only: never sends
queries in Phase 1 (zero special privileges, no CAP conditions needed).

Stdlib only. Runs as a daemon thread inside the server; sightings are
pushed into a thread-safe list the registry drains on each poll.
"""
import ipaddress
import socket
import struct
import threading
import time

from net_sources import Device

MDNS_ADDR = "224.0.0.251"
MDNS_PORT = 5353


def _read_name(buf: bytes, off: int):
    """Parse a DNS name; returns (name, new_offset). Handles compression pointers."""
    labels = []
    jumps = 0
    while True:
        if off >= len(buf) or jumps > 8:
            return ".".join(l for l in labels if l), off + 1
        length = buf[off]
        if length == 0:
            off += 1
            break
        if length & 0xC0 == 0xC0:  # pointer
            if off + 1 >= len(buf):
                return ".".join(l for l in labels if l), off + 2
            ptr = ((length & 0x3F) << 8) | buf[off + 1]
            off += 2
            jumps += 1
            sub, _ = _read_name(buf, ptr)
            if sub:
                labels.append(sub)
            break
        off += 1
        label = buf[off:off + length]
        try:
            labels.append(label.decode("ascii", errors="replace"))
        except Exception:
            labels.append("")
        off += length
    return ".".join(l for l in labels if l), off


def parse_mdns_packet(buf: bytes):
    """Extract (ip, hostname, service_type) triples from an mDNS packet (answers only)."""
    if len(buf) < 12:
        return []
    qd, an = struct.unpack("!HH", buf[4:8])
    off = 12
    for _ in range(qd):
        _, off = _read_name(buf, off)
        off += 4  # type + class
    found = []
    for _ in range(an):
        name, off = _read_name(buf, off)
        if off + 10 > len(buf):
            break
        rtype, _rclass, _ttl, rdlen = struct.unpack("!HHIH", buf[off:off + 10])
        off += 10
        rdata = buf[off:off + rdlen]
        off += rdlen
        if rtype == 1 and rdlen == 4:  # A record
            ip = str(ipaddress.IPv4Address(rdata))
            host = name.split(".")[0] if name else None
            stype = None
            if name and "." in name and not name.split(".")[0].isdigit():
                parts = name.split(".")
                if len(parts) >= 3 and parts[1].startswith("_"):
                    stype = parts[1][1:] + "." + parts[2]
            found.append({"ip": ip, "hostname": host, "service": stype})
    return found


class MdnsListener:
    """Passive listener thread. Drops sightings older than max_age on drain."""
    source_id = "mdns"
    display_name = "mDNS (passiv)"
    capabilities = frozenset({"CAP_MDNS"})

    def __init__(self):
        self._sightings = {}   # ip -> {"hostname":…, "service":…, "ts":…}
        self._lock = threading.Lock()
        self._sock = None
        self._thread = None
        self._stop = threading.Event()
        self.last_error = ""

    # -- lifecycle -----------------------------------------------------------
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="zentrix-mdns")
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass

    def _run(self):
        while not self._stop.is_set():
            try:
                self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:  # join multicast group (best effort; works in bridge nets)
                    import struct as _s
                    mreq = _s.pack("4sl", socket.inet_aton(MDNS_ADDR), socket.INADDR_ANY)
                    self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
                except OSError:
                    pass
                self._sock.bind(("", MDNS_PORT))
                self._sock.settimeout(1.0)
                self.last_error = ""
                while not self._stop.is_set():
                    try:
                        buf, addr = self._sock.recvfrom(9000)
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    for hit in parse_mdns_packet(buf):
                        with self._lock:
                            cur = self._sightings.get(hit["ip"], {})
                            cur.update({"hostname": hit["hostname"] or cur.get("hostname"),
                                        "service": hit["service"] or cur.get("service"),
                                        "ts": time.time()})
                            self._sightings[hit["ip"]] = cur
            except OSError as e:
                self.last_error = str(e)
                time.sleep(5)  # retry bind after network changes
            finally:
                if self._sock:
                    try:
                        self._sock.close()
                    except OSError:
                        pass
                    self._sock = None

    # -- source interface ------------------------------------------------------
    def drain(self, max_age_s: float = 3600.0) -> list:
        """Snapshot of sightings (no clearing — registry merges by key)."""
        cutoff = time.time() - max_age_s
        out = []
        with self._lock:
            for ip, hit in list(self._sightings.items()):
                if hit["ts"] < cutoff:
                    continue  # expired, will be cleaned on next prune
                try:
                    out.append(Device.from_raw(
                        self.source_id,
                        mac=None, ip=ip,
                        hostname=hit.get("hostname"),
                        active=True,
                        area_hint=None,
                        raw={"service": hit.get("service")} if hit.get("service") else None,
                    ))
                except Exception:
                    continue
        return out

    def status(self) -> dict:
        with self._lock:
            return {"running": bool(self._thread and self._thread.is_alive()),
                    "sightings": len(self._sightings),
                    "last_error": self.last_error}
