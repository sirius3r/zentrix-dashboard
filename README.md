# Zentrix Homelab Dashboard

A lightweight homelab dashboard in the "Binary" design: services as tiles in
freely arrangeable groups — with server-side storage, 24 languages, themes,
animated backgrounds and WYSIWYG editing. No framework, no build tools, no
runtime dependencies: just static files plus a small Python backend (stdlib
only).

![Version](https://img.shields.io/badge/version-1.7.0-blue)
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
- **5 backgrounds** — PCB (animated), Lightcycles (with collisions &
  explosions), Starfield with asteroids, Static, custom image (upload)
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
(`docker logs zentrix | grep token`).

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
