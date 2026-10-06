# Zentrix Homelab Dashboard

A lightweight homelab dashboard in the "Binary" design: services as tiles in
freely arrangeable groups — with server-side storage, 24 languages, themes,
animated backgrounds and WYSIWYG editing. No framework, no build tools, no
runtime dependencies: just static files plus a small Python backend (stdlib
only).

![Dashboard](https://github.com/sirius3r/zentrix-dashboard/blob/main/screenshot/screenshot1.png)
![Settings](https://github.com/sirius3r/zentrix-dashboard/blob/main/screenshot/screenshot2.png)

![Version](https://img.shields.io/badge/version-1.8.0-blue)
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
