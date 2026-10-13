# Zentrix Homelab Dashboard

Ein leichtgewichtiges Homelab-Dashboard im „Binary"-Design: Dienste als
Kacheln in frei anordnbaren Gruppen — mit serverseitiger Speicherung,
24 Sprachen, Themes, animierten Hintergründen und WYSIWYG-Bearbeitung.
Kein Framework, keine Build-Tools, keine Laufzeit-Abhängigkeiten:
nur statische Dateien plus ein kleines Python-Backend (nur Stdlib).

![Version](https://img.shields.io/badge/version-1.10.0-alpha-blue)
![Python](https://img.shields.io/badge/python-3.12-informational)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Kacheln & Gruppen** — Links mit Name/URL/Icon, Icon-Picker mit 3.300+
  Icons (inkl. Light/Dark-Varianten), Drag & Drop für Links *und* Gruppen
- **Suche** — Live-Filter, `Strg+K`, Auto-Leeren nach Trefferklick
- **6 Themes** — Binary, Phosphor, Amber, Arctic (hell), Deep Space,
  Kontrastreich; **Akzentfarbe pro Theme frei wählbar**
- **6 Hintergründe** — Leiterplatte (animiert), Lightcycles (mit
  Kollisionen & Explosionen), Sternenfeld mit Asteroiden, Statisch,
  eigenes Bild (Upload)
- **24 Sprachen** — inkl. RTL (Arabisch), automatische Spracherkennung
- **Branding** — eigener Topbar-Text, eigenes Favicon
- **Server-Sync** — Token-geschütztes Speichern, Export/Import als JSON
- **Netzwerk-Topologie** — Live-Geräteansicht aus Router-APIs (OPNsense: ARP +
  DHCP-Leases, passives mDNS), IEEE-OUI-Herstellererkennung (~58k Einträge),
  Aggregat-Graph mit Bereichs-Clustern und durchsuchbarer Geräteliste
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
> **Hinweis:** `-e ZENTRIX_TOKEN=…` (Umgebungsvariable) hat immer Vorrang
> vor der Token-Datei. Ohne sie wird beim ersten Start ein zufälliges Token
> erzeugt und im Log ausgegeben (`docker logs zentrix | grep -A1 token`).


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

## Immich-Fotohintergrund

Lass den Dashboard-Hintergrund durch ein Fotoalbum deiner **Immich**-Instanz
rotieren. Konfiguration entweder in den Einstellungen (⚙ → Branding → Immich)
oder über Umgebungsvariablen / Docker-Secrets:

| Variable | Secret-Datei | Bedeutung |
|---|---|---|
| `IMMICH_URL` | `IMMICH_URL_FILE` | Immich-Basis-URL, z. B. `http://immich-server:2283` |
| `IMMICH_API_KEY` | `IMMICH_API_KEY_FILE` | Immich API-Key (Einstellungen → API Keys) |
| `IMMICH_ALBUM` | `IMMICH_ALBUM_FILE` | Album-Name |
| `IMMICH_INTERVAL` | — | Rotationsintervall in Sekunden (min 60, Standard 3600) |

**API-Key erstellen (Immich):** In der Immich-Weboberfläche anmelden →
oben rechts aufs Profilsymbol klicken → **Kontoeinstellungen** →
**API-Keys** → **Neuer API-Key** (Name vergeben, z. B. „Zentrix") → den
angezeigten Schlüssel einmalig kopieren und in Zentrix (⚙ → Branding →
Immich) oder als Secret/ENV eintragen. Der Key lässt sich in Immich jederzeit
widerrufen und neu erstellen.
Vergebe beim Erstellen nur die **minimal notwendigen Rechte**, die Zentrix
braucht: `asset.read`, `asset.view` (Thumbnail) und `album.read` — nichts
weiter (`asset.download` wird **nicht** benötigt, Zentrix lädt nur
Preview-Thumbnails).

Der API-Key **verlässt den Server nie**: Das Dashboard holt das aktuelle Foto
über `GET /api/immich/photo` (same origin) — der Browser erhält nur Bilddaten,
nie Zugangsdaten. GUI-Konfiguration (Write-only-Key-Feld) hat Vorrang vor
ENV/Secret-Werten. Rotation per Shuffle-Bag: jedes Foto genau einmal pro
Zyklus, keine schnellen Wiederholungen.

## Netzwerk-Topologie (Phase 1)

Das Dashboard kann die Geräte deines Netzes als Live-Topologie anzeigen.
Datenquellen (⚙ → ARP/IP):

- **OPNsense (API)** — ARP-Tabelle + DHCPv4-Leases über die REST-API. Lege
  einen eigenen API-Key (oder Nur-Lese-Benutzer) an; Key/Secret bleiben auf
  dem Zentrix-Server (Write-only-Felder, erreichen nie den Browser).
- **mDNS (passiv)** — empfängt UDP-5353-Broadcasts, ohne selbst Anfragen zu
  senden.

**Öffentliche IP:** Die WAN-Karte zeigt die echte öffentliche IP, ermittelt
über einen externen Echo-Dienst (Standard: `http://checkip.dyndns.org/`,
10-Minuten-Cache). Überschreibbar mit `ZENTRIX_PUBLIC_IP_URL` (oder
`ZENTRIX_PUBLIC_IP_URL_FILE`, oder `public_ip_url` in `sources.json`); der
Wert `-` deaktiviert die Abfrage.

> **Benötigte OPNsense-Berechtigungen** (System → Access → Users → ✎ →
> *Berechtigungen*): **Diagnostics: ARP Table** und **Diagnostics: Network
> Insight**. Für DHCP-Lease-Daten zusätzlich die Lese-Berechtigung des
> DHCP-Dienstes; Interface-Daten kommen aus *Diagnostics: Interfaces*.
> Antwortet die API mit `403`, fehlt eine davon.

Geräte aus allen Quellen werden zusammengeführt (primär per MAC, sonst per
IP), Hersteller stammen aus der mitgelieferten IEEE-OUI-Registrierung, und
jedes Gerät zeigt seine Quellen und seine Konfidenz. Die Topologie-Ansicht
ist strikt read-only: Zentrix schreibt niemals in den Router.

Die Konfiguration liegt in `sources.json` im Data-Volume; GUI-Einstellungen
haben Vorrang vor Umgebungsvariablen (`OPNSENSE_URL`, `OPNSENSE_API_KEY`,
`OPNSENSE_API_SECRET`, `FRITZBOX_*` — ein FRITZ!Box-Adapter ist für ein
späteres Release geplant).

> **OPNsense-Zugangsdaten:** Zentrix nutzt das *API-Key + API-Secret*-Paar,
> das OPNsense einmalig beim Erstellen anzeigt (System → Zugriff → Benutzer →
> ✎ → API-Keys → +). Den **Key** ins Feld „API-Key", das **Secret** ins Feld
> „API-Secret" — Zentrix sendet beide als HTTP-Basic-Auth. Die Basis-URL
> genügt (z. B. `https://opnsense.lan:444`); die API-Pfade werden automatisch
> ergänzt, Reverse-Proxy-Unterpfade und eigene Ports funktionieren direkt.

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
