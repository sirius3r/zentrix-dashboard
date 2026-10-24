# Zentrix Homelab Dashboard

Un tableau de bord homelab léger au design « Binary » : les services en
tuiles dans des groupes librement organisables — avec stockage côté serveur,
24 langues, thèmes, fonds animés et édition WYSIWYG. Pas de framework, pas
d'outils de build, aucune dépendance à l'exécution : uniquement des fichiers
statiques et un petit backend Python (stdlib uniquement).

![Version](https://img.shields.io/badge/version-1.12.0-alpha-blue)
![Python](https://img.shields.io/badge/python-3.12-informational)
![License](https://img.shields.io/badge/license-MIT-green)

> 🇩🇪 Version allemande : [README.md](../de/README.md) · [HANDBUCH.md](../de/HANDBUCH.md)
> 🇬🇧 Version anglaise : [README.md](../../README.md) · [HANDBUCH.md](../../HANDBUCH.md)

## Fonctionnalités

- **Tuiles & groupes** — liens avec nom/URL/icône, sélecteur d'icônes avec
  plus de 3 300 icônes (variantes claires/sombres incluses), glisser-déposer
  pour les liens *et* les groupes
- **Recherche** — filtre en direct, `Ctrl+K`, effacement automatique après
  un clic sur un résultat
- **6 thèmes** — Binary, Phosphor, Amber, Arctic (clair), Deep Space,
  Contraste élevé ; **couleur d'accent libre par thème**
- **5 fonds** — Circuit imprimé (animé), Lightcycles (avec collisions et
  explosions), Champ stellaire avec astéroïdes, Statique, image personnelle
- **24 langues** — dont RTL (arabe), détection automatique de la langue
- **Branding** — texte de barre supérieur personnalisé, favicon personnel
- **Synchro serveur** — enregistrement protégé par jeton, export/import JSON
- **Table ARP & répartition IP** — vue des appareils en direct depuis les API
  routeurs (OPNsense : ARP + baux DHCP, mDNS passif), identification fabricant
  via IEEE OUI (~58k entrées), graphe agrégé avec clusters par zone et liste
  d'appareils consultable
- **Lisibilité adaptative** — les titres de groupes ajustent automatiquement
  leur contraste à l'image de fond
- **Mobile** — barre supérieure une ligne, loupe pour la recherche, optimisé
  tactile

## Démarrage rapide (Docker)

```bash
docker run -d --name zentrix \
  -p 8080:8080 \
  -v zentrix_data:/data \
  ghcr.io/sirius3r/zentrix-dashboard:latest
```
> **Remarque :** `-e ZENTRIX_TOKEN=…` (variable d'environnement) prime toujours
> sur le fichier de token. Sans elle, un token aléatoire est généré au premier
> démarrage et affiché dans les logs (`docker logs zentrix | grep -A1 token`).


→ http://localhost:8080 — au premier démarrage, le fichier de démo
`links.json` est semé dans le volume ; le jeton d'écriture se trouve dans
les logs du conteneur (`docker logs zentrix | grep token`).

Avec votre propre jeton :

```bash
docker run -d --name zentrix -p 8080:8080 \
  -v zentrix_data:/data \
  -e ZENTRIX_TOKEN=mon-jeton-secret \
  ghcr.io/sirius3r/zentrix-dashboard:latest
```

## Sans Docker

```bash
python3 zentrix-server.py
# → http://0.0.0.0:8080  (le jeton est généré et stocké dans token.txt)
```

## Photo de fond Immich

Faites défiler l'arrière-plan du dashboard avec un album photo de votre
instance **Immich**. Configuration dans les réglages (⚙ → Branding → Immich)
ou via variables d'environnement / secrets Docker :

| Variable | Fichier secret | Signification |
|---|---|---|
| `IMMICH_URL` | `IMMICH_URL_FILE` | URL de base Immich, ex. `http://immich-server:2283` |
| `IMMICH_API_KEY` | `IMMICH_API_KEY_FILE` | Clé API Immich (Paramètres → API Keys) |
| `IMMICH_ALBUM` | `IMMICH_ALBUM_FILE` | Nom de l'album |
| `IMMICH_INTERVAL` | — | Intervalle de rotation en secondes (min 60, défaut 3600) |

**Créer la clé API (Immich) :** connectez-vous à l'interface web Immich →
cliquez sur l'icône de profil en haut à droite → **Paramètres du compte** →
**Clés API** → **Nouvelle clé API** (donnez un nom, ex. « Zentrix ») → copiez
la clé affichée (une seule fois) et saisissez-la dans Zentrix (⚙ → Branding →
Immich) ou via secret/ENV. La clé peut être révoquée et recréée à tout moment
dans Immich.
Lors de la création, n'accordez que les **permissions minimales** dont
Zentrix a besoin : `asset.read`, `asset.view` (miniature) et `album.read` —
rien de plus (`asset.download` n'est **pas** requis, Zentrix ne récupère que
des miniatures preview).

La clé API **ne quitte jamais le serveur** : le dashboard récupère la photo
actuelle via `GET /api/immich/photo` (same origin) — le navigateur ne reçoit
que les octets de l'image, jamais les identifiants. La configuration GUI
(champ clé en écriture seule) prime sur les valeurs env/secret. Rotation par
shuffle-bag : chaque photo apparaît exactement une fois par cycle.

## Topologie réseau (Phase 1)

Le dashboard peut afficher les appareils de votre réseau sous forme de
topologie en direct. Sources de données (⚙ → Gateway) :

- **OPNsense (API)** — table ARP + baux DHCPv4 via l'API REST. Créez une clé
  API dédiée (ou un utilisateur en lecture seule) ; la clé/le secret restent
  sur le serveur Zentrix (champs en écriture seule, jamais envoyés au
  navigateur).
- **mDNS (passif)** — écoute les diffusions UDP 5353 sans envoyer de
  requêtes.

**IP publique :** la carte WAN affiche la vraie IP publique, résolue via un
service d'écho externe (défaut : `http://checkip.dyndns.org/`, cache de
10 minutes). Surchargeable avec `ZENTRIX_PUBLIC_IP_URL` (ou
`ZENTRIX_PUBLIC_IP_URL_FILE`, ou `public_ip_url` dans `sources.json`) ; la
valeur `-` désactive la requête.

## DNS dynamique (mise à jour d'enregistrement A)

Garde un enregistrement DNS A synchronisé avec votre IP publique dynamique —
configurable dans ⚙ → DDNS :

- **URL de mise à jour** avec variables `{ip}` `{host}` `{user}` `{pass}`
  (compatible avec tout fournisseur du protocole DynDNS). `{user}:{pass}@`
  dans l'URL est traduit en HTTP Basic ; sans variables, utilisateur/mot de
  passe sont envoyés en Basic automatiquement.
- **Intervalle de vérification** (défaut 300 s, min 60) : résout
  l'enregistrement A via le résolveur système et le compare à l'IP publique —
  une mise à jour n'est envoyée **qu'en cas d'écart**.
- **Intervalle de mise à jour** (défaut 300 s, min 60) : espacement minimal
  entre deux appels de mise à jour (limite contre le flottement d'IP et les
  blocages de fournisseurs).
- **Hôte IP** : quel service d'écho détecte l'IP publique (vide = valeur par
  défaut du tableau de bord `http://checkip.dyndns.org/`).

Le mot de passe est en écriture seule (jamais renvoyé au navigateur), la
configuration se trouve dans `ddns.json` dans le volume de données ; la GUI
prime sur les variables d'environnement (`DDNS_UPDATE_URL`, `DDNS_HOST`,
`DDNS_USER`, `DDNS_PASSWORD`, `DDNS_CHECK_S`, `DDNS_UPDATE_S`,
`DDNS_ENABLED`, plus les variantes `*_FILE`). Après 3 échecs consécutifs,
l'outil marque une pause de 5 minutes. Boutons : *Tester la connexion*,
*Vérifier maintenant*, *Mettre à jour maintenant*.

> **Privilèges OPNsense requis** (System → Access → Users → ✎ →
> *Privilèges*) : **Diagnostics: ARP Table** et **Diagnostics: Network
> Insight**. Les données de baux DHCP nécessitent en plus la permission de
> lecture du service DHCP ; les interfaces proviennent de *Diagnostics:
> Interfaces*. Si l'API répond `403`, l'un d'eux manque.

Les appareils de toutes les sources sont fusionnés (par MAC, sinon par IP),
les fabricants proviennent du registre IEEE OUI embarqué, et chaque appareil
affiche ses sources et son niveau de confiance. La vue topologie est en
lecture seule : Zentrix n'écrit jamais dans le routeur.

**FRITZ!Box (TR-064)** — le routeur AVM classique est également pris en
charge : SOAP sur HTTP (port 49000) avec authentification HTTP-Digest, liste
des appareils via `X_AVM-DE_GetHostListPath` (liste complète incl. type
Wi-Fi/Ethernet, réseau invités, durées de bail), nombre d'appareils et modèle
via le service standard Hosts:1. Il faut un utilisateur FRITZ!Box dédié
(accès Heimnetz — jamais le compte admin) ; à n'utiliser que sur le réseau
local, le TR-064 est non chiffré sur le port 49000 (`https://…:49443` pour
TLS).

Configuration sur la FRITZ!Box (vérifiée sous FRITZ!OS) :

1. **Activer l'accès apps** — Réseau domestique → Réseau → *Modifier les
   réglages réseau avancés* → *Autoriser l'accès pour les applications*
   (activé par défaut ; interface allemande : Heimnetz → Netzwerk →
   Erweiterte Netzwerkeinstellungen ändern → Zugriff für Apps erlauben).
2. **Créer un utilisateur** — Système → *Utilisateurs FRITZ!Box* (interface
   allemande : System → FRITZ!Box-Benutzer). Le droit *Réglages de la
   FRITZ!Box* suffit ; attention : ce droit inclut implicitement messagerie
   vocale, télécopies, FRITZ!App Fon, journal d'appels et Smart Home.

La configuration se trouve dans `sources.json` dans le volume de données ;
les réglages GUI priment sur les variables d'environnement (`OPNSENSE_URL`,
`OPNSENSE_API_KEY`, `OPNSENSE_API_SECRET`, `FRITZBOX_URL`, `FRITZBOX_USER`,
`FRITZBOX_PASSWORD`).

> **Identifiants OPNsense :** Zentrix utilise la paire *clé API + secret API*
> qu'OPNsense affiche une seule fois à la création (Système → Accès →
> Utilisateurs → ✎ → Clés API → +). Saisissez la **clé** dans le champ
> « API-Key » et le **secret** dans « API-Secret » — Zentrix les envoie en
> authentification Basic HTTP. L'URL de base suffit (ex.
> `https://opnsense.lan:444`) ; les chemins API sont ajoutés
> automatiquement, les sous-chemins reverse-proxy et ports personnalisés
> fonctionnent directement.

## Swarm / Compose

Des fichiers de stack prêts à l'emploi sont dans la racine du dépôt :
`compose-swarm.yaml` (réseau overlay, contraintes de placement — attention,
`replicas` doit se trouver **dans `deploy:`** pour Swarm) et
`compose-standalone.yaml`.

## Documentation

Le manuel utilisateur complet (16 chapitres : utilisation, thèmes, fonds,
dépannage …) est dans [`HANDBUCH.md`](HANDBUCH.md). Traductions allemande
et anglaise dans le répertoire racine et `en/`.

## Sécurité

- Accès en écriture protégé par jeton, comparaison timing-safe
- Validation des URL (seulement `http(s)`), CSP stricte, pas de `innerHTML`
- Limite de corps PUT 512 Ko, écritures atomiques, pas de path traversal

## Licence

[MIT](../../LICENSE)
