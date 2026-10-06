# Zentrix Homelab Dashboard

Un tableau de bord homelab léger au design « Binary » : les services en
tuiles dans des groupes librement organisables — avec stockage côté serveur,
24 langues, thèmes, fonds animés et édition WYSIWYG. Pas de framework, pas
d'outils de build, aucune dépendance à l'exécution : uniquement des fichiers
statiques et un petit backend Python (stdlib uniquement).

![Version](https://img.shields.io/badge/version-1.8.0-blue)
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
