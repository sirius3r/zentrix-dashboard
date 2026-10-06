# Zentrix Homelab Dashboard — Manuel utilisateur

**Version 1.8.0** · Septembre 2026

Le tableau de bord Zentrix est un dashboard homelab léger au design
« Binary » : tous les services du homelab en tuiles dans des groupes
librement organisables, avec stockage côté serveur, 24 langues, six thèmes,
fonds animés et un mode d'édition abouti. Pas de framework, pas d'outils de
build, pas de dépendances — uniquement des fichiers statiques et un petit
backend Python.

---

## Sommaire

1. [Fonctionnalités en un coup d'œil](#1-fonctionnalités-en-un-coup-dœil)
2. [L'interface](#2-linterface)
3. [Recherche](#3-recherche)
4. [Mode d'édition](#4-mode-dédition)
5. [Organiser les groupes & côte à côte](#5-organiser-les-groupes--côte-à-côte)
6. [Paramètres (⚙)](#6-paramètres-)
7. [Thèmes](#7-thèmes)
8. [Fonds](#8-fonds)
9. [Branding : texte, favicon, couleurs d'accent](#9-branding--texte-favicon-couleurs-daccent)
10. [Enregistrement & synchro (pastille)](#10-enregistrement--synchro-pastille)
11. [Raccourcis clavier](#11-raccourcis-clavier)
12. [Comportement mobile](#12-comportement-mobile)
13. [Architecture & fichiers](#13-architecture--fichiers)
14. [Fonctionnement Docker](#14-fonctionnement-docker)
15. [TLS / reverse proxy](#15-tls--reverse-proxy)
16. [Dépannage](#16-dépannage)

---

## 1. Fonctionnalités en un coup d'œil

| Domaine | Fonctionnalités |
|---|---|
| Liens | Tuiles avec nom, URL, icône ; sélecteur avec 3 300+ icônes (variantes claires/sombres) |
| Groupes | Nombre illimité, réordonnancement par glisser-déposer, disposition liste/grille par groupe |
| Côte à côte | Deux groupes précis côte à côte (bouton ⫲) ou toutes par paires (option) |
| Recherche | Filtre en direct, `Ctrl+K`, effacement auto après clic, loupe sur mobile |
| Thèmes | Binary, Phosphor, Amber, Arctic, Deep Space, Contraste élevé — couleur d'accent par thème |
| Fonds | Circuit imprimé (animé), Lightcycles avec collisions, Champ stellaire avec astéroïdes, Statique, image perso |
| Langues | 24 langues dont RTL (arabe) |
| Branding | Texte de barre supérieur personnalisé, favicon personnel (défaut : grand Z rouge) |
| Données | Stockage serveur protégé par jeton, export/import JSON |
| Mobile | Responsive, barre une ligne, tuiles compactes |

---

## 2. L'interface

### 2.1 Barre supérieure

De gauche à droite :

- **Logo ZENTRIX** — marque avec point d'état ; le texte après « ZENTRIX »
  (défaut `/homelab`) est configurable (cf. section 9)
- **Date & heure** — en direct, dans la langue choisie ; masquable dans les
  paramètres
- **Pastille de synchro** — état d'enregistrement (cf. section 10)
- **⌕ (loupe)** — uniquement sur écrans étroits : affiche la recherche
- **✎ (crayon)** — mode d'édition on/off (en mode : **✓**) ; icône seule avec
  infobulle pour garder la barre sur une ligne à toute largeur
- **⚙ (engrenage)** — ouvre le panneau de paramètres

Quand l'horloge est masquée, la pastille et tous les boutons s'alignent
proprement à droite — la barre reste toujours ordonnée.

### 2.2 Barre de recherche

Juste sous la barre supérieure. La saisie filtre en direct tous les noms et
URL.

- `Ctrl+K` (ou `Cmd+K`) focalise la recherche, `Échap` l'efface
- **Clic sur un résultat :** le lien s'ouvre dans un nouvel onglet et la
  barre de recherche s'efface automatiquement — le terme suivant peut être
  tapé immédiatement, sans Échap
- Sur écrans étroits (≤ 640 px) la recherche est masquée par défaut : la
  **loupe** de la barre supérieure l'affiche ; après un clic sur un résultat
  elle se masque à nouveau automatiquement

---

## 3. Recherche

| Action | Comportement |
|---|---|
| Saisie | Filtre en direct sur les noms et URL de tous les groupes |
| `Ctrl/Cmd + K` | Focaliser la recherche |
| `Échap` | Effacer la recherche |
| Clic sur un résultat | Lien dans un nouvel onglet ; champ auto-effacé |
| Loupe (mobile) | Afficher la recherche ; masquage auto après clic |

Les groupes vides sont masqués pendant la recherche ; si aucun résultat,
un message apparaît.

---

## 4. Mode d'édition

Cliquez sur l'**icône ✎** de la barre supérieure (en mode : **✓**) :

- **Modifier un lien :** cliquer la tuile → dialogue nom, URL, icône, groupe
- **Supprimer un lien :** ✕ en haut à droite de la tuile
- **Déplacer/trier un lien :** glisser la tuile — aussi vers un autre groupe
- **Ajouter un lien :** carte « + Ajouter un lien » en fin de groupe
- **Renommer un groupe :** cliquer le titre du groupe et saisir (Entrée
  valide)
- **Supprimer un groupe :** « ✕ Groupe » ou 🗑 près du titre

**Supprimer des groupes ne perd jamais de liens :** les liens passent dans
un autre groupe. Si vous supprimez le *dernier* groupe, le dashboard crée
automatiquement un nouveau groupe contenant tous les liens.

- **Réordonner les groupes :** en mode d'édition, chaque en-tête reçoit une
  **poignée ⠿** — glissez le groupe entier à n'importe quelle position
- **Nouveau groupe :** « + Nouveau groupe d'onglets » en fin de page
- **Appariement côte à côte :** bouton **⫲** sur l'en-tête (cf. section 5)

Chaque modification est enregistrée automatiquement (600 ms après la
dernière action).

### 4.1 Le dialogue de lien

- **Nom :** libre
- **URL :** seulement `http(s)` ; le protocole manquant est ajouté
  (`unifi.lan.example` → `https://…`). `javascript:`/`data:`/`file:` sont
  refusés.
- **Icône :** tapez un **mot** (ex. `unifi`, `emby`, `vaultwarden`) — une
  grille d'icônes du catalogue dashboard-icons apparaît (3 300+ entrées via
  jsDelivr, SVG privilégié). Le sélecteur inclut aussi les **variantes de
  couleur** : pour `vaultwarden` vous obtenez p. ex. `vaultwarden-light` et
  `vaultwarden-dark`. La saisie manuelle d'URL reste possible. Le catalogue
  est mis en cache 24 h dans le navigateur ; hors ligne, l'URL manuelle
  fonctionne.
- **Groupe :** groupe cible dans la liste déroulante (en modification, cela
  équivaut à déplacer le lien vers un autre groupe)

---

## 5. Organiser les groupes & côte à côte

### 5.1 Ordre

En mode d'édition, saisissez le groupe par la **poignée ⠿** et glissez-le à
la position souhaitée. L'ordre s'applique à la colonne unique — et détermine
*qui est apparié avec qui* (voir ci-dessous).

### 5.2 Deux groupes précis côte à côte (bouton ⫲)

En mode d'édition, chaque en-tête a un **bouton ⫲** :

1. Cliquer → le groupe est marqué (le bouton s'allume en couleur d'accent)
2. Il s'apparie avec le groupe qui **suit directement dans l'ordre** — les
   deux s'affichent en ligne à deux colonnes (à partir de FullHD)
3. Recliquer pour annuler l'appariement

Plusieurs paires peuvent être définies : A+B côte à côte, C+D côte à côte,
le reste empilé. Les appariements sont stockés par navigateur. En dessous
de FullHD, tout est volontairement empilé pour la lisibilité.

### 5.3 Tous les groupes par paires (option)

Sinon, l'option globale **« Deux groupes côte à côte »** du panneau ⚙ — tous
les groupes s'affichent par paires : 1+2 sur une ligne, 3+4 dessous, etc.
(dernier groupe impair seul). Cette option exclut l'option de nombre de
colonnes fixe (les deux utilisent le même menu déroulant).

### 5.4 Disposition par groupe

Chaque groupe peut basculer individuellement entre « empilé » (les tuiles
s'empilent) et « grille » (tuiles en colonnes). Le choix est mémorisé par
groupe.

---

## 6. Paramètres (⚙)

Le panneau est divisé en trois **onglets** : **Apparence** · **Branding** ·
**Données**.

Tous les paramètres sont stockés **par navigateur** (localStorage) et
restaurés à la prochaine visite. Ils s'appliquent immédiatement — pas de
bouton d'enregistrement ; le panneau se ferme via **Quitter** ou `Échap`.

---

## 7. Thèmes

Six thèmes, chacun avec une couleur d'accent librement choisissable (cf. 9.3) :

| Thème | Apparence |
|---|---|
| Binary (défaut) | Gris foncé + accent menthe |
| Phosphor | Gris foncé + vert néon (terminal rétro) |
| Amber | Gris foncé + ambre (terminal ambre classique) |
| Arctic | **Clair** — surface blanche, accent vert foncé |
| Deep Space | Bleu-violet profond + accent indigo ( assorti au champ stellaire) |
| Contraste élevé | Noir + cyan, contraste maximal (accessibilité) |

La couleur d'accent teinte aussi les fonds animés.

---

## 8. Fonds

| Mode | Description |
|---|---|
| Circuit imprimé | Scène PCB : grille de points, pistes à coudes 45°, vias ; des impulsions lumineuses voyagent le long des pistes, ondulation aux vias |
| Lightcycles | 3–5 « cycles » roulent sur fond noir, ne tournent qu'à 90° (ne reprennent jamais leur chemin), laissent des traînées lumineuses estompantes (cyan/orange, équilibrées) et **explosent** s'ils entrent dans une traînée — ensuite un nouveau cycle démarre à une position libre |
| Champ stellaire | Ciel sombre avec 90–220 étoiles scintillantes et 5–11 **astéroïdes** dérivant lentement avec traînées lumineuses |
| Statique | Seulement l'image rendue fixe, pas d'animation |
| Image personnelle | Votre propre image de fond (JPG/PNG/WebP, max 4 Mo) — cover-fit sur toute la surface, stockée par navigateur |

Règles communes aux modes animés : l'animation se met en pause quand l'onglet
est en arrière-plan ; avec `prefers-reduced-motion` (« réduire les
animations » de l'OS) elle reste statique. Le rendu est adapté au DPR
(jusqu'à 2× retina) et très léger.

**Lisibilité sur images personnelles :** les thèmes sombres mesurent la
luminosité de l'image derrière chaque titre de groupe et ajustent
automatiquement le contraste du texte (texte clair sur zone sombre, foncé
sur claire). Sur le thème clair **Arctic**, une plaque blanche légèrement
translucide se trouve derrière chaque titre — le titre reste toujours noir
et lisible, que l'image soit claire ou sombre.

---

## 9. Branding : texte, favicon, couleurs d'accent

(⚙ → onglet **Branding**)

### 9.1 Texte de la barre supérieure

Le texte après « ZENTRIX » (défaut `/homelab`) est librement configurable —
p. ex. un lieu, un service ou un nom de projet. Maximum 40 caractères,
appliqué immédiatement.

### 9.2 Favicon

Téléversez votre propre logo pour l'onglet du navigateur
(**PNG/ICO/SVG/JPEG/WebP**, max 256 Ko). Le défaut est un **grand Z rouge**
sur fond sombre arrondi. « Réinitialiser » restaure le Z rouge.

### 9.3 Couleur d'accent par thème

Chaque thème a une couleur d'accent par défaut que vous pouvez
**individuellement remplacer** :

1. Choisir le thème (ex. Arctic)
2. Régler la couleur souhaitée dans le sélecteur
3. **Appliquer** — l'accent, les bordures et les fonds animés se teintent
4. **Valeur par défaut du thème** restaure la couleur d'origine

Le réglage est stocké par thème — chaque thème garde sa propre couleur
personnalisée.

---

## 10. Enregistrement & synchro (pastille)

La pastille dans la barre supérieure affiche l'état :

| Affichage | Signification |
|---|---|
| `● serveur` | Enregistré sur le serveur — tout va bien |
| `● enregistrement…` | Enregistrement en cours (anti-rebond 600 ms) |
| `● local` | Serveur injoignable — les modifications ne sont que dans ce navigateur |
| `● pas de jeton` | Serveur joignable mais aucun jeton d'écriture défini → cliquer la pastille |
| `● jeton invalide` | Jeton refusé → cliquer la pastille et saisir le bon jeton |
| `● hors ligne` | Ni serveur ni copie locale |

Le jeton n'est stocké que dans ce navigateur, jamais affiché dans l'UI et
seulement envoyé au serveur lors de l'enregistrement. Dans le conteneur, il
se trouve sous `/run/secrets/zentrix_token` (ou le fichier de jeton monté).

**Les messages d'erreur du serveur** (erreurs de jeton, JSON invalide, corps
trop grand …) arrivent depuis 1.6.3 dans la langue sélectionnée — le frontend
transmet automatiquement sa langue à l'enregistrement.

---

## 11. Raccourcis clavier

| Raccourci | Effet |
|---|---|
| `Ctrl/Cmd + K` | Focaliser la recherche |
| `Échap` | Effacer la recherche / fermer les dialogues |

---

## 12. Comportement mobile

- La barre supérieure reste sur **une ligne** : logo compact (sans suffixe),
  horloge/pastille plus petites, boutons en icônes
- **Barre de recherche** masquée par défaut ; la **loupe** de la barre
  l'affiche, masquage auto après un clic sur un résultat
- Tuiles : zones tactiles plus grandes, grille 2 colonnes jusqu'à 400 px,
  1 colonne en dessous
- Les appariements/côte à côte sont volontairement empilés sous FullHD
- Les effets de survol sont remplacés par des états actifs sur tactile

---

## 13. Architecture & fichiers

```
index.html      UI (markup + CSS ; thèmes en variables data-theme)
app.js          Logique : rendu, WYSIWYG, paramètres, liaison i18n
bg.js           Fonds (canvas) : PCB, Lightcycles, Champ stellaire, image perso
i18n.js         24 langues × 122 textes UI (généré, validé)
zentrix-server.py  Backend (Python 3, stdlib uniquement)
server_i18n.py  Traductions des messages d'erreur serveur (24 langues)
links.json      Les données (créées au premier enregistrement / depuis le seed)
```

Points d'accès du backend :

- `GET /` — UI du dashboard
- `GET /api/links` — lecture des données (public)
- `PUT /api/links` — écriture (requiert l'en-tête `X-Auth-Token`)
- `GET /api/health` — health check pour Docker/Swarm

Sécurité : comparaison de jeton timing-safe (`hmac.compare_digest`),
validation URL/icône (seulement `http(s)`), CSP stricte
(`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`, rendu
exclusivement via `createElement`/`textContent` (pas de `innerHTML`), corps
PUT limité à 512 Ko avec validation de structure JSON côté serveur,
écritures atomiques (tmp + rename), pas de path traversal. L'image de fond
personnalisée et le favicon restent **dans le navigateur** (data-URL dans le
localStorage) — ils ne quittent jamais votre machine via le serveur.

---

## 14. Fonctionnement Docker

Image : `ghcr.io/sirius3r/zentrix-dashboard:latest`
(Données de démo : 15 liens d'exemple en 5 groupes, noms/IP neutralisés)

Les données sont dans le conteneur sous `/data/links.json` — ce répertoire
doit être monté comme volume. Un volume frais et vide est automatiquement
semé avec les données de démo au premier démarrage (une copie du seed se
trouve aussi sous `/app/links-demo-seed.json`). Le jeton d'écriture vient
d'un secret Docker (`zentrix_token`).

### 14.1 Fonctionnement Swarm — `compose-swarm.yaml`

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

Accessible dans le swarm via le réseau overlay : `zentrix_dashboard:8080`
(nom de stack + nom de service) — le reverse proxy adresse le service
directement. Avec un port publié en plus :

```yaml
    ports:
      - target: 8080
        published: 8080
        protocol: tcp
        mode: ingress
```

### 14.2 Autonome (docker compose) — `compose-standalone.yaml`

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

Accessible ensuite sous `http://<hôte>:8080`.

---

## 15. TLS / reverse proxy

Le conteneur parle HTTP simple sur 8080. Pour HTTPS, placez un reverse proxy
devant (OPNsense Acme, Caddy, nginx, Traefik) pointant vers
`zentrix_dashboard:8080` (Swarm) ou `http://<hôte>:8080` (autonome).

---

## 16. Dépannage

| Symptôme | Cause/solution |
|---|---|
| Ancienne apparence après mise à jour | Cache navigateur : `Ctrl+Shift+R` (app.js/i18n.js en cache jusqu'à 24 h) |
| Pastille `pas de jeton` | Cliquer la pastille, saisir le jeton de `/run/secrets/zentrix_token` (Swarm) ou du fichier de jeton (autonome) |
| Pastille `jeton invalide` | Jeton modifié ? Saisir le nouveau jeton (cliquer la pastille) |
| Pastille `local`/`hors ligne` | Serveur injoignable — `docker stack ps zentrix` / `docker ps`, puis **Recharger** |
| Modifications perdues après redémarrage | `/data` n'est pas monté en volume — cf. section 14 |
| Icônes manquantes/vides | Le catalogue d'icônes nécessite Internet (jsDelivr) ; hors ligne, saisir l'URL de l'icône |
| Titres peu lisibles sur image perso | Thèmes sombres : automatique (luminosité mesurée). Arctic : plaque blanche active |
| « + Nouveau groupe » invisible | Opaque depuis 1.4.1 — vider le cache (`Ctrl+Shift+R`) |
| Bouton d'édition en texte au lieu de ✎ | Ancienne version en cache — mettre à jour et recharger |
| Côte à côte sans effet | FullHD (≥ 1920 px) requis ; appariement ⫲ visible seulement en mode édition ; vérifier l'option globale dans ⚙ |
| Horloge absente | Activer dans ⚙ → « Afficher la date et l'heure » |
| Animation trop agitée/calme | Choisir un autre fond ; `prefers-reduced-motion` de l'OS est respecté |
| Langue à changer | ⚙ → onglet Apparence → Langue ; mémorisé par navigateur |
| Erreurs serveur dans la mauvaise langue | Le frontend envoie sa langue à l'enregistrement ; les appels API directs respectent `?lang=` et `Accept-Language` |
