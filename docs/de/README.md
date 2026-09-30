# Zentrix Homelab Dashboard

Ein leichtgewichtiges Homelab-Dashboard im „Binary"-Design: Dienste als
Kacheln in frei anordnbaren Gruppen — mit serverseitiger Speicherung,
24 Sprachen, Themes, animierten Hintergründen und WYSIWYG-Bearbeitung.
Kein Framework, keine Build-Tools, keine Laufzeit-Abhängigkeiten:
nur statische Dateien plus ein kleines Python-Backend (nur Stdlib).

![Version](https://img.shields.io/badge/version-1.7.0-blue)
![Python](https://img.shields.io/badge/python-3.12-informational)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Kacheln & Gruppen** — Links mit Name/URL/Icon, Icon-Picker mit 3.300+
  Icons (inkl. Light/Dark-Varianten), Drag & Drop für Links *und* Gruppen
- **Suche** — Live-Filter, `Strg+K`, Auto-Leeren nach Trefferklick
- **6 Themes** — Binary, Phosphor, Amber, Arctic (hell), Deep Space,
  Kontrastreich; **Akzentfarbe pro Theme frei wählbar**
- **5 Hintergründe** — Leiterplatte (animiert), Lightcycles (mit
  Kollisionen & Explosionen), Sternenfeld mit Asteroiden, Statisch,
  eigenes Bild (Upload)
- **24 Sprachen** — inkl. RTL (Arabisch), automatische Spracherkennung
- **Branding** — eigener Topbar-Text, eigenes Favicon
- **Server-Sync** — Token-geschütztes Speichern, Export/Import als JSON
- **Adaptive Lesbarkeit** — Überschriften passen ihren Kontrast automatisch
  an das Hintergrundbild an
- **Mobil** — einzeilige Topbar, Lupe für die Suche, Touch-optimiert

## Schnellstart (Docker)

```bash
docker run -d --name zentrix \
  -p 8080:8080 \
  -v zentrix_data:/data \
  ghcr.io/sirius3r/zentrix-dashboard:latest
```

→ http://localhost:8080 — beim ersten Start wird die Demodaten-`links.json`
ins Volume befüllt; das Schreib-Token steht in den Container-Logs
(`docker logs zentrix | grep token`).

Mit eigenem Token:

```bash
docker run -d --name zentrix -p 8080:8080 \
  -v zentrix_data:/data \
  -e ZENTRIX_TOKEN=mein-geheimes-token \
  ghcr.io/sirius3r/zentrix-dashboard:latest
```

## Ohne Docker

```bash
python3 zentrix-server.py
# → http://0.0.0.0:8080  (Token wird generiert und in token.txt abgelegt)
```

## Swarm / Compose

Fertige Stack-Dateien liegen in der Repository-Wurzel:
`compose-swarm.yaml` (Overlay-Netz, Placement-Constraints) und
`compose-standalone.yaml`.

## Dokumentation

Das vollständige Benutzerhandbuch (16 Kapitel: Bedienung, Themes,
Hintergründe, Fehlersuche …) liegt in [`HANDBUCH.md`](HANDBUCH.md).

## Sicherheit

- Token-geschützte Schreibzugriffe, timing-sicherer Vergleich
- URL-Validierung (nur `http(s)`), strict CSP, kein `innerHTML`
- PUT-Body-Limit 512 KB, atomare Schreibvorgänge, kein Path-Traversal

## Lizenz

[MIT](../../LICENSE)
