# Zentrix Homelab Dashboard — User Manual

**Version 1.8.0** · September 2026

The Zentrix dashboard is a lightweight homelab dashboard in the "Binary"
design: all homelab services as tiles in freely arrangeable groups, with
server-side storage, 24 languages, six themes, animated backgrounds and a
polished edit mode. No framework, no build tools, no dependencies — just
static files plus a small Python backend.

---

## Table of contents

1. [Features at a glance](#1-features-at-a-glance)
2. [The interface](#2-the-interface)
3. [Search](#3-search)
4. [Edit mode](#4-edit-mode)
5. [Arranging groups & side-by-side](#5-arranging-groups--side-by-side)
6. [Settings (⚙)](#6-settings-)
7. [Themes](#7-themes)
8. [Backgrounds](#8-backgrounds)
9. [Branding: topbar text, favicon, accent colors](#9-branding-topbar-text-favicon-accent-colors)
10. [Saving & sync (status chip)](#10-saving--sync-status-chip)
11. [Keyboard shortcuts](#11-keyboard-shortcuts)
12. [Mobile behavior](#12-mobile-behavior)
13. [Architecture & files](#13-architecture--files)
14. [Docker operation](#14-docker-operation)
15. [TLS / reverse proxy](#15-tls--reverse-proxy)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Features at a glance

| Area | Features |
|---|---|
| Links | Tiles with name, URL, icon; icon picker with 3,300+ icons (incl. light/dark variants) |
| Groups | Any number of groups, drag & drop reordering, per-group list/grid layout |
| Side by side | Two specific groups side by side (⫲ button) or all pairs (option) |
| Search | Live filter, `Ctrl+K`, auto-clear on result click, magnifier on mobile |
| Themes | Binary, Phosphor, Amber, Arctic, Deep Space, High contrast — accent color per theme |
| Backgrounds | PCB (animated), Lightcycles with collisions, Starfield with asteroids, Static, custom image |
| Languages | 24 languages incl. RTL (Arabic) |
| Branding | Custom topbar text, custom favicon (default: big red Z) |
| Data | Server storage with token protection, JSON export/import |
| Mobile | Responsive, single-line topbar, compact tiles |

---

## 2. The interface

### 2.1 Topbar

Left to right:

- **ZENTRIX logo** — wordmark with status dot; the text after "ZENTRIX"
  (default `/homelab`) is configurable (see section 9)
- **Date & time** — live, in the selected language; can be hidden in settings
- **Sync chip** — shows the save status (see section 10)
- **⌕ (magnifier)** — only on narrow screens: toggles the search bar
- **✎ (pencil)** — edit mode on/off (while editing: **✓**); icon-only with
  tooltip so the topbar stays single-line at every width
- **⚙ (gear)** — opens the settings panel

When the clock is hidden, the sync chip and all buttons align neatly to the
right — the topbar always stays tidy.

### 2.2 Search bar

Directly below the topbar. Typing live-filters all link names and URLs.

- `Ctrl+K` (or `Cmd+K`) focuses the search, `Esc` clears it
- **Clicking a result:** the link opens in a new tab and the search field
  clears automatically — you can type the next term right away, no ESC
- On narrow screens (≤ 640 px) the search bar is hidden by default: the
  **magnifier** in the topbar shows it; after clicking a result it hides
  automatically again

---

## 3. Search

| Action | Behavior |
|---|---|
| Typing | Live filter over names and URLs of all groups |
| `Ctrl/Cmd + K` | Focus search |
| `Esc` | Clear search |
| Click result | Link opens in new tab; search field auto-clears |
| Magnifier (mobile) | Show search bar; auto-hides after result click |

Empty groups are hidden during search; if nothing matches at all, a hint
appears.

---

## 4. Edit mode

Click the **✎ icon** in the topbar (while editing: **✓**):

- **Edit a link:** click a tile → dialog with name, URL, icon, group
- **Delete a link:** ✕ in the top-right corner of the tile
- **Move/reorder a link:** drag the tile — also into another group
- **Add a link:** "+ Add link" card at the end of a group
- **Rename a group:** click the group title and type (Enter confirms)
- **Delete a group:** "✕ Group" or 🗑 next to the title

**Deleting groups never loses links:** the links move to another group. If
you delete the *last* group, the dashboard automatically creates a new group
containing all links.

- **Reorder groups:** in edit mode each group head gets a **⠿ handle** — drag
  the whole group to any position
- **New group:** "+ New tab group" at the end of the page
- **Side-by-side pairing:** the **⫲ button** on the group head (see section 5)

Every change is saved automatically (600 ms after the last action).

### 4.1 The link dialog

- **Name:** free text
- **URL:** only `http(s)` allowed; missing protocol is added
  (`unifi.lan.example` → `https://…`). `javascript:`/`data:`/`file:` are
  rejected.
- **Icon:** type a **word** (e.g. `unifi`, `emby`, `vaultwarden`) — a grid of
  matching icons from the dashboard-icons catalog appears (3,300+ entries
  via jsDelivr, SVG preferred). The picker also includes **color variants**:
  for `vaultwarden` you get e.g. `vaultwarden-light` and `vaultwarden-dark`.
  Manual URL entry always works. The catalog is cached in the browser for
  24 h; offline you can still paste a URL.
- **Group:** choose the target group in the dropdown (while editing a link
  this equals moving it to another group)

---

## 5. Arranging groups & side-by-side

### 5.1 Order

In edit mode grab the group at the **⠿ handle** and drag it to any position.
The order applies to the single column — and determines *who is paired with
whom* (see below).

### 5.2 Two specific groups side by side (⫲ button)

In edit mode each group head has a **⫲ button**:

1. Click it → the group is marked (the button lights up in accent color)
2. It pairs with the group that **directly follows it in the sort order** —
   both render as a two-column row (on FullHD and wider)
3. Click again to unpair

Multiple pairs can be defined at once: A+B side by side, C+D side by side,
rest stacked. Pairings are stored per browser. Below FullHD everything is
deliberately stacked for readability.

### 5.3 All groups in pairs (option)

Alternatively use the global **"Two groups side by side"** option in the ⚙
panel — then *all* groups render in pairs: 1+2 in a row, 3+4 below, etc.
(odd last group alone). This option excludes the fixed column-count option
(both use the same dropdown).

### 5.4 Layout per group

Each group can individually switch between "stacked" (tiles stack) and
"grid" (tiles in columns). The choice is stored per group.

---

## 6. Settings (⚙)

The panel is divided into three **tabs**: **Appearance** · **Branding** ·
**Data**.

All settings are stored **per browser** (localStorage) and restored on the
next visit. They apply immediately — no save button; the panel closes via
**Close** or `Esc`.

---

## 7. Themes

Six themes, each with a freely selectable accent color (see 9.3):

| Theme | Look |
|---|---|
| Binary (default) | Dark gray + mint accent |
| Phosphor | Dark gray + neon green (retro terminal) |
| Amber | Dark gray + amber (classic amber terminal) |
| Arctic | **Light** — white surface, dark green accent |
| Deep Space | Deep blue-violet + indigo accent (matches the starfield) |
| High contrast | Black + cyan, strongest contrast (accessibility) |

The accent color also tints the animated backgrounds.

---

## 8. Backgrounds

| Mode | Description |
|---|---|
| Circuit board | PCB scene: dot grid, traces with 45° bends, vias; light pulses travel along the traces, rippling at vias |
| Lightcycles | 3–5 "cycles" ride on black ground, turn only in 90° angles (never retrace their path), leave fading light trails (cyan/orange, balanced) and **explode** when they ride into a trail — afterwards a new cycle starts at a free position |
| Starfield | Dark sky with 90–220 twinkling stars and 5–11 slowly drifting **asteroids** with light trails |
| Static | Only the rendered still frame, no animation |
| Custom image | Your own background image (JPG/PNG/WebP, max 4 MB) — cover-fit across the whole viewport, stored per browser |

Common rules for animated modes: animation pauses automatically when the tab
is in the background; with `prefers-reduced-motion` ("reduce motion" in the
OS) it stays static. Rendering is DPR-aware (up to 2× retina) and very light.

**Readability over custom images:** dark themes measure the image brightness
behind each group header and adjust text contrast automatically (light text
on dark areas, dark on light). On the light **Arctic** theme a white, slightly
translucent plate sits behind each header — the header always stays black and
readable, no matter whether the image is light or dark.

---

## 9. Branding: topbar text, favicon, accent colors

(⚙ → tab **Branding**)

### 9.1 Topbar text

The text after "ZENTRIX" (default `/homelab`) is freely configurable — e.g.
a location, department or project name. Max 40 characters, applied instantly.

### 9.2 Favicon

Upload your own logo for the browser tab (**PNG/ICO/SVG/JPEG/WebP**, max
256 KB). The default is a **big red Z** on a dark rounded square.
"Reset" restores the red Z.

### 9.3 Accent color per theme

Every theme has a default accent color which you can **individually
override**:

1. Pick the theme (e.g. Arctic)
2. Set the desired color in the color picker
3. **Apply** — accent, borders and background animations tint accordingly
4. **Theme default** restores the original color of the theme

The setting is stored per theme — each theme keeps its own custom color.

---

## 10. Saving & sync (status chip)

The chip in the topbar shows the state:

| Display | Meaning |
|---|---|
| `● server` | Saved to the server — all good |
| `● saving…` | Currently saving (600 ms debounce) |
| `● local` | Server unreachable — changes live only in this browser |
| `● no token` | Server reachable but no write token set → click the chip |
| `● wrong token` | Token rejected → click the chip and enter the correct token |
| `● offline` | Neither server nor local copy |

The token is stored only in this browser, never rendered in the UI and only
sent to the server when saving. In the container it lives under
`/run/secrets/zentrix_token` (or the mounted token file).

**Server error messages** (token errors, invalid JSON, oversized body …)
come in the selected language since 1.6.3 — the frontend automatically sends
its language when saving.

---

## 11. Keyboard shortcuts

| Shortcut | Effect |
|---|---|
| `Ctrl/Cmd + K` | Focus search |
| `Esc` | Clear search / close dialogs |

---

## 12. Mobile behavior

- Topbar stays **single-line**: compact logo (without suffix), clock/chip
  smaller, buttons as icons
- **Search bar** hidden by default; the **magnifier** in the topbar shows it,
  it auto-hides again after a result click
- Tiles: larger touch targets, 2-column grid down to 400 px, 1 column below
- Pairings/side-by-side are deliberately stacked below FullHD (readability)
- Hover effects are replaced by active states on touch devices

---

## 13. Architecture & files

```
index.html      UI (markup + CSS; themes as data-theme variables)
app.js          Logic: rendering, WYSIWYG, settings, i18n binding
bg.js           Backgrounds (canvas): PCB, Lightcycles, Starfield, custom image
i18n.js         24 languages × 122 UI strings (generated, fully validated)
zentrix-server.py  Backend (Python 3, stdlib only, no pip packages)
server_i18n.py  Server error message translations (24 languages)
links.json      The data (created on first save / from the seed)
```

Backend endpoints:

- `GET /` — dashboard UI
- `GET /api/links` — read data (public)
- `PUT /api/links` — write data (requires `X-Auth-Token` header)
- `GET /api/health` — health check for Docker/Swarm

Security: timing-safe token comparison (`hmac.compare_digest`),
URL/icon validation (only `http(s)`; `javascript:`/`data:`/`file:` are
rejected), strict CSP (`script-src 'self'`), `X-Frame-Options: DENY`,
`nosniff`, rendering exclusively via `createElement`/`textContent` (no
`innerHTML`), PUT body limited to 512 KB with server-side JSON structure
validation, atomic writes (tmp + rename), no path traversal. Custom
background image and favicon stay **in the browser** (data-URL in
localStorage) — they never leave your machine via the server.

---

## 14. Docker operation

Image: `ghcr.io/sirius3r/zentrix-dashboard:latest`
(Demo data: 15 sample links in 5 groups, hostnames/IPs neutralized)

Data lives in the container under `/data/links.json` — this directory must
be mounted as a volume. A fresh, empty volume is automatically seeded with
the demo data on first start (a seed copy also sits at
`/app/links-demo-seed.json`). The write token comes as a Docker secret
(`zentrix_token`).

### 14.1 Swarm operation — `compose-swarm.yaml`

```yaml
services:
  dashboard:
    image: ghcr.io/sirius3r/zentrix-dashboard:latest
    environment:
      ZENTRIX_DATA_FILE: /data/links.json
    secrets:
      - source: zentrix_token
        target: zentrix_token
    volumes:
      - data:/data
    networks:
      - swarm-net
    deploy:
      replicas: 1
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 3
        window: 120s
      placement:
        constraints:
          - node.role == worker

networks:
  swarm-net:
    external: true

volumes:
  data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/swarm/volumes/zentrix_data
      o: bind

secrets:
  zentrix_token:
    external: true
```

Reachable in the swarm via the overlay network: `zentrix_dashboard:8080`
(stack name + service name) — the reverse proxy addresses the service
directly. With a published port additionally:

```yaml
    ports:
      - target: 8080
        published: 8080
        protocol: tcp
        mode: ingress
```

### 14.2 Standalone (docker compose) — `compose-standalone.yaml`

```yaml
services:
  dashboard:
    image: ghcr.io/sirius3r/zentrix-dashboard:latest
    container_name: zentrix-dashboard
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      ZENTRIX_DATA_FILE: /data/links.json
    volumes:
      - /opt/zentrix/data:/data
      - /opt/zentrix/zentrix_token:/run/secrets/zentrix_token:ro
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=2).status == 200 else 1)"]
      interval: 30s
      timeout: 3s
      start_period: 5s
      retries: 3
    mem_limit: 128m
```

Then reachable at `http://<host>:8080`.

---

## 15. TLS / reverse proxy

The container speaks plain HTTP on 8080. For HTTPS put a reverse proxy in
front (OPNsense Acme, Caddy, nginx, Traefik) pointing at
`zentrix_dashboard:8080` (Swarm) or `http://<host>:8080` (standalone).

---

## 16. Troubleshooting

| Symptom | Cause/fix |
|---|---|
| Old look after update | Browser cache: `Ctrl+Shift+R` (app.js/i18n.js cached up to 24 h) |
| Chip shows `no token` | Click the chip, enter the token from `/run/secrets/zentrix_token` (Swarm) or the token file (standalone) |
| Chip shows `wrong token` | Token changed? Enter the new token (click the chip) |
| Chip shows `local`/`offline` | Server unreachable — check `docker stack ps zentrix` / `docker ps`, then **Reload** |
| Changes lost after restart | `/data` is not mounted as a volume — see section 14 |
| Icons missing/empty | Icon catalog needs internet (jsDelivr); offline paste the icon URL manually |
| Headers hard to read over custom image | Dark themes: automatic (image brightness is measured). Arctic: white plate behind headers is active |
| "+ New tab group" invisible | Opaque since 1.4.1 — clear cache (`Ctrl+Shift+R`) |
| Edit button shows text instead of ✎ | Older version cached — update and hard-reload |
| Side-by-side not applying | FullHD (≥ 1920 px) required; ⫲ pairing only visible in edit mode; check the global option in ⚙ |
| Clock missing | Enable in ⚙ → "Show date & time" |
| Animation too wild/quiet | Pick another background; OS `prefers-reduced-motion` is respected |
| Language should be different | ⚙ → Appearance tab → Language; stored per browser |
| Server errors in wrong language | Frontend sends its language on save; direct API calls honor `?lang=` and `Accept-Language` |
