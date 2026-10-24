# Zentrix Homelab Dashboard

A lightweight homelab dashboard in the "Binary" design: services as tiles in
freely arrangeable groups — with server-side storage, 24 languages, themes,
animated backgrounds and WYSIWYG editing. No framework, no build tools, no
runtime dependencies: just static files plus a small Python backend (stdlib
only).

![Dashboard](https://github.com/sirius3r/zentrix-dashboard/blob/main/screenshot/screenshot1.png)
![Settings](https://github.com/sirius3r/zentrix-dashboard/blob/main/screenshot/screenshot2.png)

![Version](https://img.shields.io/badge/version-1.12.0-alpha-blue)
![Python](https://img.shields.io/badge/python-3.12-informational)
![License](https://img.shields.io/badge/license-MIT-green)

> 🇩🇪 Deutsche Version: [README.md](docs/de/README.md) · [HANDBUCH.md](docs/de/HANDBUCH.md)
> 🇫🇷 Version française : [README.md](docs/fr/README.md) · [HANDBUCH.md](docs/fr/HANDBUCH.md)

## Features

- **Tiles & groups** — links with name/URL/icon, icon picker with 3,300+
  icons (incl. light/dark variants), drag & drop for links *and* groups
- **Search** — live filter, `Ctrl+K`, auto-clear after clicking a result
- **6 themes** — Binary, Phosphor, Amber, Arctic (light), Deep Space,
  High contrast; **accent color freely selectable per theme**
- **6 backgrounds** — PCB (animated), Lightcycles (with collisions &
  explosions), Starfield with asteroids, Static, custom image (upload),
  **Immich photo rotation** (random photo from an album, shuffle-bag:
  every photo exactly once per cycle)
- **24 languages** — incl. RTL (Arabic), automatic language detection
- **Branding** — custom topbar text, custom favicon
- **Server sync** — token-protected saving, JSON export/import
- **ARP table & IP distribution** — live device view from router APIs
  (OPNsense: ARP + DHCP leases, passive mDNS), IEEE OUI vendor lookup (~58k
  entries), aggregate graph with per-area clusters and a searchable device
  list
- **Adaptive readability** — group headers adjust their contrast to the
  background image automatically
- **Mobile** — single-line topbar, magnifier for search, touch-optimized

## Quick start (Docker)

```bash
docker run -d --name zentrix \
  -p 8080:8080 \
  -v zentrix_data:/data \
  ghcr.io/sirius3r/zentrix-dashboard:latest
```

→ http://localhost:8080 — on first start the demo `links.json` is seeded
into the volume; the write token is in the container logs
(`docker logs zentrix | grep -A1 token`).

> **Note:** `-e ZENTRIX_TOKEN=…` (env) always takes precedence over the
> token file. Without it, a random token is generated at first start and
> logged (`docker logs zentrix | grep -A1 token`).

With your own token:

```bash
docker run -d --name zentrix -p 8080:8080 \
  -v zentrix_data:/data \
  -e ZENTRIX_TOKEN=my-secret-token \
  ghcr.io/sirius3r/zentrix-dashboard:latest
```

## Without Docker

```bash
python3 zentrix-server.py
# → http://0.0.0.0:8080  (token is generated and stored in token.txt)
```

## Immich photo background

Rotate the dashboard background through a photo album on your **Immich**
server. Configure it either in the settings (⚙ → Branding → Immich) or via
environment variables / Docker secrets:

| Variable | Secret file | Meaning |
|---|---|---|
| `IMMICH_URL` | `IMMICH_URL_FILE` | Immich base URL, e.g. `http://immich-server:2283` |
| `IMMICH_API_KEY` | `IMMICH_API_KEY_FILE` | Immich API key (Settings → API Keys) |
| `IMMICH_ALBUM` | `IMMICH_ALBUM_FILE` | Album name |
| `IMMICH_INTERVAL` | — | Rotation interval in seconds (min 60, default 3600) |

```yaml
# docker compose / stack example
services:
  dashboard:
    environment:
      IMMICH_URL: http://immich-server:2283
      IMMICH_ALBUM: Backgrounds
      IMMICH_INTERVAL: "3600"
    secrets:
      - immich_key
secrets:
  immich_key:
    external: true
```

**Creating the API key (Immich):** log in to the Immich web UI → click the
profile icon in the top right → **Account Settings** → **API Keys** →
**New API Key** (give it a name, e.g. "Zentrix") → copy the shown key (it is
displayed once) and enter it in Zentrix (⚙ → Branding → Immich) or via
secret/ENV. The key can be revoked and recreated in Immich at any time.
When creating the key, grant the **minimum permissions** Zentrix needs:
`asset.read`, `asset.view` (thumbnail) and `album.read` — nothing else
(`asset.download` is **not** required, Zentrix only fetches preview
thumbnails).

The API key **never leaves the server**: the dashboard fetches the current
photo from `GET /api/immich/photo` (same origin) — the browser receives only
image bytes, never credentials. GUI configuration (write-only key field)
takes precedence over env/secret values. Rotation uses a shuffle-bag: each
photo of the album appears exactly once per cycle, no fast repeats.

## Network topology (Phase 1)

The dashboard can display the devices in your network as a live topology view.
Data sources (⚙ → Gateway):

- **OPNsense (API)** — ARP table + DHCPv4 leases via the REST API. Create a
  dedicated API key (or a read-only user); the key/secret stay on the
  Zentrix server (write-only fields, never sent to the browser).
- **mDNS (passive)** — listens to UDP 5353 broadcasts, no queries sent.

**Public IP:** the WAN card shows the real public IP, resolved via an
external echo service (default: `http://checkip.dyndns.org/`, 10-minute
cache). Override with `ZENTRIX_PUBLIC_IP_URL` (or `ZENTRIX_PUBLIC_IP_URL_FILE`,
or `public_ip_url` in `sources.json`); the value `-` disables the lookup.

## Dynamic DNS (A-record updater)

Keep a public DNS A record in sync with your dynamic public IP — configurable
in ⚙ → DDNS:

- **Update URL** with placeholders `{ip}` `{host}` `{user}` `{pass}`
  (works with any DynDNS-protocol provider). `{user}:{pass}@` in the URL is
  translated to HTTP Basic auth; without placeholders, username/password are
  sent as Basic auth automatically.
- **Check interval** (default 300 s, min 60): resolves the A record via the
  system resolver and compares it with the current public IP — an update is
  only sent **on mismatch**.
- **Update interval** (default 300 s, min 60): minimum spacing between two
  update calls (rate limit against IP flapping and provider lockouts).
- **IP host**: which echo service detects the public IP (empty = dashboard
  default `http://checkip.dyndns.org/`).

The password is write-only (never returned to the browser), configuration
lives in `ddns.json` in the data volume; GUI takes precedence over
environment (`DDNS_UPDATE_URL`, `DDNS_HOST`, `DDNS_USER`, `DDNS_PASSWORD`,
`DDNS_CHECK_S`, `DDNS_UPDATE_S`, `DDNS_ENABLED`, plus `*_FILE` variants).
After 3 consecutive failures the updater pauses for 5 minutes (providers
lock out abusive clients). Buttons: *Test connection* (resolve + fetch, no
update), *Check now* (one cycle), *Update now* (force update).

> **Required OPNsense privileges** (System → Access → Users → ✎ →
> *Privileges*): **Diagnostics: ARP Table** and **Diagnostics:Network
> Insight**. DHCP lease data additionally needs the lease read permission of
> the DHCP service; interface data comes from *Diagnostics: Interfaces*.
> If the API answers with `403`, one of these is missing.

Devices from all sources are merged (by MAC, falling back to IP), vendors are
resolved from the bundled IEEE OUI registry, and every device shows its
sources and confidence. The topology view stays read-only: Zentrix never
writes to the router.

**FRITZ!Box (TR-064)** — the classic AVM home router is also supported:
SOAP over HTTP (port 49000) with HTTP-Digest auth, host list via
`X_AVM-DE_GetHostListPath` (full list incl. Wi-Fi/Ethernet type, guest
network, lease times), device count and model via the standard Hosts:1
service. Requires a dedicated FRITZ!Box user (Heimnetz access — never the
admin account) and is meant for the home network only; TR-064 traffic is
unencrypted on port 49000 (use `https://…:49443` for TLS).

Setup on the FRITZ!Box (verified on FRITZ!OS):

1. **Enable app access** — Heimnetz → Netzwerk → *Erweiterte
   Netzwerkeinstellungen ändern* → *Zugriff für Apps erlauben*
   (enabled by default).
2. **Create a user** — System → FRITZ!Box-Benutzer. *FRITZ!Box
   Einstellungen* is sufficient; be aware that this right implicitly
   also grants voice messages, fax messages, FRITZ!App Fon, call list
   and Smart Home access.

Configuration lives in `sources.json` in the data volume; GUI settings take
precedence over environment variables (`OPNSENSE_URL`, `OPNSENSE_API_KEY`,
`OPNSENSE_API_SECRET`, `FRITZBOX_URL`, `FRITZBOX_USER`, `FRITZBOX_PASSWORD`).

> **OPNsense credentials:** Zentrix uses the *API key + API secret* pair that
> OPNsense shows once when you create a key (System → Access → Users → ✎ →
> API keys → +). Enter the **key** in the "API-Key" field and the **secret**
> in the "API-Secret" field — Zentrix sends them as HTTP Basic auth. The base
> URL is enough (e. g. `https://opnsense.lan:444`); the API paths are added
> automatically, so reverse-proxy subpaths and custom ports work as-is.

## Swarm / Compose

Ready-made stack files are in the repository root:
`compose-swarm.yaml` (overlay network, placement constraints — note
`replicas` must sit **inside `deploy:`** for Swarm) and `compose-standalone.yaml`.

## Documentation

The full user manual (16 chapters: usage, themes, backgrounds,
troubleshooting …) is in [`HANDBUCH.md`](HANDBUCH.md). German and French translations in
[`docs/de/`](docs/de/) and [`docs/fr/`](docs/fr/).

## Security

- Token-protected write access, timing-safe comparison
- URL validation (only `http(s)`), strict CSP, no `innerHTML`
- PUT body limit 512 KB, atomic writes, no path traversal

## License

[MIT](LICENSE)
