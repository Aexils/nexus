#!/bin/bash
# Contrôle visuel et fonctionnel dans Chromium, contre un faux Nexus local (données fictives).
# Usage : tools/ui-check/run.sh bureau|mobile [aggregator|bingie]   (après `npx nx build dashboard`)
# KAGG_ENGINE : moteur commun de kube-aggregator (classement réel de l'aperçu) ;
# CHROME : exécutable Chromium (défaut : celui de Playwright déjà installé).
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
ENGINE=${KAGG_ENGINE:-$ROOT/../kube-aggregator/backend/quality_rules.py}
OUT=${UI_CHECK_OUT:-$ROOT/.local/ui-check}; mkdir -p "$OUT"
CHROME=${CHROME:-$(find ~/Library/Caches/ms-playwright -type f -name 'Google Chrome for Testing' 2>/dev/null | sort | tail -1)}
# Un faux Nexus déjà lancé garderait l'état d'un passage précédent : refus plutôt que résultats faussés.
if curl -s -o /dev/null http://127.0.0.1:4312/mock/state; then echo "ÉCHEC port 4312 déjà occupé (ancien faux Nexus ?)"; exit 1; fi
python3 "$HERE/mock_nexus.py" "$ROOT/dist/apps/dashboard/browser" "$ENGINE" 4312 >/dev/null 2>&1 &
MOCK=$!; trap 'kill $MOCK 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:4312/mock/state && break; sleep 0.3; done
cd "$ROOT" && CHROME="$CHROME" NODE_PATH="$ROOT/node_modules" node "$HERE/${2:-aggregator}-flow.cjs" "$OUT" "${1:-bureau}" 2>&1 \
  | grep -E "^(OK|ÉCHEC)|Error|Timeout|exceeded|-flow.cjs:"
echo "captures : $OUT"
