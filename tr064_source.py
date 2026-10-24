"""Zentrix FRITZ!Box adapter — TR-064/SOAP (Phase 4, spec §7; AVM GUI-Map verifiziert).

Transport: SOAP/XML über HTTP Port 49000 (oder HTTPS 49443), Auth: HTTP-Digest
(stdlib HTTPDigestAuthHandler — dasselbe Verfahren wie `curl --digest`).
Quellen (verifiziert gegen tr64desc.xml / AVM-Schnittstellen-Doku):
  POST /upnp/control/hosts        Hosts:1  X_AVM-DE_GetHostListPath → Lua-/XML-Pfad
  GET  <hostlist-path>            gesamte Geräte-Liste (XML) — vom Box-Host holen!
  POST /upnp/control/hosts        Hosts:1  GetHostNumberOfEntries (Probe, keine Rechte)
  POST /upnp/control/wanpppconn   WANPPPConnection:1 GetInfo → NewExternalIPAddress
  POST /upnp/control/lanconfigsec LANConfigSecurity:1 GetInfo → NewLANIPAddress
Fallback (kein X_AVM-DE): GetGenericHostEntry(i) bis SOAP-Fault (=Tabellenende).

Stdlib only (urllib + digest + xml.etree). Read-only (A1). Credentials never in
errors (A2). FRITZ!Box-Hosts dedupliziert pro MAC via Merge (Mesh-Repeater).
"""
import base64  # noqa: F401  (kept for parity with opnsense adapter; not used)
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from net_sources import Device, SourceError, norm_ip, norm_mac

PROBE_TIMEOUT = 5.0
FETCH_TIMEOUT = 15.0

SOAP_ENV = ('<?xml version="1.0" encoding="utf-8"?>'
            '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"'
            ' xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'
            '<s:Body><u:{action} xmlns:u="urn:dslforum-org:service:{service}">'
            '{args}</u:{action}></s:Body></s:Envelope>')


