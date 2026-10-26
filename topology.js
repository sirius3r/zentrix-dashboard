/* Zentrix Topology View — Phase 1 (aggregate graph + device list + detail).
   Zero dependencies. Fetches /api/topology/devices (30 s poll), renders the
   aggregate graph (core → area clusters) on canvas, devices in a virtualized
   list. German/English labels via ZENTRIX_I18N (topo_* keys). */
(function () {
  "use strict";
  const TOPO_JS_VERSION = "1.12.0-alpha";  /* visible in settings pane for cache debugging */
  const $ = (s) => document.querySelector(s);
  const VIEW = $("#topology-view");
  const CANVAS = $("#topo-canvas");
  const LIST = $("#topo-table");
  const DETAIL = $("#topo-detail");
  let open = false;
  let data = { devices: [], sources: {} };
  let filter = { mode: "all", area: "", vendor: "" };
  let selectedKey = null;
  let expandedArea = null;   // area_hint currently expanded in list focus
  let timer = null;
  const sourcesSeen = {};    // per-device source badges come from snapshot

  /* ---------------- helpers ---------------- */
  function t(key, fallback) {
    try {
      const s = window.ZENTRIX_I18N && window.ZENTRIX_I18N.strings;
      const lang = document.documentElement.lang || "de";
      if (s && s[lang] && s[lang][key]) return s[lang][key];
      const def = window.ZENTRIX_I18N && window.ZENTRIX_I18N.default;
      if (s && s[def] && s[def][key]) return s[def][key];
    } catch (e) {}
    return fallback;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }

  /* ---------------- data ---------------- */
  async function refresh() {
    try {
      const res = await fetch("/api/topology/devices", { headers: { "Cache-Control": "no-store" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
      renderStatus();
      renderList();
      await loadTopologyView();
      if (open) drawGraph();
    } catch (e) {
      $("#topo-status").textContent = "offline — " + e.message;
    }
  }

  function areaOf(d) {
    if (d.address_source === "vpn" || (d.raw && d.raw.vpn_type)) {
      const t = (d.raw && d.raw.vpn_type) || d.interface_type || "vpn";
      return "VPN · " + (t === "wireguard" ? "WireGuard" : t === "openvpn" ? "OpenVPN" : t === "ipsec" ? "IPsec" : t);
    }
    return d.area_hint || (d.ip ? d.ip.split(".").slice(0, 3).join(".") + ".0/24" : "?");
  }
  function deviceKey(d) { return d.mac || ("ip:" + d.ip); }
  function activeState(d) { return d.active === true ? "online" : (d.active === false ? "offline" : "unknown"); }

  /* Anzeigenamen für Quellen (source_id → lesbar, Martins Wunsch 10/2026) */
  const SRC_NAMES = { opnsense: "OPNsense", tr064: "Fritz!Box", mdns: "mDNS" };
  function srcName(id) { return SRC_NAMES[id] || id; }

  /* ---------------- status strip ---------------- */
  function renderStatus() {
    const srcs = data.sources || {};
    const parts = [];
    for (const [sid, s] of Object.entries(srcs)) {
      const flag = s.enabled ? (s.degraded || s.last_error ? "⚠" : "●") : "○";
      parts.push(flag + " " + srcName(sid));
    }
    const n = data.devices.length;
    const on = data.devices.filter((d) => d.active !== false).length;
    const bits = [];
    bits.push(n + " " + t("topo_mb_count", "Geräte"));
    bits.push(on + " " + t("topo_d_online", "online"));
    if (parts.length) bits.push(parts.join(" "));
    const st = $("#topo-status");
    st.textContent = bits.join(" · ");
    st.title = (data.sources && Object.values(data.sources).some((s) => s.last_error))
      ? Object.entries(data.sources).filter(([, s]) => s.last_error).map(([k, s]) => k + ": " + s.last_error).join("\n")
      : "";
  }

  /* ---------------- device list ---------------- */
  function leaseLabel(d) {
    if (d.address_source === "static") return t("topo_d_lt_static", "statisch");
    if (d.address_source === "dhcp") return "DHCP";
    if (d.address_source === "vpn" || (d.raw || {}).vpn_type) {
      const t = (d.raw || {}).vpn_type || d.interface_type || "vpn";
      return t.toUpperCase();
    }
    return "—";
  }
  let textFilter = "";
  function filtered() {
    const q = textFilter.trim().toLowerCase();
    const arr = data.devices.filter((d) => {
      if (filter.mode === "online" && d.active !== true) return false;
      if (filter.area && areaOf(d) !== filter.area) return false;
      if (filter.vendor && (d.vendor || "?") !== filter.vendor) return false;
      if (q) {
        /* substring match over ip, mac, hostname, lease type/address_source, vendor */
        const hay = [d.ip, d.mac, d.hostname, d.address_source, d.vendor,
                     d.interface_type, areaOf(d)]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    function ipKey(ip) {
      if (!ip) return 0;
      const p = String(ip).split(".").map(Number);
      return p.length === 4 ? (p[0] << 24) + (p[1] << 16) + (p[2] << 8) + p[3] : 0;
    }
    arr.sort((a, b) => (areaOf(a) < areaOf(b) ? -1 : areaOf(a) > areaOf(b) ? 1
      : (a.active === b.active ? (ipKey(a.ip) - ipKey(b.ip) || String(a.hostname || a.ip).localeCompare(String(b.hostname || b.ip)))
        : a.active === true ? -1 : 1)));
    return arr;
  }

  function renderList() {
    const arr = filtered();
    const groups = new Map();
    for (const d of arr) {
      const a = areaOf(d);
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(d);
    }
    const rows = [];
    if (textFilter.trim()) {
      rows.push(`<div class="topo-row topo-group-row"><span class="c-st">⌕</span>` +
        `<span class="c-host">${arr.length} ${t("topo_mb_count", "Geräte")} ${t("topo_of", "von")} ${data.devices.length} — „${esc(textFilter.trim())}“</span>` +
        `<span class="c-ip"></span><span class="c-mac"></span><span class="c-lease"></span><span class="c-vendor"></span><span class="c-src"></span></div>`);
    }
    rows.push(`<div class="topo-row topo-head-row"><span class="c-st">${esc(t("topo_col_st", "ST"))}</span><span class="c-host">${esc(t("topo_col_host", "HOSTNAME"))}</span>` +
      `<span class="c-ip">${esc(t("topo_col_ip", "IP"))}</span><span class="c-mac">${esc(t("topo_col_mac", "MAC"))}</span><span class="c-lease">LEASE</span><span class="c-vendor">${esc(t("topo_col_vendor", "HERSTELLER"))}</span><span class="c-src">${esc(t("topo_col_src", "QUELLEN"))}</span></div>`);
    for (const [area, devs] of groups) {
      const on = devs.filter((d) => d.active !== false).length;
      rows.push(`<div class="topo-row topo-group-row" data-area="${esc(area)}"><span class="c-st">▸</span>` +
        `<span class="c-host">${esc(area)} — ${devs.length} ${t("topo_mb_count", "Geräte")} · ${on} ${t("topo_d_online", "online")}</span>` +
        `<span class="c-ip"></span><span class="c-mac"></span><span class="c-lease"></span><span class="c-vendor"></span><span class="c-src"></span></div>`);
      for (const d of devs) {
        const k = deviceKey(d);
        const online = d.active === true;
        const srcs = ((d.sources || [])).map(srcName).join("·");
        rows.push(`<div class="topo-row${online ? "" : " offline"}${k === selectedKey ? " selected" : ""}" data-key="${esc(k)}">` +
          `<span class="c-st"><span class="dot${online ? "" : " off"}"></span></span>` +
          `<span class="c-host">${esc(d.hostname || (d.vendor ? d.vendor + " (" + t("topo_no_host", "kein Hostname") + ")" : null) || d.ip || "(" + t("topo_d_unknown", "unbekannt") + ")")}</span>` +
          `<span class="c-ip">${esc(d.ip || "—")}</span>` +
          `<span class="c-mac">${esc(d.mac || "—")}</span>` +
          `<span class="c-lease">${esc(leaseLabel(d))}</span>` +
          `<span class="c-vendor">${esc(d.vendor || "?")}</span>` +
          `<span class="c-src">${esc(srcs || "—")}</span></div>`);
      }
    }
    LIST.innerHTML = rows.join("");
    // fill vendor + area selects once
    const areas = [...new Set(data.devices.map(areaOf))].sort();
    const vendors = [...new Set(data.devices.map((d) => d.vendor || "?"))].sort();
    fillSelect($("#topo-f-area"), areas, t("topo_area_all", "bereich: alle"), filter.area);
    fillSelect($("#topo-f-vendor"), vendors, t("topo_vendor_all", "hersteller: alle"), filter.vendor);
    $("#topo-n-all").textContent = String(data.devices.length);
  }

  function fillSelect(sel, items, placeholder, current) {
    const prev = sel.value;
    sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
      items.map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`).join("");
    sel.value = current || "";
  }

  function closeDetail() { DETAIL.style.display = "none"; }
  function showDetail(key) {
    const d = data.devices.find((x) => deviceKey(x) === key);
    if (!d) { closeDetail(); return; }
    const isVpn = d.address_source === "vpn" || (d.raw || {}).vpn_type;
    const lease = d.lease || {};
    const kv = [
      [t("topo_d_ipmac", "IP / MAC"), `${d.ip || "—"} · ${d.mac || "—"}`],
      [t("topo_d_host", "Hostname"), d.hostname || t("topo_d_host_none", "— (keine DHCP-Lease am Router)")],
      [t("topo_d_vendor", "Hersteller"), d.vendor ? d.vendor + " " + t("topo_d_vendor_oui", "(OUI)") : (lease.man || t("topo_d_unknown", "unbekannt"))],
      [t("topo_d_status", "Status"), d.active === true ? t("topo_d_online", "online") : d.active === false ? t("topo_d_offline", "offline") : t("topo_d_unknown", "unbekannt")],
      [t("topo_d_sources", "Quellen"), (d.sources || []).map(srcName).join(", ") || "—"],
      [t("topo_d_conf", "Konfidenz"), Math.round((d.confidence || 0) * 100) + " %"],
      [t("topo_d_seen", "Letzte Sichtung"), d.age_s != null ? (d.age_s < 90
        ? t("topo_d_ago_s", "vor {n} s").replace("{n}", d.age_s)
        : t("topo_d_ago_min", "vor {n} min").replace("{n}", Math.round(d.age_s / 60))) : "—"],
      /* Lease-Infos IMMER sichtbar (— bei statischen Geräten ohne Lease) */
      [t("topo_d_leasetype", "Lease-Typ"), d.address_source === "vpn" ? t("topo_d_lt_vpn", "VPN (Tunnel-IP)")
        : d.address_source === "static" ? t("topo_d_lt_static", "statisch")
        : d.address_source === "dhcp" ? t("topo_d_lt_dhcp", "dynamisch (DHCP)") : "—"],
      [t("topo_d_leasewin", "Lease-Zeitraum"), lease.starts || lease.ends ? `${lease.starts || "?"} — ${lease.ends || t("topo_d_openend", "offen")}` : "—"],
      [t("topo_d_leaseleft", "Lease-Restzeit"), d.lease_remaining_s != null ? Math.round(d.lease_remaining_s / 60) + " min" : "—"],
      [t("topo_d_routerif", "Router-Interface"), lease.if_descr || "—"],
    ];
    if (lease.descr) kv.push([t("topo_d_descr", "Beschreibung (Router)"), lease.descr]);
    if (d.interface_type) kv.push([t("topo_d_interface", "Interface"), d.interface_type]);
    const raw = d.raw || {};
    const vpn = d.vpn || {};
    if (vpn.vpn_type === "wireguard" || (raw.vpn_type === "wireguard")) {
      const hsTs = vpn.handshake_ts ?? raw.handshake_ts ?? null;
      let hsVal = vpn.handshake || raw.handshake || "";
      if (hsTs) {
        const ago = Math.max(0, Math.floor(Date.now() / 1000 - Number(hsTs)));
        const agoStr = ago < 90 ? t("topo_d_ago_s", "vor {n} s").replace("{n}", ago)
          : ago < 86400 ? t("topo_d_ago_min", "vor {n} min").replace("{n}", Math.round(ago / 60))
          : t("topo_d_ago_d", "vor {n} d").replace("{n}", Math.round(ago / 86400));
        hsVal = hsVal ? hsVal + " · " + agoStr : agoStr;
      }
      if (!hsVal) hsVal = t("topo_d_never", "nie");
      kv.push([t("topo_d_wg_hs", "WireGuard Handshake"), hsVal]);
      const rx = vpn["transfer-rx"] ?? raw["transfer-rx"];
      const tx = vpn["transfer-tx"] ?? raw["transfer-tx"];
      if (rx != null) kv.push([t("topo_d_wg_rx", "WireGuard RX"), Math.round(rx / 1048576) + " MB"]);
      if (tx != null) kv.push([t("topo_d_wg_tx", "WireGuard TX"), Math.round(tx / 1048576) + " MB"]);
    }
    if (vpn.vpn_type === "openvpn" || (raw.vpn_type === "openvpn")) {
      kv.push([t("topo_d_ovpn_since", "Verbunden seit"), vpn.connected_since || raw.connected_since || "—"]);
      kv.push([t("topo_d_ovpn_real", "Real-Adresse"), vpn.real_address || raw.real_address || "—"]);
    }
    if (vpn.vpn_type === "ipsec" || (raw.vpn_type === "ipsec")) kv.push([t("topo_d_ipsec_peer", "IPsec Peer"), vpn.peer || raw.peer || "—"]);
    function safeHref(name) {
      const n = String(name || "").trim();
      if (!n) return "";
      if (/^https:\/\//i.test(n) || /^http:\/\//i.test(n)) return n;
      return "http://" + n;
    }
    const titleName = d.hostname || d.ip || "";
    const titleHref = safeHref(d.hostname || d.ip);
    DETAIL.innerHTML = `<div class="topo-detail-inner"><div class="topo-detail-head"><h4>` +
      (titleHref
        ? `<a class="topo-host-link" href="${esc(titleHref)}" target="_blank" rel="noopener noreferrer"` +
          ` title="${esc(t("topo_open_new_tab", "In neuem Tab öffnen"))}">${esc(titleName)}</a>`
        : esc(titleName)) +
      (isVpn ? ` <span class="topo-vpn-tag">${esc((raw.vpn_type || "vpn").toUpperCase())}</span>` : "") +
      `</h4><button class="btn icon-btn" id="topo-detail-close" title="${esc(t("topo_close", "Schließen"))}">✕</button></div>` +
      `<div class="kv">` + kv.filter(Boolean).map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join("") + `</div></div>`;
    DETAIL.style.display = "flex";
    const c = document.getElementById("topo-detail-close");
    if (c) c.addEventListener("click", closeDetail);
  }

  /* ---------------- aggregate graph (canvas) ---------------- */
  let graphData = { areas: [], interfaces: [], vpn: {} };
  async function loadTopologyView() {
    try {
      const res = await fetch("/api/topology/view", { headers: { "Cache-Control": "no-store" } });
      if (!res.ok) return;
      const view = await res.json();
      graphData.interfaces = view.interfaces || [];
      graphData.source = view.source || null;
      graphData.public_ip = view.public_ip || null;
      graphData.vpn = view.vpn || { branches: {}, devices: [] };
      if (open) drawGraph();
      renderVpnDevices();
    } catch (e) {}
  }
  function computeGraph() {
    const areas = new Map();
    for (const d of data.devices) {
      const a = areaOf(d);
      if (!areas.has(a)) areas.set(a, { name: a, total: 0, online: 0 });
      areas.get(a).total++;
      if (d.active === true) areas.get(a).online++;
    }
    graphData.areas = [...areas.values()].sort((x, y) => y.total - x.total);
    if (!graphData.interfaces) graphData.interfaces = [];
    if (!graphData.vpn) graphData.vpn = { branches: {}, devices: [] };
    buildPairs();
  }

  /* Interface ↔ Bereich zuordnen (Subnetz-Match) und beide aufsteigend nach IP sortieren.
     Zeile i = Interface i + SEIN Bereich — nicht mehr Position i aus zwei getrennten Listen. */
  function ipNetKey(ipaddr) {
    /* "192.168.60.1/24" → "192.168.60" (Subnetz-Basis), VPN 10.100.0.1/24 → "10.100.0" */
    if (!ipaddr) return "";
    const m = ipaddr.match(/^(\d+\.\d+\.\d+)\.\d+(\/\d+)?$/);
    return m ? m[1] : ipaddr.split("/")[0];
  }
  function ipSortKey(ifc) {
    const ip = (ifc.ipaddr || "").split("/")[0].split(".").map(Number);
    return (ip[0] || 999) * 16777216 + (ip[1] || 0) * 65536 + (ip[2] || 0) * 256 + (ip[3] || 0);
  }
  function buildPairs() {
    const ifs = (graphData.interfaces || []).slice().sort((a, b) => ipSortKey(a) - ipSortKey(b));
    /* Bereichs-Name pro Subnetz: aus den Geräten (area_hint) ableiten */
    const netToArea = new Map();
    for (const d of data.devices) {
      const net = ipNetKey(d.ip || "");
      if (!net) continue;
      const a = areaOf(d);
      if (a.startsWith("VPN ·")) continue; /* VPN-Geräte hängen am VPN-Interface */
      const prev = netToArea.get(net);
      if (!prev || a.length < prev.length) netToArea.set(net, a); /* kürzester Name = sprechendster */
    }
    const used = new Set();
    const pairs = [];
    for (const ifc of ifs) {
      const net = ipNetKey(ifc.ipaddr);
      let area = null;
      const cand = net ? netToArea.get(net) : null;
      if (cand) { area = graphData.areas.find((x) => x.name === cand); used.add(cand); }
      /* VPN-Interface: direkte Paarung mit dem VPN-Bereich (Typ-Match, kein Subnetz) */
      if (!area && ifc.kind === "vpn") {
        const vpnAreas = graphData.areas.filter((x) => x.name.startsWith("VPN ·") && !used.has(x.name));
        const low = (ifc.descr || ifc.name || "").toLowerCase();
        area = vpnAreas.find((x) => {
          const t = x.name.toLowerCase();
          return (low.includes("wireguard") && t.includes("wireguard"))
              || (low.includes("openvpn") && t.includes("openvpn"))
              || (low.includes("ipsec") && t.includes("ipsec"));
        }) || vpnAreas[0] || null;
        if (area) used.add(area.name);
      }
      pairs.push({ ifc, area });
    }
    /* Bereiche ohne zugeordnetes Interface (z.B. VPN-Geräte oder subnet-fremde) anhängen */
    for (const a of graphData.areas) {
      if (!used.has(a.name)) pairs.push({ ifc: null, area: a });
    }
    graphData.pairs = pairs;
  }

    function drawGraph() {
    computeGraph();
    if (!graphData.areas.length && !(graphData.interfaces || []).length) return; /* noch keine Daten */
    const ctx = CANVAS.getContext("2d");
    const W = CANVAS.clientWidth || 600;
    /* Höhe = verfügbare Panel-Höhe (CSS stretch koppelt an das rechte Panel).
       clientHeight wird VOR dem Buffer-Setzen gemessen und das Element bekommt
       style.height = 100% (flex regelt) — kein Feedback-Loop, keine wachsende Panel-Höhe. */
    const H = Math.max(320, Math.round(CANVAS.clientHeight) || 320);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    CANVAS.width = W * dpr; CANVAS.height = H * dpr;
    CANVAS.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* Kein ctx.scale mehr: Font-Größen via fs-Faktor (kein Versatz/Abschneiden mehr) */
    const fs = W > 1400 ? Math.min(1.5, W / 1200) : 1;
    ctx.textBaseline = "alphabetic";
    /* Zeilenabstand dynamisch: alles (Interfaces + Bereiche) muss in H passen */
    const nRows = (graphData.interfaces || []).length + graphData.areas.length;
    const rowSpacing = nRows > 0 ? Math.min(70, Math.max(34, (H - 120) / Math.max(1, nRows))) : 60;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ink-1").trim() || "#e8ecf1";
    const ink3 = css.getPropertyValue("--ink-3").trim() || "#5c6673";
    const accent = css.getPropertyValue("--accent").trim() || "#4ee1a0";
    const blue = "#7d8cff";
    const line = css.getPropertyValue("--line").trim() || "#262c37";
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${12*fs}px 'JetBrains Mono', monospace`;

    const ifs = graphData.interfaces || [];
    /* CORE: aktiver Router (Name nach Quelle) — ohne Quelle kein Core */
    const coreName = { opnsense: "OPNsense", tr064: "Fritz!Box" }[graphData.source] || "Gateway";
    if (!graphData.source || !ifs.length) {
      ctx.fillStyle = ink3; ctx.font = `${11*fs}px 'JetBrains Mono', monospace`;
      ctx.fillText(t("topo_no_router", "Kein Router konfiguriert — Quelle in den Optionen aktivieren"), 20, 50);
      ctx.fillStyle = ink3; ctx.font = `${10*fs}px 'JetBrains Mono', monospace`;
      ctx.fillText(t("topo_footer", "Auto-Poll 30 s · Quelle: OPNsense-API (Interfaces, Leases, VPN, mDNS passiv)")
      .replace("OPNsense-API", srcName(graphData.source || "opnsense")), 20, H - 12);
      return;
    }
    const core = { x: 20, y: 30, w: 210, h: 66 };
    roundRect(ctx, core.x, core.y, core.w, core.h, 10, accent, 1.4);
    ctx.fillStyle = accent; ctx.fillText("// CORE", core.x + 12, core.y + 20);
    ctx.fillStyle = ink; ctx.font = `bold ${13*fs}px 'JetBrains Mono', monospace`;
    ctx.fillText(coreName, core.x + 12, core.y + 40);
    ctx.font = `${11*fs}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = ink3;
    ctx.fillText((ifs.length || "?") + " " + t("topo_n_if", "Interfaces") + " · " + graphData.areas.length + " " + t("topo_n_areas", "Bereiche"), core.x + 12, core.y + 56);

    /* Zeilen = Paare (Interface + SEIN Bereich), aufsteigend nach IP-Bereich sortiert */
    const firstIfY = core.y + core.h + 24;
    let y = firstIfY;
    const pairs = graphData.pairs || [];
    for (const p of pairs) {
      const ifc = p.ifc;
      if (ifc) {
        const box = { x: 20, y, w: 240, h: 34 };
        roundRect(ctx, box.x, box.y, box.w, box.h, 10, accent + "cc", 1.2);
        ctx.fillStyle = ifc.kind === "vpn" ? blue : accent;
        ctx.fillText(ifc.kind.toUpperCase(), box.x + 12, box.y + 14);
        ctx.fillStyle = ink; ctx.font = `bold ${11*fs}px 'JetBrains Mono', monospace`;
        ctx.fillText((ifc.descr || ifc.name).slice(0, 14), box.x + 58, box.y + 14);
        ctx.font = `${10*fs}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = ink3;
        const isWan = ifc.kind === "wan";
        const pubIp = graphData.public_ip || null;
        const line2 = isWan && pubIp
          ? (t("topo_public_ip", "Öffentliche IP") + ": " + pubIp)
          : (ifc.ipaddr || "—");
        ctx.fillText(line2.slice(0, 33), box.x + 12, box.y + 28);
        p._ifbox = box;
      }
      y += rowSpacing;
    }

        /* Bereichs-Cluster: TOP-ALIGNIERT mit dem ersten Interface-Chip, gleiche Zeilenhöhe;
       rechtsbündig gekoppelt (an den rechten Canvas-Rand), damit das Panel ausgeglichen gefüllt ist */
    const ax = Math.max(300, W - 238);
    let ay = firstIfY;
    for (const p of pairs) {
      /* Connector: Interface-Chip → Bereichs-Karte (paarweise, gleiche Zeile) */
      const ifb = p._ifbox;
      if (ifb) {
        ctx.strokeStyle = line; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ifb.x + ifb.w, ifb.y + 17);
        ctx.lineTo(ax, ay + 17);
        ctx.stroke();
      }
      const a = p.area;
      if (!a) { ay += rowSpacing; continue; }  /* Interface ohne Geräte → leere Zeile rechts */
      const box = { x: ax, y: ay, w: 210, h: 34 };
      roundRect(ctx, box.x, box.y, box.w, box.h, 10, accent + "88", 1.2);
      ctx.fillStyle = accent;
      ctx.fillText("// BEREICH", box.x + 12, box.y + 14);
      ctx.fillStyle = ink; ctx.font = `bold ${11*fs}px 'JetBrains Mono', monospace`;
      ctx.fillText(a.name.slice(0, 14), box.x + 92, box.y + 14);
      ctx.font = `${10*fs}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = ink3;
      ctx.fillText(a.online + "/" + a.total + " " + t("topo_d_online", "online") + " · " + t("topo_expand", "aufklappen"), box.x + 12, box.y + 28);
      ctx.beginPath(); ctx.arc(box.x + box.w - 20, box.y + 17, 10, 0, Math.PI * 2);
      ctx.fillStyle = accent + "30"; ctx.fill();
      ctx.fillStyle = accent; ctx.textAlign = "center"; ctx.fillText(String(a.total), box.x + box.w - 20, box.y + 21);
      ctx.textAlign = "left";
      a._box = box;
      ay += rowSpacing;
    }

        /* VPN-Zweige erscheinen als BEREICH-Karten (VPN · Typ) — keine doppelte Box. */

    ctx.fillText(t("topo_footer", "Auto-Poll 30 s · Quelle: OPNsense-API (Interfaces, Leases, VPN, mDNS passiv)"), 20, H - 12);
  }

function roundRect(ctx, x, y, w, h, r, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  /* ---------------- interactions ---------------- */
  CANVAS.addEventListener("click", (e) => {
    const rect = CANVAS.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const a of graphData.areas || []) {
      const b = a._box;
      if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        filter.area = a.name;   // expand = filter list to this area
        selectedKey = null;
        DETAIL.style.display = "none";
        renderList();
        return;
      }
    }
  });

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  DETAIL.addEventListener("click", (e) => { if (e.target === DETAIL) closeDetail(); });

  LIST.addEventListener("click", (e) => {
    const row = e.target.closest(".topo-row");
    if (!row) return;
    if (row.classList.contains("topo-group-row")) {
      const area = row.dataset.area;
      filter.area = filter.area === area ? "" : area;
      renderList();
      return;
    }
    const key = row.dataset.key;
    selectedKey = key;
    showDetail(key);
    LIST.querySelectorAll(".topo-row.selected").forEach((r) => r.classList.remove("selected"));
    row.classList.add("selected");
  });

  $("#topo-f-all").addEventListener("click", () => setFilterMode("all"));
  $("#topo-f-online").addEventListener("click", () => setFilterMode("online"));
  function setFilterMode(m) {
    filter.mode = m;
    $("#topo-f-all").classList.toggle("active", m === "all");
    $("#topo-f-online").classList.toggle("active", m === "online");
    renderList();
  }
  $("#topo-f-text").addEventListener("input", (e) => {
    textFilter = e.target.value;
    renderList();
  });
  $("#topo-f-text").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.target.value = ""; textFilter = ""; renderList(); }
  });
  $("#topo-f-area").addEventListener("change", (e) => { filter.area = e.target.value; renderList(); });
  $("#topo-f-vendor").addEventListener("change", (e) => { filter.vendor = e.target.value; renderList(); });

  /* ---------------- open/close ---------------- */
  function openView() {
    open = true;
    VIEW.style.display = "";
    $("#board").style.display = "none";
    document.querySelector(".searchwrap").style.display = "none";
    $("#no-results").style.display = "none";
    $("#btn-topology").classList.add("active");
    if (!timer) timer = setInterval(refresh, 30000);
    refresh().then(() => drawGraph());  // erst zeichnen, wenn Daten da sind
  }
  function closeView() {
    open = false;
    VIEW.style.display = "none";
    $("#board").style.display = "";
    document.querySelector(".searchwrap").style.display = "";
    $("#btn-topology").classList.remove("active");
    if (timer) { clearInterval(timer); timer = null; }
  }
  $("#btn-topology").addEventListener("click", () => (open ? closeView() : openView()));
  $("#btn-topo-close").addEventListener("click", closeView);
  $("#btn-topo-rescan").addEventListener("click", refresh);
  window.addEventListener("resize", () => { if (open) drawGraph(); });

  /* ---------------- settings pane wiring ---------------- */
  async function loadTopologyCfg() {
    try {
      const token = (window.ZENTRIX_GET_TOKEN && window.ZENTRIX_GET_TOKEN()) || "";
      const res = await fetch("/api/topology/sources", { headers: { "X-Auth-Token": token } });
      if (!res.ok) return;
      const cfg = await res.json();
      const o = cfg.opnsense || {};
      $("#set-topo-opnsense-url").value = o.url || "";
      $("#set-topo-opnsense-key").value = "";
      $("#set-topo-opnsense-key").placeholder = o.key_set ? "gesetzt (••••)" : "API-Key";
      $("#set-topo-opnsense-secret").value = "";
      $("#set-topo-opnsense-secret").placeholder = o.secret_set ? "gesetzt (••••)" : "API-Secret";
      const fb = cfg.tr064 || {};
      $("#set-topo-fb-url").value = fb.url || "";
      $("#set-topo-fb-user").value = fb.user || "";
      $("#set-topo-fb-password").value = "";
      $("#set-topo-fb-password").placeholder = fb.password_set ? "gesetzt (••••)" : "Passwort";
      $("#set-topo-mdns-enabled").checked = !!(cfg.mdns && cfg.mdns.enabled);
    } catch (e) {}
  }
  function getTokenLocal() {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.endsWith("-token"));
      return keys.length ? localStorage.getItem(keys[0]) : "";
    } catch (e) { return ""; }
  }
  window.ZENTRIX_GET_TOKEN = window.ZENTRIX_GET_TOKEN || getTokenLocal;

  $("#btn-topo-save").addEventListener("click", async () => {
    const token = (window.ZENTRIX_GET_TOKEN && window.ZENTRIX_GET_TOKEN()) || getTokenLocal();
    const url = $("#set-topo-opnsense-url").value.trim();
    const patch = {
      opnsense: {
        enabled: url !== "",          // URL leer = Quelle aus
        url: url,
        poll_s: 300,
      },
      mdns: { enabled: $("#set-topo-mdns-enabled").checked },
    };
    const fbUrl = $("#set-topo-fb-url").value.trim();
    patch.tr064 = {
      enabled: fbUrl !== "",
      url: fbUrl,
      user: $("#set-topo-fb-user").value.trim(),
      poll_s: 300,
    };
    const key = $("#set-topo-opnsense-key").value.trim();
    const secret = $("#set-topo-opnsense-secret").value.trim();
    if (key) patch.opnsense.key = key;
    if (secret) patch.opnsense.secret = secret;
    const fbPassword = $("#set-topo-fb-password").value.trim();
    if (fbPassword) patch.tr064.password = fbPassword;
    try {
      const res = await fetch("/api/topology/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Auth-Token": token },
        body: JSON.stringify(patch),
      });
      $("#topo-save-status").textContent = res.ok ? "✓ gespeichert" : "✗ Fehler (" + res.status + ")";
      setTimeout(() => ($("#topo-save-status").textContent = ""), 4000);
    } catch (e) {
      $("#topo-save-status").textContent = "✗ " + e.message;
    }
  });

  $("#btn-topo-opnsense-test").addEventListener("click", async () => {
    const token = (window.ZENTRIX_GET_TOKEN && window.ZENTRIX_GET_TOKEN()) || getTokenLocal();
    $("#topo-opnsense-status").textContent = "… teste";
    try {
      const res = await fetch("/api/topology/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": token },
        body: JSON.stringify({
          source: "opnsense",
          url: $("#set-topo-opnsense-url").value.trim(),
          key: $("#set-topo-opnsense-key").value.trim(),
          secret: $("#set-topo-opnsense-secret").value.trim(),
        }),
      });
      const r = await res.json();
      $("#topo-opnsense-status").textContent = r.ok
        ? `✓ ${r.router_model || "OPNsense"} · ${r.device_count} ${t("topo_mb_count", "Geräte")} · ${r.latency_ms} ms`
        : "✗ " + (r.message || r.error_code || "Fehler");
    } catch (e) {
      $("#topo-opnsense-status").textContent = "✗ " + e.message;
    }
    setTimeout(() => ($("#topo-opnsense-status").textContent = ""), 8000);
  });

  $("#btn-topo-fb-test").addEventListener("click", async () => {
    const token = (window.ZENTRIX_GET_TOKEN && window.ZENTRIX_GET_TOKEN()) || getTokenLocal();
    $("#topo-fb-status").textContent = "… teste";
    try {
      const res = await fetch("/api/topology/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": token },
        body: JSON.stringify({
          source: "tr064",
          url: $("#set-topo-fb-url").value.trim(),
          user: $("#set-topo-fb-user").value.trim(),
          secret: $("#set-topo-fb-password").value.trim(),
        }),
      });
      const r = await res.json();
      $("#topo-fb-status").textContent = r.ok
        ? `✓ ${r.router_model || "FRITZ!Box"} · ${r.device_count} ${t("topo_mb_count", "Geräte")} · ${r.latency_ms} ms`
        : "✗ " + (r.message || r.error_code || "Fehler");
    } catch (e) {
      $("#topo-fb-status").textContent = "✗ " + e.message;
    }
    setTimeout(() => ($("#topo-fb-status").textContent = ""), 8000);
  });

  // settings tab registration (same mechanism as immich tab)
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "tab-topology") {
      loadTopologyCfg();
      const hint = document.getElementById("topo-opnsense-status");
      
    }
  });
})();
