# Bingie — l'espace multimédia de Nexus

Bingie regroupe dans Nexus tout ce qui pilote la télé (Kodi, skin Bingie) : un seul cadre, une seule
connexion, des modules chargés à la demande. Une entrée « Bingie » dans la barre latérale de Nexus.

## Routes et modules

| Route | Module | Service | Ancienne adresse (redirigée) |
|---|---|---|---|
| `/bingie` | → premier module (`/bingie/ecrans`) | | |
| `/bingie/ecrans` | atelier des écrans de la télé | kube-trakt | `/trakt` |
| `/bingie/reglages` | réglages Kodi et skin | kube-trakt | `/trakt/reglages` |
| `/bingie/sources` | profils de qualité et priorité des sources | kube-aggregator | `/aggregator` |
| `/bingie/services` | état des services, appareils | kube-trakt | `/trakt/service` |

Code : `apps/dashboard/src/app/features/bingie/`

- `bingie-registry.ts` — **registre des modules** : la seule liste à modifier. Routes, onglets,
  titres et redirections des anciennes adresses en sont déduits.
- `shell/` — cadre plein écran (barre, onglets, session, retour à Nexus) et ses couleurs (noir,
  accent rouge) : les modules utilisent les jetons de Nexus, redéfinis par le cadre.
- `bingie-session.ts` — session d'administration commune, intercepteur qui joint le jeton
  anti-CSRF aux écritures Bingie (et à elles seules) et ouvre la connexion sur un refus.
- `bingie-unsaved.ts` — modifications non enregistrées par module : pastille sur l'onglet,
  avertissement avant de fermer ou recharger.
- `modules/<service>/` — le code de chaque service (aujourd'hui `trakt`, `aggregator`).

### Ajouter un service

1. Créer `modules/<service>/` avec un composant autonome (`standalone`).
2. Ajouter une entrée à `BINGIE_MODULES` : `path`, `label` (et `short` pour le téléphone),
   `description`, `backend`, `layout` (`page` défile, `screen` occupe l'écran sous la barre),
   `load: () => import(...)`, et `legacy` si une ancienne adresse doit y mener.
3. Écritures côté API : `@UseGuards(WriteGuard)` sur chaque route qui modifie, préfixe ajouté à
   `BINGIE_WRITE_APIS` côté tableau de bord. `write-routes.spec.ts` échoue si une écriture
   n'est pas protégée.
4. Brouillon à garder entre modules : service `providedIn: 'root'` qui appelle
   `BingieUnsaved.set('<path>', dirty)` (voir `modules/aggregator/aggregator-draft.ts`).

Rien d'autre à toucher : ni `app.routes.ts`, ni la barre latérale, ni le cadre.

## Sécurité des écritures

Inventaire (vérifié par réflexion dans `apps/api/src/app/auth/write-routes.spec.ts`) :

- kube-trakt via Nexus : 18 écritures (`POST`/`PUT`/`DELETE` : listes, écrans, menu, logos,
  rangées, réglages, appareils) → `WriteGuard` ; 14 lectures → publiques, inchangées.
- kube-aggregator via Nexus : `PUT /api/aggregator/preferences` → `WriteGuard` ; lecture et
  `POST /api/aggregator/preview` (calcul sans écriture) → publics.
- `WriteGuard` : cookie de session signé + en-tête `X-CSRF-Token` lié + `Origin` dans
  `NEXUS_WRITE_ORIGINS`. Sans configuration : écritures refusées (503).
- Autres modules Nexus : non modifiés (ni garde, ni intercepteur : celui-ci ne touche que
  `/api/trakt/` et `/api/aggregator/`).
- Clients automatiques : aucun n'écrit par Nexus. L'addon des rangées du rpi5 publie directement
  à kube-trakt (`/admin/row-snapshots`), pas par `/api/trakt` ; il n'est pas concerné.

## Incompatibilités

- Les écritures Trakt (atelier, réglages, révocation d'appareil) **exigent désormais une
  connexion**. Sans Secret `nexus-admin`, elles répondent 503 : l'atelier reste consultable
  mais plus modifiable.
- Signets `/trakt…` et `/aggregator` : redirigés, rien à changer.
- La page Services n'est plus celle qu'ouvre `/trakt` (c'est l'atelier, comme avant).

## Déploiement (préparé, rien d'appliqué)

Prérequis, **avant** de déployer les images Bingie (sinon l'édition Trakt casse) :

1. Secrets d'administration, générés localement sans affichage :
   `tools/nexus-admin-secret.sh` → `.local/nexus-admin/` (ignoré par Git, mode 600) :
   `password` (à ranger dans le gestionnaire de mots de passe : `pbcopy < …/password`) et
   `nexus-admin.env`. Secret Kubernetes, sans afficher les valeurs :
   `kubectl --context homelab -n nexus create secret generic nexus-admin --from-env-file=.local/nexus-admin/nexus-admin.env --dry-run=client -o yaml | kubeseal …`
   (SealedSecret dans le dépôt d'infrastructure).
2. Values Nexus : `api.envFromSecrets: [nexus-admin]`, `writeOrigins` = URL publique de Nexus.
   `CORS_ORIGIN` reste inchangé.
3. Images api et dashboard reconstruites depuis cette branche (ArgoCD).
4. Optionnel, pour l'onglet Sources en écriture : étapes 1 et 4 de `docs/AGGREGATOR.md`
   (certificat `kagg-private-nexus`, `api.aggregator.enabled: true`, écrivain déclaré dans
   kube-aggregator). Sans elles, l'onglet Sources affiche « backend injoignable » ; les autres
   modules fonctionnent.
5. Vérifier : `/trakt` → `/bingie/ecrans` ; lecture sans connexion ; masquer/réafficher une
   entrée de menu → connexion demandée, puis acceptée ; `curl -X DELETE …/api/trakt/devices/x`
   sans cookie → 401.

## Retour arrière

- Images : revenir aux images Nexus précédentes (révision ArgoCD précédente). Les routes
  `/trakt…` et `/aggregator` d'origine reviennent ; les signets `/bingie…` mènent alors à
  l'accueil.
- Code : `git revert` du commit Bingie (aucune migration de données, aucun changement de
  schéma, aucune donnée stockée dans le tableau de bord).
- Secret `nexus-admin` : peut rester (inutilisé par les anciennes images, sauf Aggregator).
- kube-trakt, kube-aggregator, Kodi : non modifiés, rien à défaire.

## Tests

- `npx nx test api` : inventaire des écritures protégées et lectures publiques
  (`write-routes.spec.ts`), refus réel sans session puis acceptation
  (`trakt.write-guard.http.spec.ts`), session, garde, relais Aggregator.
- `npx jest --config apps/dashboard/jest.config.cts apps/dashboard/src/app/features/bingie` :
  registre (routes, redirections, ajout d'un module), détection des écritures, éditeur.
- Chromium (faux Nexus local, données fictives) : `npx nx build dashboard` puis
  `tools/ui-check/run.sh bureau|mobile bingie` (redirections, onglets, chargement des modules
  sans rechargement de page, refus et connexion, brouillon conservé, débordements) et
  `tools/ui-check/run.sh bureau|mobile aggregator` (éditeur complet via `/aggregator`).
