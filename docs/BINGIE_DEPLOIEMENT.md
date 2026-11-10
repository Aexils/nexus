# Mise en service Bingie — préparation du 9 novembre 2026

**Point d'arrêt atteint : API seule en service et validée ; dashboard en attente d'accord.**
Voir le [bilan de livraison](BINGIE_API_20261109.md) pour les commits, images, verrous,
contrôles et mesure de l'interruption. Les observations de préparation ci-dessous sont
historiques ; elles ne remplacent pas ce bilan de l'état déployé.

## Accord de livraison reçu après la préparation

Le propriétaire autorise la publication de la branche de livraison Nexus et des changements
GitOps nécessaires, sans fusion dans `main`, puis le déploiement de **l'API uniquement**.
Le gel d'ImageUpdater et la disponibilité des images de retour doivent être vérifiés avant
publication. **Arrêt obligatoire après validation API** : le dashboard conserve son image
`574d759…` jusqu'à un nouvel accord. Aucun certificat ni écrivain Aggregator, aucune action Pi.
Les sections suivantes décrivent la préparation et le chemin complet ; leurs étapes dashboard
et phase 2 restent non autorisées.

**État lors de la préparation : aucune mise en service encore effectuée.**
Périmètre : Nexus, puis raccordement de ses préférences à kube-aggregator. Aucun changement
sur le Pi, les sources, AllDebrid, ntfy ou kagg-watchdog. Tous les appels Kubernetes utilisent
`--context homelab`. Aucune fusion dans `main` ; l'accord reçu ensuite borne les push Git.

## Point de départ vérifié

- Nexus local : `feature/aggregator-preferences`, HEAD `9d691d4`, propre à la reprise.
  Trois commits au-dessus de `main`/`origin/main` local (`574d759`).
- Corrections de préparation non commitées : exclusion Docker de `.local/`, origines et cookie
  de session injectés même si Aggregator est désactivé, présente procédure et documentation liée.
- Routes et redirections Bingie, cadre et modules différés présents ; 19 écritures protégées
  (18 Trakt, 1 Aggregator), 16 lectures/aperçus publics. Aucun classement réimplémenté dans Nexus.
- Écart mineur au bilan transmis : le registre ne déclare pas d'icône par module ; la barre
  latérale porte l'icône TV commune. Aucun effet sur le déploiement, aucune retouche UI engagée.
- Secrets locaux : les deux fichiers `.local/nexus-admin/` existent, mode 600, ignorés par Git ;
  mot de passe vérifié contre son empreinte scrypt, secret de session valide. Rien régénéré.
- Pas de serveur de développement Nexus repéré ; deux processus internes Nx déjà actifs.
- Cluster consulté en lecture seule : application Nexus `Healthy / Synced` ; images API et
  dashboard `ghcr.io/aexils/nexus-{api,dashboard}:574d7598e17c75a405df834b4e1269ec262dab4b`.
  Révisions Deployment : API 70, dashboard 77. Dernière opération ArgoCD : historique 84,
  sources `574d7598e17c75a405df834b4e1269ec262dab4b` et
  `7cfde78fdd37abac39090ad11bde890c1bddf8b4` (infra, deux sources).
- `nexus-admin` et `kagg-private-nexus` absents du namespace `nexus` ; aucune configuration
  d'authentification Bingie ou Aggregator injectée dans l'API déployée.
- kube-aggregator : Deployment `kagg-api`, namespace `kube-aggregator-dev-three-sources`,
  révision 14, ConfigMap `runtime-shared-preferences-v7`, aucun écrivain déclaré.
  La version 0 des préférences est rapportée par la session précédente, pas relue ici.
- Réseau existant compatible : Nexus sans restriction de sortie ; `private-client-ingress`
  admet le réseau des pods sur TCP 8765. Aucun changement réseau requis.

Le clone local `homelab` est en retard sur l'état ArgoCD et contient des fichiers non suivis
`storyteller-feeder`. Ne pas les modifier et ne pas utiliser ses anciennes valeurs d'image
comme point de retour. Relever de nouveau les versions juste avant toute mise en service.

