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

## Déploiement (API seule en service, dashboard en attente)

API validée le 9 novembre 2026, dashboard précédent conservé au point d'arrêt obligatoire :
voir le [bilan de livraison](BINGIE_API_20261109.md). Les étapes suivantes restent la procédure
générale ; aucune autorisation pour le dashboard ou le raccordement Aggregator n'est acquise.

Procédure vérifiée, prérequis, ordre des opérations et accords nécessaires :
[`BINGIE_DEPLOIEMENT.md`](BINGIE_DEPLOIEMENT.md). Les secrets locaux existent déjà et sont
valides : ne pas les régénérer. `.local/` est exclu de Git et du contexte Docker.

1. Contrôler ImageUpdater/ArgoCD avant toute publication d'image ; la CI actuelle ne se
   déclenche que sur `main`. Aucun push ou déploiement sans accord explicite.
2. Livrer le SealedSecret admin, attendre le Secret ; **ajouter** `nexus-admin` à
   `api.envFromSecrets` sans remplacer les autres références. Configurer
   `api.aggregator.writeOrigins` et `secureCookie` (session Bingie, même avec Aggregator
   désactivé). `CORS_ORIGIN` reste inchangé.
3. Déployer l'API avec cette configuration ; valider la connexion et les refus d'écriture
   avant de basculer le dashboard. Sans Secret et origine admise, l'édition Trakt répond 503.
4. Raccordement Sources ensuite : certificat dédié signé par la CA existante, SealedSecret,
   `api.aggregator.enabled: true`, lecture/aperçu vérifiés ; déclarer l'écrivain côté
   kube-aggregator en dernier. Sans raccordement, les autres modules fonctionnent.
5. Vérifier les redirections, lectures publiques et navigation. Pour un refus sans session,
   fournir une `Origin` admise : 401 ; sans `Origin`, la garde répond 403. Aucun changement
   réel de réglage Kodi ou de préférences n'est nécessaire à cette validation.

## Retour arrière

- Images : verrouiller ImageUpdater et revenir aux images Nexus précédentes par GitOps
  (référence exacte dans la procédure). Les routes
  `/trakt…` et `/aggregator` d'origine reviennent ; les signets `/bingie…` mènent alors à
  l'accueil.
- Le seul revert du commit Bingie ne retire pas l'éditeur/authentification des commits
  précédents. Aucun changement de schéma ni migration de données Trakt/Aggregator à annuler.
- Secret `nexus-admin` : peut rester (inutilisé par les anciennes images, sauf Aggregator).
- Si le droit Nexus a été accordé : retirer la paire `--preference-writer
  kagg-private-nexus=nexus` côté kube-aggregator (révision 14 sans écrivain comme référence).
  Préserver les données et les autres clients ; aucune action sur Kodi ou kube-trakt.

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
