#!/bin/bash
# Secrets d'administration Nexus (écritures Bingie), générés localement sans jamais être affichés.
# Usage : tools/nexus-admin-secret.sh [dossier]   (défaut : .local/nexus-admin, ignoré par Git)
#   password        mot de passe à conserver (gestionnaire de mots de passe), lu avec `pbcopy < …`
#   nexus-admin.env NEXUS_ADMIN_PASSWORD_HASH et NEXUS_SESSION_SECRET, pour le Secret `nexus-admin`
# Refuse d'écraser un dossier existant : un nouveau mot de passe invaliderait l'ancien.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=${1:-$ROOT/.local/nexus-admin}
if [ -e "$DIR/password" ]; then echo "existe déjà : $DIR (supprimer à la main pour régénérer)"; exit 1; fi
umask 077; mkdir -p "$DIR"
openssl rand -base64 24 | tr -d '\n' > "$DIR/password"
# Même format que hashPassword (apps/api/src/app/auth/session.ts) ; mot de passe lu sur stdin.
node -e '
const c = require("crypto"), fs = require("fs");
const pw = fs.readFileSync(0, "utf8"), salt = c.randomBytes(16);
const hash = "scrypt$16384$" + salt.toString("hex") + "$" + c.scryptSync(pw, salt, 32, { N: 16384 }).toString("hex");
fs.writeFileSync(process.argv[1], "NEXUS_ADMIN_PASSWORD_HASH=" + hash + "\nNEXUS_SESSION_SECRET=" + c.randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
' "$DIR/nexus-admin.env" < "$DIR/password"
echo "écrit (mode 600, rien affiché) : $DIR/password et $DIR/nexus-admin.env"
