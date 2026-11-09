# Aggregator dans Nexus — préférences de qualité partagées avec Kodi

Module « Sources et qualité » de l'espace Bingie (`/bingie/sources`, ancien `/aggregator`) : voir
`docs/BINGIE.md` pour le cadre, la session commune et le déploiement.

Source de vérité : kube-aggregator (`GET`/`PUT /v1/preferences`, `POST /v1/preferences/preview`).
Nexus ne classe rien : il édite le document, l'envoie avec la version lue et affiche l'aperçu
calculé par le moteur commun. Kodi relit les préférences partagées au plus toutes les 60 s :
une modification enregistrée est visible sans redémarrage.

## Sécurité

| Couche | Règle |
|---|---|
| Nexus → kube-aggregator | mTLS, certificat client **dédié** `kagg-private-nexus` (même CA que Kodi, jamais le certificat Kodi) |
| kube-aggregator | écriture réservée à `--preference-writer kagg-private-nexus=nexus` ; tout autre certificat : 403 ; auteur = certificat |
| Navigateur → Nexus, lecture et aperçu | ouverts comme le reste de Nexus (rien n'est enregistré ni débridé) |
| Navigateur → Nexus, écriture (`PUT /api/aggregator/preferences`) | session (cookie `HttpOnly; SameSite=Strict; Path=/api`, 12 h, signé HMAC) + en-tête `X-CSRF-Token` lié à la session + `Origin` dans `NEXUS_WRITE_ORIGINS` (jamais `*`) |
| Connexion | mot de passe d'administration (scrypt) ; 5 échecs / 10 min par adresse → 429 ; `Origin` vérifiée |
| Sans configuration | connexion et écriture désactivées (503) ; lecture et aperçu seuls |

Les autres routes de Nexus ne changent pas de règles (garde appliquée à cette seule route).
Recommandé ensuite, hors de ce chantier : `CORS_ORIGIN` limité à l'origine de Nexus au lieu de `*`
(sans effet sur cette route : cookie `SameSite=Strict` et contrôle d'`Origin` suffisent).

## Déploiement (préparé, rien d'appliqué)

1. Certificat `kagg-private-nexus` signé par la CA privée existante (hors Git), extension
   `clientAuth` ; Secret `kagg-private-nexus` (ca.crt, client.crt, client.key) dans le namespace
   `nexus`, en SealedSecret dans le dépôt d'infrastructure.
2. Secret `nexus-admin` : `NEXUS_ADMIN_PASSWORD_HASH` et `NEXUS_SESSION_SECRET`, générés sans
   affichage par `tools/nexus-admin-secret.sh` (voir `docs/BINGIE.md`).
3. Values Nexus : `api.aggregator.enabled: true`, `api.envFromSecrets: [nexus-admin]`
   (`writeOrigins` = URL publique de Nexus). Image api et dashboard reconstruites (ArgoCD).
4. kube-aggregator : ajouter l'argument `--preference-writer kagg-private-nexus=nexus` au
   Deployment `kagg-api` (nouvelle révision ; retour arrière : révision précédente).
5. Vérifier : lecture, aperçu, `PUT` sans session → 401, avec session → 200 et version + 1 ;
   Kodi voit le profil dans la minute.

Ressources : aucun pod ni service nouveau ; quelques Ko de mémoire dans le pod `api` existant ;
réseau déjà ouvert (Nexus sans politique de sortie, kagg-api admet le réseau des pods).

## Tests

- `npx nx test api` : session, garde (origine, cookie, CSRF, non configuré, force brute), relais
  200/403/409/422/503 avec un faux backend.
- `npx jest --config apps/dashboard/jest.config.cts apps/dashboard/src/app/features/bingie/modules/aggregator` :
  mise en forme des règles, état de l'éditeur (modifié, conflit, invalide, session, injoignable).
- Réel, optionnel, sans écriture : `KAGG_E2E=1 KAGG_URL=https://10.10.10.201:8765 KAGG_TLS_DIR=… npx
  jest --config apps/api/jest.config.cts apps/api/src/app/aggregator/aggregator.kagg.spec.ts`.
