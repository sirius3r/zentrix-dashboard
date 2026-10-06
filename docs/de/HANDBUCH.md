# Zentrix Homelab Dashboard — Benutzerhandbuch

**Version 1.8.0** · Stand: September 2026

Das Zentrix-Dashboard ist ein leichtgewichtiges Homelab-Dashboard im
„Binary"-Design: alle Dienste des Homelabs als Kacheln in frei anordnbaren
Gruppen, mit serverseitiger Speicherung, 24 Sprachen, sechs Themes, animierten
Hintergründen und einem ausgereiften Bearbeiten-Modus. Kein Framework, keine
Build-Tools, keine Abhängigkeiten — nur statische Dateien plus ein kleines
Python-Backend.

---

## Inhaltsverzeichnis

1. [Funktionen im Überblick](#1-funktionen-im-überblick)
2. [Die Oberfläche](#2-die-oberfläche)
3. [Suche](#3-suche)
4. [Bearbeitungsmodus](#4-bearbeitungsmodus)
5. [Gruppen anordnen und nebeneinander stellen](#5-gruppen-anordnen-und-nebeneinander-stellen)
6. [Einstellungen (⚙)](#6-einstellungen--)
7. [Themes](#7-themes)
8. [Hintergründe](#8-hintergründe)
9. [Branding: Topbar-Text, Favicon, Akzentfarben](#9-branding-topbar-text-favicon-akzentfarben)
10. [Speichern & Sync (Status-Chip)](#10-speichern--sync-status-chip)
11. [Tastenkürzel](#11-tastenkürzel)
12. [Mobile Verhalten](#12-mobile-verhalten)
13. [Technik & Dateien](#13-technik--dateien)
14. [Docker-Betrieb](#14-docker-betrieb)
15. [TLS / Reverse Proxy](#15-tls--reverse-proxy)
16. [Fehlersuche](#16-fehlersuche)

---

## 1. Funktionen im Überblick

| Bereich | Funktionen |
|---|---|
| Links | Kacheln mit Name, URL, Icon; Icon-Picker mit 3.300+ Icons (inkl. Light/Dark-Varianten) |
| Gruppen | Beliebige viele Gruppen, per Drag & Drop sortierbar, pro Gruppe Listen-/Raster-Layout |
| Nebeneinander | Gezielt zwei bestimmte Gruppen nebeneinander (⫲-Knopf) oder alle paarweise (Option) |
| Suche | Live-Filter, `Strg+K`, Auto-Leeren nach Trefferklick, Lupe auf Mobil |
| Themes | Binary, Phosphor, Amber, Arctic, Deep Space, Kontrastreich — Akzentfarbe je Theme frei wählbar |
| Hintergründe | Leiterplatte (animiert), Lightcycles mit Kollisionen, Sternenfeld mit Asteroiden, Statisch, Eigenes Bild |
| Sprachen | 24 Sprachen, inkl. RTL (Arabisch) |
| Branding | Eigener Topbar-Text, eigenes Favicon (Standard: großes rotes Z) |
| Daten | Server-Speicherung mit Token-Schutz, Export/Import als JSON |
| Mobile | Responsiv, einzeilige Topbar, Suche über Lupe, kompakte Kacheln |

---

## 2. Die Oberfläche

### 2.1 Topbar (oben)

Von links nach rechts:

- **ZENTRIX-Logo** — Wortmarke mit Status-Punkt; der Text nach „ZENTRIX"
  (standardmäßig `/homelab`) ist frei konfigurierbar (siehe Abschnitt 9)
- **Datum & Uhrzeit** — live, in der gewählten Sprache; über die Einstellungen
  ausblendbar
- **Sync-Chip** — zeigt den Speicherstatus (siehe Abschnitt 10)
- **⌕ (Lupe)** — nur auf schmalen Bildschirmen: blendet die Suchzeile ein
- **✎ (Stift)** — Bearbeitungsmodus ein/aus (im Modus: **✓**); Icon-only mit
  Tooltip, damit die Topbar auf jeder Breite einzeilig bleibt
- **⚙ (Zahnrad)** — öffnet das Einstellungs-Panel

Wird die Uhr ausgeblendet, rücken Sync-Chip und alle Buttons sauber an den
rechten Rand — die Topbar bleibt immer aufgeräumt.

### 2.2 Suchzeile

Direkt unter der Topbar. Eingabe filtert live über alle Link-Namen und URLs.

- `Strg+K` (bzw. `Cmd+K`) springt in die Suchzeile, `Esc` leert sie
- **Klick auf einen Treffer:** der Link öffnet sich im neuen Tab, und die
  Suchzeile leert sich automatisch — der nächste Suchbegriff kann sofort
  getippt werden, ohne ESC
- Auf schmalen Bildschirmen (≤ 640 px) ist die Suchzeile standardmäßig
  ausgeblendet: Die **Lupe** in der Topbar blendet sie ein, nach dem Klick
  auf einen Treffer blendet sie sich automatisch wieder aus

---

## 3. Suche

| Aktion | Verhalten |
|---|---|
| Tippen | Live-Filter über Namen und URLs aller Gruppen |
| `Strg/Cmd + K` | Suche fokussieren |
| `Esc` | Suche leeren |
| Treffer anklicken | Link öffnet im neuen Tab; Suchfeld leert sich automatisch |
| Lupe (mobil) | Suchzeile einblenden; nach Treffer-Klick wieder aus |

Leere Gruppen werden während der Suche ausgeblendet; gibt es überhaupt keine
Treffer, erscheint ein Hinweis.

---

## 4. Bearbeitungsmodus

Klick auf das **✎-Symbol** in der Topbar (im Modus: **✓**):

- **Link bearbeiten:** Kachel anklicken → Dialog mit Name, URL, Icon, Gruppe
- **Link löschen:** ✕ oben rechts auf der Kachel
- **Link verschieben/sortieren:** Kachel an eine andere Stelle ziehen — auch
  in eine andere Gruppe
- **Link hinzufügen:** „+ Link hinzufügen"-Karte am Ende einer Gruppe
- **Gruppe umbenennen:** Gruppentitel anklicken und tippen (Enter bestätigt)
- **Gruppe löschen:** „✕ Gruppe" bzw. 🗑 neben dem Titel

**Beim Löschen von Gruppen gehen nie Links verloren:** Die Links wandern in
eine andere Gruppe. Löscht man die *letzte* Gruppe, legt das Dashboard
automatisch eine neue Gruppe mit allen Links an.

- **Gruppe anordnen:** Am rechten Rand jedes Gruppenkopfes erscheint ein
  **⠿-Griff** — damit lässt sich die ganze Gruppe per Drag & Drop an jede
  Position schieben
- **Neue Gruppe:** „+ Neue Tabgruppe" am Seitenende
- **Nebeneinander-Paarung:** **⫲-Knopf** am Gruppenkopf (siehe Abschnitt 5)

Jede Änderung wird automatisch gespeichert (600 ms nach der letzten Aktion).

### 4.1 Link-Dialog im Detail

- **Name:** frei wählbar
- **URL:** nur `http(s)` erlaubt; fehlendes Protokoll wird ergänzt
  (`unifi.lan.example` → `https://…`). `javascript:`/`data:`/`file:` werden
  abgelehnt.
- **Icon:** ein **Wort** eintippen (z. B. `unifi`, `emby`, `vaultwarden`) —
  es erscheint ein Raster passender Icons aus dem dashboard-icons-Katalog
  (3.300+ Einträge via jsDelivr, SVG bevorzugt). Der Picker berücksichtigt
  auch **Farb-Varianten**: zu `vaultwarden` werden z. B. `vaultwarden-light`
  und `vaultwarden-dark` mit angeboten. Alternativ bleibt die manuelle
  URL-Eingabe. Der Katalog wird 24 h im Browser gecacht; offline bleibt die
  manuelle Eingabe.
- **Gruppe:** Zielgruppe im Dropdown wählbar (beim Bearbeiten entspricht das
  dem Verschieben in eine andere Gruppe)

---

## 5. Gruppen anordnen und nebeneinander stellen

### 5.1 Reihenfolge

Im Bearbeiten-Modus die Gruppe am **⠿-Griff** fassen und an die gewünschte
Position ziehen. Die Reihenfolge gilt für die Einzelspalte — und sie bestimmt,
*wer mit wem* nebeneinander steht (siehe unten).

### 5.2 Zwei bestimmte Gruppen nebeneinander (⫲-Knopf)

Im Bearbeiten-Modus hat jeder Gruppenkopf einen **⫲-Knopf**:

1. Anklicken → die Gruppe ist markiert (Knopf leuchtet akzentfarben)
2. Sie wird mit der Gruppe **gepaart, die in der Sortierung direkt
   danach folgt** — beide stehen dann als Zwei-Spalten-Reihe (ab FullHD)
3. Nochmaliger Klick hebt die Paarung auf

Es können mehrere Paare gleichzeitig definiert werden: A+B nebeneinander,
C+D nebeneinander, Rest einspaltig. Die Paarungen werden pro Browser
gespeichert. Unterhalb von FullHD wird aus Platzgründen immer gestapelt.

### 5.3 Alle Gruppen paarweise (Option)

Alternativ die globale Option **„Zwei Gruppen nebeneinander"** im ⚙-Panel —
dann stehen *alle* Gruppen paarweise: 1+2 in einer Reihe, 3+4 darunter usw.
(ungerade letzte Gruppe allein). Diese Option schließt die feste
Spaltenzahl-Option aus (beide bedienen dasselbe Dropdown).

### 5.4 Layout pro Gruppe

Jede Gruppe kann einzeln zwischen „untereinander" (Kacheln stapeln) und
„nebeneinander" (Kacheln im Raster) umgestellt werden. Die Wahl wird pro
Gruppe gespeichert.

---

## 6. Einstellungen (⚙)

Das Panel ist seit 1.6.0 in drei **Registerkarten** gegliedert:
**Erscheinungsbild** · **Branding** · **Daten**.

Alle Einstellungen werden **pro Browser** gespeichert (localStorage) und beim
nächsten Besuch wiederhergestellt. Sie wirken sofort — kein Speichern-Knopf;
das Panel schließt über **Verlassen** oder `Esc`.

---

## 7. Themes

Sechs Themes, jeweils mit frei wählbarer Akzentfarbe (siehe 9.3):

| Theme | Look |
|---|---|
| Binary (Standard) | Dunkelgrau + Mintgrün-Akzent |
| Phosphor | Dunkelgrau + Neongrün (Retro-Terminal) |
| Amber | Dunkelgrau + Bernstein (klassisches Amber-Terminal) |
| Arctic | **Hell** — weiße Oberfläche, dunkelgrüner Akzent |
| Deep Space | Tiefes Blauviolett + Indigo-Akzent (passt zum Sternenfeld) |
| Kontrastreich | Schwarz + Cyan, stärkste Kontraste (Barrierefreiheit) |

Die Akzentfarbe färbt auch die animierten Hintergründe mit ein.

---

## 8. Hintergründe

| Modus | Beschreibung |
|---|---|
| Leiterplatte | PCB-Kulisse: Punkt-Raster, Leiterbahnen mit 45°-Bögen, Vias; Lichtpulse wandern entlang der Bahnen, an Vias ripplet es |
| Lightcycles | 3–5 „Cycles" fahren auf schwarzem Grund, biegen nur in 90°-Winkeln ab (nie denselben Weg zurück), hinterlassen ausfadende Lichtspuren (Cyan/Orange, balanciert) und **explodieren**, wenn sie in einen Schweif fahren — danach startet ein neues Cycle an freier Position |
| Sternenfeld | Dunkler Himmel mit 90–220 funkelnden Sternen und 5–11 langsam ziehenden **Asteroiden** mit Lichtspuren |
| Statisch | Nur das gerenderte Standbild, keine Animation |
| Eigenes Bild | Eigenes Hintergrundbild (JPG/PNG/WebP, max 4 MB) — cover-fit über die ganze Fläche, pro Browser gespeichert |

Gemeinsame Regeln für animierte Modi: Animation pausiert automatisch, wenn
der Tab im Hintergrund ist; bei `prefers-reduced-motion` („Bewegung reduzieren"
im Betriebssystem) bleibt es statisch. Rendering ist DPR-agnostisch (bis 2×
Retina) und sehr leichtgewichtig.

**Lesbarkeit über eigenen Bildern:** Dunkle Themes messen die Bildhelligkeit
hinter jeder Gruppenüberschrift und stellen den Textkontrast automatisch um
(heller Text auf dunkler Fläche, dunkler auf heller). Beim hellen
**Arctic**-Theme liegt hinter jeder Überschrift eine weiße, leicht
transparente Fläche — die Überschrift bleibt immer schwarz und lesbar, egal
ob das Bild hell oder dunkel ist.

---

## 9. Branding: Topbar-Text, Favicon, Akzentfarben

(⚙ → Registerkarte **Branding**)

### 9.1 Topbar-Text

Der Text nach „ZENTRIX" (standardmäßig `/homelab`) ist frei wählbar — z. B.
der Standort, die Abteilung oder ein Projektname. Maximal 40 Zeichen, wird
sofort übernommen.

### 9.2 Favicon

Eigenes Logo für den Browsertab hochladen (**PNG/ICO/SVG/JPEG/WebP**, max
256 KB). Standard ist ein **großes rotes Z** auf dunklem, abgerundetem Grund.
„Zurücksetzen" stellt das rote Z wieder her.

### 9.3 Akzentfarbe pro Theme

Jedes Theme hat eine Standard-Akzentfarbe; über den Farbwähler lässt sie sich
**individuell überschreiben**:

1. Theme wählen (z. B. Arctic)
2. Gewünschte Farbe im Farbwähler einstellen
3. **Übernehmen** — Akzentfarbe, Rahmen und Hintergrundanimationen färben
   sich mit um
4. **Theme-Standard** stellt die Originalfarbe des Themes wieder her

Die Einstellung wird pro Theme gespeichert — jedes Theme behält seine eigene
individuelle Farbe.

---

## 10. Speichern & Sync (Status-Chip)

Der Chip in der Topbar zeigt den Zustand:

| Anzeige | Bedeutung |
|---|---|
| `● server` | Auf dem Server gespeichert — alles gut |
| `● speichere…` | Speichert gerade (600 ms Entprellung) |
| `● lokal` | Server nicht erreichbar — Änderungen liegen nur im Browser |
| `● kein token` | Server erreichbar, aber kein Schreib-Token gesetzt → Chip anklicken |
| `● token falsch` | Token abgelehnt → Chip anklicken und korrektes Token eingeben |
| `● offline` | Weder Server noch lokale Kopie |

Der Token wird nur in diesem Browser gespeichert, nie im UI angezeigt und nur
beim Speichern an den Server gesendet.

**Fehlermeldungen des Servers** (Token-Fehler, ungültiges JSON, zu großer
Body …) kommen seit 1.6.3 in der jeweils eingestellten Sprache — das Frontend
übermittelt seine Sprache beim Speichern automatisch mit. Im Container liegt er unter
`/run/secrets/zentrix_token` (bzw. der gemounteten Token-Datei).

---

## 11. Tastenkürzel

| Kürzel | Wirkung |
|---|---|
| `Strg/Cmd + K` | Suche fokussieren |
| `Esc` | Suche leeren / Dialog schließen |

---

## 12. Mobile Verhalten

- Topbar bleibt **einzeilig**: Logo kompakt (ohne Zusatztext), Uhr/Chip
  kleiner, Buttons als Icons
- **Suchzeile** standardmäßig ausgeblendet; **⌕-Lupe** in der Topbar blendet
  sie ein, nach Treffer-Klick automatisch wieder aus
- Kacheln: größere Touch-Targets, 2-Spalten-Grid bis 400 px, darunter 1 Spalte
- Paarungen/Nebeneinander werden unter FullHD bewusst gestapelt (Lesbarkeit)
- Hover-Effekte sind auf Touch-Geräten durch Active-Zustände ersetzt

---

## 13. Technik & Dateien

```
index.html      UI (Markup + CSS; Themes als data-theme-Variablen)
app.js          Logik: Rendering, WYSIWYG, Settings, i18n-Anbindung
bg.js           Hintergründe (Canvas): PCB, Lightcycles, Sternenfeld, Eigenes Bild
i18n.js         24 Sprachen × 122 UI-Texte (generiert, vollständig validiert)
zentrix-server.py  Backend (Python 3, nur Stdlib, keine pip-Pakete)
links.json      Die Daten (entsteht beim ersten Speichern / aus dem Seed)
```

Backend-Endpunkte:

- `GET /` — Dashboard-UI
- `GET /api/links` — Daten lesen (öffentlich)
- `PUT /api/links` — Daten schreiben (nur mit `X-Auth-Token`-Header)
- `GET /api/health` — Healthcheck für Docker/Swarm

Sicherheit: timing-sicherer Token-Vergleich (`hmac.compare_digest`),
URL-/Icon-Validierung (nur `http(s)`; `javascript:`/`data:`/`file:` werden
abgelehnt), Strict CSP (`script-src 'self'`), `X-Frame-Options: DENY`,
`nosniff`, Rendering ausschließlich über `createElement`/`textContent` (kein
`innerHTML`), PUT-Body auf 512 KB begrenzt mit serverseitiger
JSON-Strukturvalidierung, atomare Schreibvorgänge (tmp + rename), kein
Path-Traversal. Eigenes Hintergrundbild und Favicon bleiben **im Browser**
(data-URL in localStorage) — sie verlassen den Rechner nie über den Server.

---

## 14. Docker-Betrieb

Image: `ghcr.io/sirius3r/zentrix-dashboard:latest`
(Demo-Daten: 15 Beispiel-Links in 5 Gruppen, Hostnamen/IPs neutralisiert)

Die Daten liegen im Container unter `/data/links.json` — dieses Verzeichnis
muss als Volume angebunden werden. Ein frisches, leeres Volume wird beim
ersten Start automatisch mit den Beispieldaten befüllt (Seed liegt zusätzlich
unter `/app/links-demo-seed.json`). Das Schreib-Token kommt als
Docker-Secret (`zentrix_token`).

### 14.1 Swarm-Betrieb — `compose-swarm.yaml`

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

Erreichbar im Swarm über das Overlay-Netz: `zentrix_dashboard:8080`
(Stack-Name + Service-Name) — der Reverse Proxy spricht den Service direkt
an. Mit veröffentlichtem Port zusätzlich:

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

Aufruf dann unter `http://<host>:8080`.

---

## 15. TLS / Reverse Proxy

Der Container spricht plain HTTP auf 8080. Für HTTPS einen Reverse Proxy
davorlegen (OPNsense-Acme, Caddy, nginx, Traefik) und auf
`zentrix_dashboard:8080` (Swarm) bzw. `http://<host>:8080` (Standalone)
zeigen lassen.

---

## 16. Fehlersuche

| Symptom | Ursache/Lösung |
|---|---|
| Alte Optik nach Update | Browser-Cache: `Strg+Shift+R` (app.js/i18n.js liegen bis 24 h im Cache) |
| Chip zeigt `kein token` | Chip anklicken, Token aus `/run/secrets/zentrix_token` (Swarm) bzw. der Token-Datei (Standalone) eingeben |
| Chip zeigt `token falsch` | Token geändert? Neues Token eingeben (Chip anklicken) |
| Chip zeigt `lokal`/`offline` | Server nicht erreichbar — `docker stack ps zentrix` bzw. `docker ps`, danach **Neu laden** |
| Änderungen nach Neustart weg | `/data` ist kein Volume gemountet — siehe Abschnitt 14 |
| Icons fehlen/leer | Icon-Katalog braucht Internet (jsDelivr); offline Icon-URL manuell eintragen |
| Überschriften schlecht lesbar über eigenem Bild | Dunkle Themes: automatisch (Bildhelligkeit wird gemessen). Arctic: weiße Platte hinter den Headern ist aktiv |
| „+ Neue Tabgruppe" unsichtbar | Seit 1.4.1 mit opaker Fläche — Cache leeren (`Strg+Shift+R`) |
| Bearbeiten-Button zeigt Text statt ✎ | Ältere Version im Cache — updaten und hart neu laden |
| Nebeneinander greift nicht | FullHD (≥ 1920 px) nötig; ⫲-Paarung nur im Bearbeiten-Modus sichtbar; globale Option im ⚙-Panel prüfen |
| Uhr weg | In ⚙ → „Datum & Uhr anzeigen" einschalten |
| Animation zu wild/ruhig | Anderen Hintergrund wählen; `prefers-reduced-motion` des OS wird respektiert |
| Sprache soll anders sein | ⚙ → Registerkarte Erscheinungsbild → Sprache; wird pro Browser gemerkt |
