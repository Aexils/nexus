# Bingie — bilan de la mise en service API seule

Phase autorisée le 9 novembre 2026 ; bascule observée le 10 novembre à 01:10 UTC
(9 novembre, 20:10 à Montréal). **Arrêt au point de contrôle API. Aucun déploiement dashboard.**

## Livraison et état réel

- Branche Nexus publiée : `release/bingie-api-20261109`, sans fusion dans `main`.
- `af888ebbc347f14e387f46712737b128516ecca0` : six fichiers de préparation revus et committés.
- `e2fe14a9ca35e73837df90fbc5c7d0f89d57b7d9` : workflow existant étendu aux branches de
  livraison, SHA seul (pas de mise à jour de `latest`) et label de provenance du commit.
- [CI de publication réussie](https://github.com/Aexils/nexus/actions/runs/42732116589),
  deux images construites et publiées depuis ce même SHA ; labels de révision vérifiés.

| Image | Tag publié | Digest de manifeste |
|---|---|---|
| `ghcr.io/aexils/nexus-api` | `e2fe14a9ca35e73837df90fbc5c7d0f89d57b7d9` | `sha256:720a9e68e8061a418a54f93ebc644be33f596fc22984730d16620612e709c7bb` |
| `ghcr.io/aexils/nexus-dashboard` | `e2fe14a9ca35e73837df90fbc5c7d0f89d57b7d9` | `sha256:37ba34bffaee7f0d2294eff5e21a67eac1bf02c2d1083ce122dc94837cf95ca4` |

Seule l'API utilise la nouvelle image : Deployment `api`, révision **71**, pod Ready,
zéro redémarrage, imageID égal au digest ci-dessus. Le dashboard conserve son image
`574d7598e17c75a405df834b4e1269ec262dab4b`, sa révision **77** et son pod d'origine.

## GitOps et secrets

Commits publiés directement dans le dépôt d'infrastructure, sans fusion :

- `38d4488` : auto-sync Nexus désactivé, API et dashboard ImageUpdater épinglés aux images de
  retour ; application effective du verrou vérifiée avant publication des images.
- `50e71e4` : SealedSecret `nexus-admin`, synchronisé seul ; déchiffrement réussi avant API.
- `7fb30e2` : chart épinglée à `e2fe14a…`, image API et origine configurées, références des
  trois autres Secrets préservées ; dashboard inchangé. Comparaison des neuf ressources
  Helm : seul `Deployment/api` diffère. Synchronisation explicite limitée à ce Deployment.

État final consulté : application Nexus **Healthy / Synced**, `automated.enabled: false`.
ImageUpdater reste actif, avec `allowTags` exact par image : API `e2fe14a…`, dashboard
`574d759…`. La publication du dashboard n'autorise pas son déploiement.

`nexus/nexus-admin` contient les deux clés attendues, issues des fichiers locaux existants :
aucune régénération, aucune valeur affichée. Origine admise :
`http://nexus.10.10.10.210.nip.io`. `CORS_ORIGIN` conservé. Aggregator désactivé.

## Vérifications et interruption

- 22 contrôles d'authentification réussis via l'origine publique : configuration active,
  mot de passe incorrect refusé, connexion avec le mot de passe existant, session et jeton CSRF
  stables, cookie `HttpOnly; SameSite=Strict; Path=/api`, durée 12 h, déconnexion navigateur.
- L'adresse actuelle est HTTP : `NEXUS_SECURE_COOKIE=false`, attribut `Secure` absent,
  conformément à la procédure. Ni HTTPS ni changement d'origine globale dans cette phase.
- Écritures Trakt et Aggregator refusées sans session (401), sans origine ou d'origine
  étrangère (403), sans CSRF ou avec un mauvais CSRF (403). Authentification et CSRF valides
  acceptées jusqu'à la validation locale d'un document Aggregator vide (400), sans appel
  backend ni enregistrement. Aucune écriture métier Trakt/Kodi ou de préférences.
- 13 lectures publiques, toutes HTTP 200 avant et après ; 12 réponses identiques par empreinte,
  réglages Trakt dynamiques toujours disponibles. Imports, catégories, listes, écrans, menu,
  logos et instantanés vérifiés. HTML du dashboard strictement identique.
- WebSocket connecté avant/après ; mêmes neuf événements : versions, connexion, historique
  des logs, Nextcloud, métriques des nœuds/système/workloads, Sideloop, Trakt. Cela vérifie
  les transports et lectures existants ; aucune validation visuelle du nouveau dashboard.
- 126 lignes de logs de démarrage examinées : démarrage réussi, zéro erreur, zéro avertissement,
  aucune des valeurs des secrets locaux détectée. Pod Ready, zéro redémarrage.
- Mesure continue sur `/api/trakt/titles`, cible toutes les 0,5 s, timeout 1,5 s : un épisode
  de HTTP 502 lié à `Recreate`, première erreur **01:10:12.919 UTC**, retour HTTP 200
  **01:10:27.082 UTC**. Fenêtre première erreur→retour : **14,16 s** ; dernier succès avant
  coupure→retour : **14,67 s**. Moniteur arrêté après validation, aucun serveur local laissé.

## Retour arrière et arrêt

Les deux anciennes images `574d759…` sont toujours disponibles dans GHCR, vérifiées avant
publication. Digests de retour : API
`sha256:fc34b8ad8a5e4efdb451124ee00384b25162bf434bbd67fcce116600dcca10ef`, dashboard
`sha256:c158a4171cb10745371cd40ea3b536ac2b24dcc047a15cfcb98146e65d7a3849`.

Rollback préparé, **non déclenché et non exécuté comme exercice** : conserver l'auto-sync
suspendu, rétablir le verrou API et son tag à `574d759…`, la source de chart et les valeurs
antérieures si nécessaire, puis synchroniser explicitement l'API par GitOps. Le Secret admin
peut rester inutilisé. Aucun retour de base de données ni changement kube-trakt/Aggregator.

kube-aggregator reste en révision **14** ; aucun certificat `kagg-private-nexus`, aucun écrivain
ajouté. Aucun changement au Pi, Kodi, POV, AllDebrid, ntfy ou kagg-watchdog.

**Le dashboard Bingie attend un nouvel accord explicite.** Pendant cet arrêt, les écritures
Trakt sont protégées côté API ; l'ancien dashboard n'émet pas le CSRF et ne fournit pas la
nouvelle connexion Bingie. Son édition Trakt reste donc indisponible jusqu'à la livraison
frontend ou à un retour applicatif explicitement décidé. Les lectures restent disponibles.