## Chemin de livraison et verrou préalable

La CI initiale `.github/workflows/docker.yml` ne publiait que sur push de `main`.
Pour la livraison autorisée, elle accepte aussi `release/bingie-api-*` : mêmes Dockerfiles
et jobs, tags SHA uniquement sur ces branches (aucune mise à jour de `latest`), label de
révision égal au commit construit. Le gel GitOps doit précéder le push qui déclenche ce build.
`deploy.sh` vise Docker Compose local, pas le cluster ; ne pas l'utiliser pour cette livraison.

L'application ArgoCD `homelab/argocd/nexus-app.yaml` lit trois sources : chart dans
`Aexils/nexus` sur `main`, valeurs et manifests dans `Aexils/homelab` sur `main`.
L'auto-sync avec `selfHeal` est actif. L'ImageUpdater `argocd/nexus` choisit automatiquement
les images GHCR les plus récentes portant un SHA de 40 caractères et écrit les valeurs Git.
**Publier une image de ce format peut donc déclencher sa mise en service.**

Après accord, verrouiller d'abord chaque image via
`spec.applicationRefs[0].images[*].commonUpdateSettings.allowTags` dans
`homelab/argocd/nexus-imageupdater.yaml`, avec
`regexp:^574d7598e17c75a405df834b4e1269ec262dab4b$` au départ. Le champ existe dans la CRD
installée. Garder des tags exacts dans les valeurs ; vérifier la réconciliation du verrou
avant toute publication. Faire évoluer ensuite les deux verrous séparément, API puis dashboard.
Un correctif direct au cluster serait réconcilié par GitOps : le contrôle doit rester cohérent
avec le dépôt d'infrastructure et son application racine.

Le chemin GitOps nominal exige une **autorisation distincte de push** : publication d'une
branche de livraison Nexus contenant les corrections locales, référencement de son SHA exact
pour la chart (pas de fusion dans `main`), puis publication des changements infra nécessaires.
Le gel d'images précède le changement de source de chart. Un accord de déploiement seul
ne lève pas l'interdiction de push. Sans cette dérogation ou un autre chemin de livraison
explicitement approuvé, la procédure reste préparée, pas exécutable.

## Phase 1 — authentification et espace Bingie

1. Confirmer les images et la configuration de retour, le verrou ImageUpdater, puis préparer
   un commit local de livraison contenant les corrections et le code existant. Construire les
   deux images depuis ce même commit propre avec leurs Dockerfiles existants, tag SHA exact.
   `.local/` est désormais exclu du contexte Docker ; ne jamais y inclure les secrets.
   Après le gel, publier les images (accord requis), relever leurs digests ; aucune publication
   ni construction Docker n'a été faite pendant cette préparation.
2. Réutiliser les secrets administrateur existants. Après accord, produire un **SealedSecret**
   dans une zone locale privée, sans fichier intermédiaire en clair et sans afficher le flux :

   ```sh
   set -o pipefail
   umask 077
   mkdir -p .local/bingie-release
   kubectl --context homelab -n nexus create secret generic nexus-admin \
     --from-env-file=.local/nexus-admin/nexus-admin.env --dry-run=client -o json |
     kubeseal --context homelab --controller-name sealed-secrets-controller \
       --controller-namespace sealed-secrets --format yaml \
       > .local/bingie-release/sealed-nexus-admin.yaml
   ```

   Livrer seulement le document chiffré à
   `homelab/workloads/nexus/manifests/sealed-nexus-admin.yaml` par GitOps. Attendre que le
   contrôleur ait créé `nexus/nexus-admin` avec ses deux clés ; contrôler seulement noms et
   présence, jamais afficher `.data`. Ne pas exécuter le script de génération à nouveau.