class Tr064Source:
    source_id = "tr064"
    display_name = "FRITZ!Box (TR-064)"
    capabilities = frozenset({"CAP_ARP", "CAP_DHCP_LEASES", "CAP_ACTIVE_STATE",
                              "CAP_INTERFACE_TYPE", "CAP_TOPOLOGY"})

    def __init__(self, timeout_connect: float = PROBE_TIMEOUT):
        self.timeout_connect = timeout_connect

    # -- transport -----------------------------------------------------------
    def _open(self, cfg, url, data=None, headers=None, timeout=FETCH_TIMEOUT):
        """Open via digest-aware opener (FRITZ!OS: HTTP Digest, no Basic)."""
        user = str(cfg.get("_user", "") or "")
        pw = str(cfg.get("_password", "") or "")
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        if user and pw:
            parsed = urllib.parse.urlparse(url)
            mgr.add_password(None, f"{parsed.scheme}://{parsed.netloc}", user, pw)
        opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(mgr))
        req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        t0 = time.monotonic()
        try:
            with opener.open(req, timeout=timeout) as resp:
                return resp.read(), (time.monotonic() - t0) * 1000
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SourceError("auth", "FRITZ!Box rejected credentials (HTTP %d)" % e.code)
            if e.code == 404:
                raise SourceError("format", "FRITZ!Box endpoint not found: %s" % url)
            raise SourceError("unreachable", "FRITZ!Box HTTP %s" % e.code)
        except urllib.error.URLError as e:
            raise SourceError("unreachable", "FRITZ!Box not reachable (%s)" % e.reason)
        except TimeoutError:
            raise SourceError("timeout", "FRITZ!Box request timed out")
        except OSError:
            raise SourceError("unreachable", "FRITZ!Box connection failed")

    def _soap(self, cfg, ctrl, action, service, args_xml="", timeout=FETCH_TIMEOUT):
        url = str(cfg.get("url", "")).rstrip("/") + "/upnp/control/" + ctrl
        if not cfg.get("url"):
            raise SourceError("config", "FRITZ!Box URL is not configured")
        body = (SOAP_ENV.format(action=action, service=service, args=args_xml)).encode()
        headers = {
            "Content-Type": 'text/xml; charset="utf-8"',
            "SoapAction": "urn:dslforum-org:service:%s#%s" % (service, action),
        }
        raw, _ = self._open(cfg, url, data=body, headers=headers, timeout=timeout)
        return raw

    def _soap_val(self, raw, tag):
        """Extract text of first <u:Tag> from a SOAP response (namespace-agnostic)."""
        try:
            root = ET.fromstring(raw)
        except ET.ParseError:
            raise SourceError("format", "FRITZ!Box SOAP answer not parseable")
        for el in root.iter():
            if el.tag.split("}")[-1] == tag:
                return (el.text or "").strip()
        return None

    def _base_url(self, cfg):
        url = str(cfg.get("url", "")).strip()
        if not url:
            raise SourceError("config", "FRITZ!Box URL is not configured")
        if url.startswith("http://fritz.box"):
            url = url.replace("http://fritz.box", "http://169.254.1.1")  # never — keep host
        return url.rstrip("/")

    # -- probe (Verbindung testen) --------------------------------------------
    def probe(self, cfg, user=None, password=None):
        c = dict(cfg)
        c["_user"] = user or cfg.get("_user", "") or cfg.get("user", "")
        c["_password"] = password or cfg.get("_password", "")
        t0_probe = time.monotonic()
        raw = self._soap(c, "hosts", "GetHostNumberOfEntries", "Hosts:1",
                         timeout=PROBE_TIMEOUT)
        latency = (time.monotonic() - t0_probe) * 1000
        count = self._soap_val(raw, "NewHostNumberOfEntries")
        model = None
        try:
            desc_raw, _ = self._open(c, self._base_url(c) + "/tr64desc.xml",
                                     timeout=PROBE_TIMEOUT)
            m = re.search(rb"<modelName>([^<]+)</modelName>", desc_raw)
            if m:
                model = m.group(1).decode("utf-8", "replace").strip()
        except SourceError:
            pass  # Modellbezeichnung optional
        try:
            n = int(count) if count not in (None, "") else 0
        except ValueError:
            n = 0
        return {"ok": True, "reachable": True, "authenticated": True,
                "device_count": n, "latency_ms": round(latency),
                "router_model": model, "error_code": None}

    # -- devices (Hosts) -------------------------------------------------------
    def fetch_devices(self, cfg, user=None, password=None):
        """Hosts:1 — bevorzugt X_AVM-DE_GetHostListPath (1 Request), Fallback
        GetGenericHostEntry(i) bis SOAP-Fault. Dedupe pro MAC (Mesh-Wiederholung)."""
        c = dict(cfg)
        c["_user"] = user or cfg.get("_user", "") or cfg.get("user", "")
        c["_password"] = password or cfg.get("_password", "")
        devices = []
        seen = set()
        try:
            rows = self._fetch_hostlist_xml(c)
        except SourceError as e:
            if e.code not in ("format", "auth"):
                raise
            rows = self._fetch_generic_entries(c)
        for row in rows:
            mac = norm_mac(row.get("mac"))
            ip = norm_ip(row.get("ip"))
            if not mac and not ip:
                continue
            dedup_key = mac or ("ip:" + ip)
            if dedup_key in seen:
                continue  # Mesh-Repeater melden Geräte mehrfach (spec §7)
            seen.add(dedup_key)
            active = row.get("active")
            addr_src = row.get("addr_src")
            lease = row.get("lease_s")
            ifc_type = row.get("ifc_type")
            devices.append(Device.from_raw(
                self.source_id,
                mac=mac,
                ip=ip,
                hostname=row.get("hostname"),
                active=active if active is None else bool(active),
                address_source=addr_src,
                lease_remaining_s=int(lease) if lease not in (None, "") else None,
                interface_type=ifc_type,
                area_hint="guest" if row.get("guest") else None,
                raw={"if_descr": "Guest" if row.get("guest") else None,
                     "man": None,
                     "type": addr_src,
                     "fritzbox": True},
            ))
        # Lease-Details: nur für AKTIVE Hosts per GetSpecificHostEntry nachziehen
        # (die Lua-Bulk-Liste liefert keine AddressSource/LeaseTimeRemaining;
        # 1 Request pro aktivem Host — Martins Entscheidung 10/2026).
        for d in devices:
            if d.active is not True or not d.mac:
                continue
            try:
                raw = self._soap(c, "hosts", "GetSpecificHostEntry", "Hosts:1",
                                 args_xml="<NewMACAddress>%s</NewMACAddress>" % d.mac.upper(),
                                 timeout=PROBE_TIMEOUT)
                addr_src = (self._soap_val(raw, "NewAddressSource") or "").strip().lower() or None
                lease_s = self._soap_val(raw, "NewLeaseTimeRemaining")
                ifc = _map_ifc_type(self._soap_val(raw, "NewInterfaceType") or "")
                if addr_src:
                    d.address_source = addr_src
                    if isinstance(d.raw, dict):
                        d.raw["type"] = addr_src
                if lease_s and str(lease_s).isdigit():
                    d.lease_remaining_s = int(lease_s)
                if ifc and not d.interface_type:
                    d.interface_type = ifc
            except SourceError:
                continue  # einzelner Host darf scheitern (Poll bleibt stabil)
        # area_hint=None → Merge/Subnetz-Zuordnung übernimmt (LAN-Subnetz)
        return devices

    def _fetch_hostlist_xml(self, c):
        """X_AVM-DE_GetHostListPath → URL-String → XML laden (vom Box-Host)."""
        raw = self._soap(c, "hosts", "X_AVM-DE_GetHostListPath", "Hosts:1")
        path = self._soap_val(raw, "NewX_AVM-DE_HostListPath")
        if not path:
            raise SourceError("format", "FRITZ!Box: no host list path")
        xml_raw, _ = self._open(c, self._base_url(c) + path, timeout=FETCH_TIMEOUT)
        try:
            root = ET.fromstring(xml_raw)
        except ET.ParseError:
            raise SourceError("format", "FRITZ!Box host list not parseable")
        rows = []
        for item in root.iter():
            if item.tag.split("}")[-1] != "Item":
                continue
            def gv(tag):
                for el in item.iter():
                    t = el.tag.split("}")[-1]
                    if t == tag and el.text:
                        return el.text.strip()
                return ""
            rows.append({
                "ip": gv("IPAddress"),          # FRITZ!OS: <IPAddress> (camelCase!)
                "mac": gv("MACAddress"),
                "hostname": gv("HostName") or gv("X_AVM-DE_FriendlyName") or None,
                "active": gv("Active") in ("1", "true"),
                "addr_src": gv("AddressSource").lower() or None,
                "lease_s": int(gv("LeaseTimeRemaining")) if gv("LeaseTimeRemaining").isdigit() else None,
                "ifc_type": _map_ifc_type(gv("InterfaceType")),
                "guest": gv("X_AVM-DE_Guest") in ("1", "true"),
            })
        if not rows:
            raise SourceError("format", "FRITZ!Box host list empty")
        return rows

    def _fetch_generic_entries(self, c):
        """Fallback: GetGenericHostEntry(i) — SOAP-Fault = Tabellenende (normal!)."""
        rows = []
        for i in range(0, 256):
            try:
                raw = self._soap(c, "hosts", "GetGenericHostEntry", "Hosts:1",
                                 args_xml="<NewIndex>%d</NewIndex>" % i)
            except SourceError as e:
                if e.code == "format":
                    break  # Index > Anzahl → Ende (erwartet)
                raise
            host = {
                "ip": (self._soap_val(raw, "NewIPAddress") or ""),
                "mac": (self._soap_val(raw, "NewMACAddress") or ""),
                "hostname": (self._soap_val(raw, "NewHostName") or None),
                "active": self._soap_val(raw, "NewActive") in ("1", "true"),
                "addr_src": (self._soap_val(raw, "NewAddressSource") or "").lower() or None,
                "lease_s": None,
                "ifc_type": _map_ifc_type(self._soap_val(raw, "NewInterfaceType") or ""),
                "guest": False,
            }
            if not host["ip"] and not host["mac"]:
                break
            rows.append(host)
        return rows

    # -- topology hints (Interfaces + WAN) -------------------------------------
    def fetch_interfaces(self, cfg, user=None, password=None):
        """Spine für die Topologie: LAN (LANConfigSecurity GetInfo → NewLANIPAddress)
        + WAN (WANPPPConnection GetInfo → NewExternalIPAddress)."""
        c = dict(cfg)
        c["_user"] = user or cfg.get("_user", "") or cfg.get("user", "")
        c["_password"] = password or cfg.get("_password", "")
        out = []
        base = None
        try:
            raw = self._soap(c, "lanconfigsecurity", "GetInfo", "LANConfigSecurity:1")
            base = self._soap_val(raw, "NewLANIPAddress")
        except SourceError:
            pass
        if base:
            out.append({"name": "lan", "descr": "LAN",
                        "ipaddr": base + "/24", "kind": "lan"})
        try:
            raw = self._soap(c, "wanpppconn", "GetInfo", "WANPPPConnection:1")
            ext = self._soap_val(raw, "NewExternalIPAddress")
            if ext:
                out.append({"name": "wan", "descr": "WAN",
                            "ipaddr": ext, "kind": "wan"})
        except SourceError:
            pass
        return out


def _map_ifc_type(v):
    """FRITZ!OS InterfaceType → zentrix interface_type (spec §7)."""
    v = (v or "").strip().lower()
    if "802.11" in v or "wlan" in v:
        return "wifi"
    if "ethernet" in v:
        return "ethernet"
    if "homeplug" in v or "powerline" in v:
        return "homeplug"
    return v or None
