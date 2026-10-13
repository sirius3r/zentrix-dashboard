"""Zentrix OPNsense adapter — Phase 1 reference implementation (spec §6).

Endpoints (OPNsense REST API, key/secret via HTTP Basic Auth):
  POST /api/diagnostics/interface/search_arp → ARP table (Fallback: GET getArp)
  GET /api/dhcpv4/leases/searchLease         → DHCPv4 leases
  GET /api/diagnostics/interface/getInterfaces → interface list (topology hints)

Stdlib only (urllib + json + base64). Read-only (A1). Credentials never in errors (A2).
"""
import base64
import json
import re
import time
import urllib.error
import urllib.request

import urllib.parse

from net_sources import Device, SourceError, norm_mac, norm_ip


def _looks_like_no_ptr(name: str) -> bool:
    """gethostbyaddr returns the IP itself or 'NXDOMAIN-ish' strings when no PTR."""
    n = name.lower()
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", n):
        return True
    return n.endswith(("nxdomain", "no reverse dns", "unknown"))

PROBE_TIMEOUT = 5.0
FETCH_TIMEOUT = 15.0


class OpnSenseSource:
    source_id = "opnsense"
    display_name = "OPNsense (API)"
    capabilities = frozenset({"CAP_ARP", "CAP_DHCP_LEASES", "CAP_ACTIVE_STATE",
                              "CAP_INTERFACE_TYPE", "CAP_TOPOLOGY", "CAP_DNS"})

    def __init__(self, timeout_connect: float = PROBE_TIMEOUT):
        self.timeout_connect = timeout_connect

    # -- internals ---------------------------------------------------------
    def _request(self, cfg: dict, path: str, timeout: float, payload: dict = None):
        url = str(cfg.get("url", "")).rstrip("/") + path
        key = cfg.get("_key", "")
        secret = cfg.get("_secret", "")
        if not url:
            raise SourceError("config", "OPNsense URL is not configured")
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=body,
                                     method="POST" if payload is not None else "GET")
        if key and secret:
            token = base64.b64encode(f"{key}:{secret}".encode()).decode()
            req.add_header("Authorization", "Basic " + token)
        req.add_header("Accept", "application/json")
        if payload is not None:
            req.add_header("Content-Type", "application/json")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SourceError("auth", f"OPNsense rejected credentials (HTTP {e.code})")
            if e.code == 404:
                raise SourceError("format", f"OPNsense endpoint not found: {path}")
            raise SourceError("unreachable", f"OPNsense HTTP {e.code}")
        except urllib.error.URLError as e:
            raise SourceError("unreachable", "OPNsense not reachable")
        except TimeoutError:
            raise SourceError("timeout", "OPNsense request timed out")
        except OSError:
            raise SourceError("unreachable", "OPNsense connection failed")
        try:
            data = json.loads(body.decode("utf-8", errors="replace"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise SourceError("format", "OPNsense returned invalid JSON")
        return data, int((time.monotonic() - t0) * 1000)

    def _cfg_with_secrets(self, cfg: dict, key: str, secret: str) -> dict:
        c = dict(cfg)
        c["_key"], c["_secret"] = key, secret
        return c

    # -- interface ----------------------------------------------------------
    def probe(self, cfg: dict, key: str = None, secret: str = None) -> dict:
        c = self._cfg_with_secrets(cfg, key or cfg.get("_key", ""), secret or cfg.get("_secret", ""))
        try:
            data, latency = self._request(c, "/api/diagnostics/interface/search_arp",
                                          timeout=PROBE_TIMEOUT,
                                          payload={"current": 1, "rowCount": -1, "sort": {}, "searchPhrase": ""})
        except SourceError as e:
            if e.code != "format":
                raise
            data, latency = self._request(c, "/api/diagnostics/interface/getArp",
                                          timeout=PROBE_TIMEOUT)
        rows = data if isinstance(data, list) else data.get("rows", [])
        model = None
        try:
            sysinfo, _ = self._request(c, "/api/core/system/information",
                                       timeout=PROBE_TIMEOUT)
            model = sysinfo.get("product_name") or sysinfo.get("product_id") or None
        except SourceError:
            pass
        return {"ok": True, "reachable": True, "authenticated": True,
                "device_count": len(rows), "latency_ms": latency,
                "router_model": model, "error_code": None}

    def fetch_devices(self, cfg: dict, key: str = None, secret: str = None) -> list:
        c = self._cfg_with_secrets(cfg, key or cfg.get("_key", ""), secret or cfg.get("_secret", ""))
        # ARP-Tabelle: search_arp (POST, PAGINIERUNG OFF — rowCount:-1 = alle Einträge).
        # Liefert auch statische IP-Hosts (permanent), die nie DHCP nutzen.
        # Fallback: getArp (GET) für ältere OPNsense-Versionen ohne search-Controller.
        try:
            arp, _ = self._request(c, "/api/diagnostics/interface/search_arp",
                                   timeout=FETCH_TIMEOUT,
                                   payload={"current": 1, "rowCount": -1, "sort": {}, "searchPhrase": ""})
        except SourceError as e:
            if e.code != "format":
                raise
            arp, _ = self._request(c, "/api/diagnostics/interface/getArp", timeout=FETCH_TIMEOUT)
        devices = []
        rows = arp if isinstance(arp, list) else arp.get("rows", [])
        for row in rows:
            try:
                d = Device.from_raw(
                    self.source_id,
                    mac=row.get("mac"),
                    ip=row.get("ip") or row.get("address"),
                    hostname=None,
                    active=(True if (row.get("permanent") in ("1", 1, True)
                                     or str(row.get("expires", "-1")) != "0") else None),
                    interface_type="ethernet" if row.get("permanent") in ("1", 1, True) else None,
                    area_hint=row.get("intf_description") or row.get("intf"),
                    raw={"mac": row.get("mac"), "ip": row.get("ip"),
                         "man": row.get("manufacturer"), "arp": True,
                         "permanent": row.get("permanent"),
                         "if_descr": row.get("intf_description") or row.get("intf")},
                )
                devices.append(d)
            except SourceError:
                continue  # skip malformed rows, don't fail the whole snapshot
        # DHCP leases (CAP_DHCP_LEASES) — rich data: hostname, lease window,
        # vendor (router-side macdb), and the router's own online status.
        # inactive=1 includes expired leases so previously seen devices stay listed.
        # OPNsense ≥ 24.7 nutzt Kea statt ISC-dhcp: /api/kea/leases4/search
        # (Format: hwaddr statt mac, state INT 0=active, expire unix, if_name/if_descr,
        # lease_type dynamic|static). Strategie: ISC zuerst; wenn leer/404 → Kea.
        lease_rows = []
        try:
            leases, _ = self._request(c, "/api/dhcpv4/leases/searchLease?inactive=1",
                                      timeout=FETCH_TIMEOUT)
            lease_rows = leases if isinstance(leases, list) else leases.get("rows", [])
        except SourceError:
            lease_rows = []
        # Kea (aktiver DHCP-Server ab OPNsense 24.7) — IMMER abfragen und per
        # MAC deduplizieren (Kea gewinnt, da aktive Leases). Fängt Migrations-
        # und Dual-Setup-Fälle ab.
        try:
            kea, _ = self._request(c, "/api/kea/leases4/search",
                                   timeout=FETCH_TIMEOUT)
            kea_rows = kea if isinstance(kea, list) else kea.get("rows", [])
            kea_by_mac = {}
            for rec in kea_rows:
                mac = norm_mac(rec.get("hwaddr"))
                if mac:
                    kea_by_mac[mac] = rec
            if kea_by_mac:
                # 1) Kea-Records bevorzugt: bestehende ISC-Leases mit gleichem MAC ersetzen
                lease_rows = [r for r in lease_rows
                              if norm_mac(r.get("mac")) not in kea_by_mac]
                # 2) Kea-Records in ISC-kompatibles Format übersetzen
                for rec in kea_by_mac.values():
                    state = rec.get("state")
                    rec2 = {
                        "address": rec.get("address"),
                        "mac": rec.get("hwaddr"),
                        "hostname": rec.get("hostname"),
                        "type": rec.get("lease_type") or ("static" if rec.get("is_reserved") else "dynamic"),
                        "state": "active" if state == 0 else "expired",
                        "man": rec.get("mac_info"),
                        "if_descr": rec.get("if_descr") or rec.get("if_name"),
                        "starts": None,
                        "ends": None,
                        "binding": "active" if state == 0 else "free",
                    }
                    if rec.get("expire"):
                        try:
                            from datetime import datetime
                            rec2["ends"] = datetime.fromtimestamp(int(rec["expire"])).strftime("%Y/%m/%d %H:%M:%S")
                        except (ValueError, OSError):
                            pass
                    lease_rows.append(rec2)
        except SourceError:
            pass  # kea nicht aktiv/installiert
        for row in lease_rows:
                mac = norm_mac(row.get("mac"))
                binding = str(row.get("binding", "")).strip().lower()
                state = str(row.get("state", "")).strip().lower()
                # Backup-Leases sind DHCP-Pool-Platzhalter (leere MAC) — keine Geräte.
                # Abgelaufene (binding=free/state=expired) mit echter MAC BLEIBEN —
                # historische Geräte (Martins WORK-Bereich zeigte sie als 0/6 offline).
                if binding == "backup" or state == "backup" or not mac:
                    continue
                hostname = (row.get("hostname") or "").strip() or None
                # OPNsense already matched ARP: status = online|offline
                status = str(row.get("status", "")).strip().lower()
                if status in ("online", "offline"):
                    active = status == "online"
                else:
                    active = binding == "active" or state in ("active", "online")
                # lease window → remaining seconds (if ends parseable)
                lease_remaining_s = None
                ends = row.get("ends")
                if ends:
                    try:
                        from datetime import datetime
                        dt = datetime.strptime(str(ends), "%Y/%m/%d %H:%M:%S")
                        lease_remaining_s = max(0, int(dt.timestamp() - time.time()))
                    except ValueError:
                        pass
                # area_hint direkt aus if_descr (verläßlicher als IP-Mapping)
                if_descr = (row.get("if_descr") or "").strip() or None
                d = Device.from_raw(
                    self.source_id,
                    mac=mac,
                    ip=norm_ip(row.get("address")),
                    hostname=hostname,
                    active=active,
                    address_source="static" if str(row.get("type", "")).lower() == "static" else "dhcp",
                    lease_remaining_s=lease_remaining_s,
                    area_hint=if_descr,
                    raw={"man": row.get("man"), "if_descr": row.get("if_descr"),
                         "descr": row.get("descr"), "type": row.get("type"),
                         "starts": row.get("starts"), "ends": row.get("ends"),
                         "binding": binding, "state": state},
                )
                devices.append(d)

        # Reverse-DNS für Geräte ohne Hostname (verifiziert: reverseLookupAction
        # akzeptiert address[] als Array; Antwort {ip: name}, name==ip → kein PTR).
        try:
            no_name = sorted({d.ip for d in devices if d.ip and not d.hostname})[:8]
            if no_name:
                qs = "&".join("address%5B%5D=" + urllib.parse.quote(ip) for ip in no_name)
                rev, _ = self._request(c, "/api/diagnostics/dns/reverse_lookup?" + qs,
                                       timeout=6.0)  # PTR-Abfragen können hängen — kurz halten
                if isinstance(rev, dict):
                    for ip in no_name:
                        name = str(rev.get(ip, "") or "").strip()
                        if name and name != ip and not _looks_like_no_ptr(name):
                            devices.append(Device.from_raw(
                                self.source_id, mac=None, ip=ip, hostname=name,
                                active=None, address_source=None, area_hint=None,
                                raw={"dns": True}))
        except (SourceError, Exception):
            pass  # DNS optional

        # area_hint aus der Interface-Zuordnung: welches Interface-Netz enthält die IP?
        # (verifiziert: ifconfig liefert ipv4 [{ipaddr, subnetbits}], names liefert descr)
        try:
            import ipaddress as _ipa
            ifconf, _ = self._request(c, "/api/diagnostics/interface/get_interface_config",
                                      timeout=FETCH_TIMEOUT)
            names = {}
            try:
                names, _ = self._request(c, "/api/diagnostics/interface/get_interface_names",
                                         timeout=FETCH_TIMEOUT)
                if not isinstance(names, dict):
                    names = {}
            except SourceError:
                pass
            nets = []
            if isinstance(ifconf, dict):
                for ifname, data in ifconf.items():
                    if not isinstance(data, dict):
                        continue
                    for entry in (data.get("ipv4") or []):
                        try:
                            net = _ipa.ip_network(
                                f"{entry['ipaddr']}/{entry['subnetbits']}", strict=False)
                            descr = str(names.get(ifname) or ifname).strip()
                            nets.append((net, descr))
                        except (KeyError, ValueError):
                            continue
            for d in devices:
                if d.ip:
                    try:
                        ipa = _ipa.ip_address(d.ip)
                        for net, descr in nets:
                            if ipa in net and descr:
                                d.area_hint = descr
                                break
                    except ValueError:
                        continue
        except (SourceError, Exception):
            pass  # area mapping optional
        return devices

        # ------------------------------------------------------------------
    # Topologie 2.0 (Paket A): echte Interfaces + VPN-Peers/Sessions
    # ------------------------------------------------------------------
    def fetch_interfaces(self, cfg, key=None, secret=None):
        """Alle Interfaces mit Name, Beschreibung, IP/CIDR (read-only).
        Real-OPNsense-Struktur (verifiziert gegen InterfaceController):
        get_interface_config → {ifname: {ipv4: [{ipaddr, subnetbits}], …}}
        get_interface_names  → {ifname: descr}
        Liefert Liste: {name, descr, ipaddr, kind} — kind heuristisch."""
        c = self._cfg_with_secrets(cfg, key or cfg.get("_key", ""), secret or cfg.get("_secret", ""))
        out = []
        ifconf, _ = self._request(c, "/api/diagnostics/interface/get_interface_config",
                                  timeout=FETCH_TIMEOUT)
        names = {}
        try:
            names, _ = self._request(c, "/api/diagnostics/interface/get_interface_names",
                                     timeout=FETCH_TIMEOUT)
            if not isinstance(names, dict):
                names = {}
        except SourceError:
            pass
        if not isinstance(ifconf, dict):
            return out
        PSEUDO_IFS = {"lo0", "lo", "enc0", "pfsync0", "pflog0", "pflog", "pfsync"}
        for ifname, data in ifconf.items():
            if not isinstance(data, dict) or ifname.startswith("_"):
                continue
            if ifname.lower() in PSEUDO_IFS:
                continue  # FreeBSD-Pseudo-Interfaces: keine Netzwerkknoten
            ipaddr = ""
            ipv4 = data.get("ipv4") or []
            if isinstance(ipv4, list) and ipv4:
                first = ipv4[0] or {}
                ipaddr = str(first.get("ipaddr", ""))
                if first.get("subnetbits"):
                    ipaddr = f"{ipaddr}/{first['subnetbits']}"
            descr = str(names.get(ifname) or data.get("descr") or ifname).strip()
            low = (descr + " " + ifname).lower()
            kind = "lan"
            if "wan" in low:
                kind = "wan"
            elif "vpn" in low or ifname.startswith(("wg", "ovpn")):
                kind = "vpn"
            elif "guest" in low:
                kind = "guest"
            elif "iot" in low or "smarthome" in low:
                kind = "iot"
            out.append({"name": ifname, "descr": descr,
                        "ipaddr": ipaddr, "kind": kind})
        return out

    def fetch_vpns(self, cfg, key=None, secret=None):
        """VPN-Peers/Sessions aller 3 Typen (nur konfigurierte erscheinen).
        Liefert Geräte-fähige Sighting-Liste + rohe VPN-Zweigdaten."""
        c = self._cfg_with_secrets(cfg, key or cfg.get("_key", ""), secret or cfg.get("_secret", ""))
        sightings = []
        branches = {}

        # ---- WireGuard ---------------------------------------------------
        try:
            data, _ = self._request(c, "/api/wireguard/service/show", timeout=FETCH_TIMEOUT)
            records = (data.get("rows") or data.get("records") or []) if isinstance(data, dict) else []
            wg_peers = []
            for rec in records:
                if rec.get("type") != "peer":
                    continue
                name = (rec.get("name") or "").strip() or None
                pubkey = rec.get("public-key", "")
                status = rec.get("peer-status", "")
                active = status == "online"
                tunnel_ip = (rec.get("allowed-ips") or "").split(",")[0].split("/")[0].strip()
                hs = rec.get("latest-handshake-epoch")
                hs_ts = rec.get("latest-handshake")
                if not hs and hs_ts:
                    # Fallback: unix-Sekunden → lesbare Zeit
                    # (Peers ohne epoch, aber mit letztem Handshake)
                    try:
                        from datetime import datetime
                        hs = datetime.fromtimestamp(int(hs_ts)).strftime("%Y-%m-%d %H:%M:%S")
                    except (ValueError, TypeError, OSError):
                        hs = None
                try:
                    d = Device.from_raw(self.source_id, mac=None, ip=tunnel_ip or None,
                                        hostname=name, active=active if status else None,
                                        address_source="vpn", interface_type="wireguard",
                                        area_hint="vpn",
                                        raw={"vpn_type": "wireguard", "pubkey": pubkey,
                                             "handshake": hs,
                                             "handshake_ts": int(hs_ts) if hs_ts else None,
                                             "if": rec.get("if"),
                                             "transfer-rx": rec.get("transfer-rx"),
                                             "transfer-tx": rec.get("transfer-tx")})
                except SourceError:
                    continue  # peer ohne Tunnel-IP → nur Zweig-Daten
                except SourceError:
                    continue  # peer ohne Tunnel-IP → nur Zweig-Daten
                d._caps = frozenset(self.capabilities)
                sightings.append(d)
                wg_peers.append(rec)
            if wg_peers:
                branches["wireguard"] = wg_peers
        except SourceError as e:
            if e.code != "format":
                pass  # wireguard nicht installiert/konfiguriert → Zweig fehlt

        # ---- OpenVPN -----------------------------------------------------
        try:
            data, _ = self._request(c, "/api/openvpn/service/search_sessions",
                                    timeout=FETCH_TIMEOUT)
            for rec in (data if isinstance(data, list) else data.get("rows", [])):
                if not rec.get("is_client"):
                    continue
                real = (rec.get("real_address") or "").split(":")[0].strip()
                common = (rec.get("common_name") or "").strip() or None
                descr = (rec.get("description") or "").strip() or None
                host = common or descr
                virt_ip = (rec.get("virtual_address") or "").split("/")[0].strip() or None
                try:
                    d = Device.from_raw(self.source_id, mac=None, ip=virt_ip or real or None,
                                        hostname=host, active=True,
                                        address_source="vpn", interface_type="openvpn",
                                        area_hint="vpn",
                                        raw={"vpn_type": "openvpn",
                                             "real_address": real,
                                             "connected_since": rec.get("connected_since"),
                                             "bytes_received": rec.get("bytes_received"),
                                             "bytes_sent": rec.get("bytes_sent")})
                except SourceError:
                    continue
                d._caps = frozenset(self.capabilities)
                sightings.append(d)
        except SourceError:
            pass  # openvpn nicht vorhanden

        # ---- IPsec -------------------------------------------------------
        try:
            data, _ = self._request(c, "/api/ipsec/sessions/search_phase1",
                                    timeout=FETCH_TIMEOUT)
            ipsec_sessions = []
            for rec in (data if isinstance(data, list) else data.get("rows", [])):
                connected = bool(rec.get("connected"))
                name = (rec.get("phase1desc") or rec.get("name") or "").strip() or None
                local = (rec.get("local-id") or rec.get("local-ts") or "")
                peer = (rec.get("remote-id") or rec.get("peer-id") or "")
                vpn_ip = None
                # Tunnel-IP steht meist in phase2/local-ts — best effort
                for f in ("local-ts", "remote-ts"):
                    v = str(rec.get(f, "") or "")
                    if v and v.split("/")[0].count(".") == 3 and not v.startswith("0.0.0.0"):
                        vpn_ip = v.split("/")[0].strip()
                        break
                try:
                    d = Device.from_raw(self.source_id, mac=None, ip=vpn_ip,
                                        hostname=name, active=connected if rec.get("connected") is not None else None,
                                        address_source="vpn", interface_type="ipsec",
                                        area_hint="vpn",
                                        raw={"vpn_type": "ipsec", "peer": str(peer)[:120],
                                             "phase1desc": rec.get("phase1desc")})
                except SourceError:
                    continue
                d._caps = frozenset(self.capabilities)
                sightings.append(d)
                ipsec_sessions.append(rec)
            if ipsec_sessions:
                branches["ipsec"] = ipsec_sessions
        except SourceError:
            pass  # ipsec nicht vorhanden

        return sightings, branches

def fetch_topology(self, cfg: dict, key: str = None, secret: str = None) -> dict:
        c = self._cfg_with_secrets(cfg, key or cfg.get("_key", ""), secret or cfg.get("_secret", ""))
        hints = {"gateway_ip": None, "uplink_interface": None, "areas": []}
        try:
            ifaces, _ = self._request(c, "/api/diagnostics/interface/getInterfaces",
                                      timeout=PROBE_TIMEOUT)
            rows = ifaces if isinstance(ifaces, list) else ifaces.get("rows", []) or []
            for row in rows:
                kind = "lan"
                descr = str(row.get("descr", "")).lower()
                if "wan" in descr:
                    kind = "wan"
                    hints["uplink_interface"] = row.get("intf") or descr
                elif "guest" in descr:
                    kind = "guest"
                elif "iot" in descr or "smarthome" in descr:
                    kind = "iot"
                elif "vpn" in descr:
                    kind = "vpn"
                cidr = row.get("ipaddr") or row.get("ipaddr_v4") or ""
                if cidr and "/" in str(cidr):
                    hints["areas"].append({"interface": row.get("intf") or descr,
                                           "cidr": str(cidr), "kind": kind})
        except SourceError:
            pass
        return hints