3. Dans `homelab/workloads/nexus/values.yaml`, **ajouter** `nexus-admin` aux références
   existantes, en conservant `nexus-nextcloud`, `nexus-pve`, `nexus-kube-trakt` :

   ```yaml
   api:
     envFromSecrets:
       - nexus-nextcloud
       - nexus-pve
       - nexus-kube-trakt
       - nexus-admin
     aggregator:
       enabled: false
       writeOrigins: http://nexus.10.10.10.210.nip.io
       secureCookie: false
   ```

   L'origine correspond à l'adresse HTTP actuelle. Si l'adresse devient HTTPS, fixer l'origine
   HTTPS exacte et `secureCookie: true`. Ne pas modifier globalement `CORS_ORIGIN`.
   La chart corrigée rend ces deux paramètres même sans connexion Aggregator.
4. Synchroniser ces prérequis avant de changer les images. Basculer seulement l'API sur
   l'image de livraison, avec ses secrets et origines dès son premier démarrage ; garder le
   dashboard précédent. Les gardes refusent les écritures si la configuration manque.
   La stratégie API `Recreate` implique une brève interruption : prévoir un créneau accepté.
5. **Barrière avant le nouveau dashboard et l'autorisation Aggregator** : depuis l'origine
   publique, vérifier `/api/auth/session` (`configured: true`), la connexion avec le mot de
   passe existant (sans le mettre dans une ligne de commande, un journal ou l'historique),
   le cookie et la session authentifiée. Tester les refus d'origine, de session et de CSRF
   sur une requête refusée avant d'atteindre kube-trakt ; lectures publiques inchangées.
   Sans `Origin`, la garde répond 403 ; avec une origine admise mais sans cookie, 401.
   Si un contrôle échoue, arrêter ici et revenir à l'image API précédente.
6. Basculer ensuite le dashboard et son verrou d'image sur le même SHA. Vérifier les quatre
   modules, les anciennes adresses, la navigation et les brouillons. Les clients ayant gardé
   l'ancien dashboard doivent recharger avant d'éditer (ils n'envoyaient pas de CSRF).
   Sources reste indisponible tant que la phase 2 n'est pas réalisée ; les autres modules
   ne dépendent pas du certificat Aggregator. Aucun test d'écriture réel sur le Pi.

## Phase 2 — connexion Aggregator, puis droit d'écriture

1. Après autorisation spécifique, localiser le signataire de la **CA existante** correspondant
   à `durable-api-tls` et vérifier sa disponibilité et son expiration. Ce prérequis n'a pas été
   vérifié ici ; aucune clé CA n'a été lue. Ne pas lancer `make_durable_tls.py` : il crée une
   nouvelle CA et ne sert pas à ajouter ce client à l'autorité existante.
2. Créer une nouvelle clé privée dédiée et un certificat signé par cette CA :
   CN exact `kagg-private-nexus`, `basicConstraints=CA:FALSE`, usage `clientAuth`, validité
   bornée par celle de la CA. Vérifier chaîne, usage, expiration et correspondance clé/certificat
   sans afficher la clé. Aucun renouvellement du certificat Kodi ou serveur.
3. Sceller le Secret `kagg-private-nexus` du namespace `nexus` avec `ca.crt`, `client.crt`,
   `client.key` (même contrôleur et même méthode que ci-dessus, `--from-file` pour chaque clé).
   Livrer seulement son SealedSecret dans `homelab/workloads/nexus/manifests/`, attendre sa
   disponibilité, puis activer `api.aggregator.enabled: true`. L'URL et le nom TLS sont :
   `https://kagg-private.kube-aggregator-dev-three-sources.svc.cluster.local:8765`, `kagg-api`.
   La clé CA ne doit jamais entrer dans ce Secret.
4. Après redémarrage API, vérifier lecture des préférences et aperçu (calcul backend), puis
   l'authentification toujours opérationnelle. Le certificat n'a à ce stade aucun droit
   d'enregistrer les préférences. Garder une copie privée du document/version lus pour
   comparaison ; aucune modification des profils pendant cette mise en service.
5. Autoriser **en dernier**, par changement minimal du démarrage du conteneur `python` dans
   `kagg-api`, l'unique paire `--preference-writer`, `kagg-private-nexus=nexus`.
   Le démarrage actuel utilise `command`, pas le champ `args` : préserver intégralement la
   commande existante et tous ses paramètres, notamment les restrictions AllDebrid.
   Conserver image, ConfigMap v7, volumes et services. Relever la nouvelle révision ; la
   stratégie `Recreate` impose aussi une brève interruption backend.
6. Contrôler état/lecture/aperçu et disponibilité des services. L'enregistrement effectif d'un
   profil et sa synchronisation Kodi constituent l'étape produit suivante, avec accord propre ;
   ne pas effectuer de `PUT` réussi simplement pour valider la mise en service.

## Retour arrière et retrait du droit

1. Garder le verrou ImageUpdater actif. Si Nexus a reçu le droit Aggregator, retirer d'abord
   **uniquement** la paire `--preference-writer kagg-private-nexus=nexus`, conserver les autres
   écrivains éventuels, puis attendre le redémarrage. Si rien d'autre n'a changé depuis la
   préparation, le point de retour est la révision **14**, pas la 13 mentionnée par l'ancienne
   procédure de déploiement du moteur de préférences. Sinon appliquer le retrait ciblé au
   démarrage actuel. La vérification de refus peut utiliser une requête au corps invalide
   `{}` : 403 attendu pour ce certificat, aucune préférence enregistrée.
2. Fixer les deux valeurs d'image et les verrous à
   `574d7598e17c75a405df834b4e1269ec262dab4b`, puis synchroniser par GitOps. Cela restaure les
   interfaces et comportements antérieurs. Rétablir la référence de chart précédente si
   nécessaire. Ne pas restaurer tout un ancien commit infra : cela pourrait annuler d'autres
   services. Un simple `kubectl --context homelab -n nexus rollout undo deployment/api`
   serait repris par `selfHeal` et ImageUpdater ;
   une révision ArgoCD ne suffit pas sans contrôler ces automatismes.
3. Ne supprimer ni PVC, ni base, ni table ; aucune migration Trakt/Aggregator n'est nécessaire.
   Les préférences déjà enregistrées restent telles quelles ; un rollback applicatif ne les
   efface pas. Les anciennes images Nexus rétablissent aussi les anciennes écritures Trakt
   sans la nouvelle session : conséquence à accepter si ce retour complet est choisi.
4. Le Secret admin peut rester inutilisé. Pour retirer le raccordement mTLS, désactiver d'abord
   Aggregator et attendre le redémarrage API ; retirer ensuite son SealedSecret par GitOps
   (et son Secret dérivé). Ne pas supprimer un Secret encore monté ou référencé ; ne pas
   toucher à la CA, au certificat Kodi ou à `durable-api-tls`.
   Retirer l'écrivain révoque l'écriture de préférences ; cela ne révoque pas la validité mTLS
   du certificat ni sa lecture. Aucun mécanisme CRL n'a été validé dans cette préparation.

Le retour applicatif ne consiste pas à annuler seulement `9d691d4` : les deux commits précédents
contiennent déjà l'éditeur et l'authentification. Préférer les images de référence relevées.

## Vérifications réalisées pendant cette préparation

- Secrets locaux validés sans affichage ni génération.
- 6 tests session/inventaire de routes réussis ; 6 tests HTTP Trakt/Aggregator réussis avec
  backends fictifs. Les ports éphémères étant interdits dans le bac à sable, ces derniers ont
  été relancés hors de celui-ci ; aucun service réel contacté par ces tests.
- 4 tests du registre Bingie réussis. Pas de suite dashboard complète ni de nouveau Chromium.
- `helm lint` réussi et rendus contrôlés avec Aggregator désactivé puis activé : session
  toujours configurée, références de secrets existantes conservées, montage TLS conditionnel,
  aucune variable d'environnement dupliquée. Pas de build API/dashboard/Docker relancé.

**Accords nécessaires** : chemin de publication (dont dérogation explicite pour les push Git,
sans fusion `main`), gel GitOps/ImageUpdater, publication des images, livraison des SealedSecrets
et valeurs, changements de source ArgoCD, redémarrages Nexus ; puis signature et Secret mTLS,
activation du raccordement et modification du démarrage kube-aggregator. Aucun accord implicite
pour modifier les préférences partagées ou le Pi.
