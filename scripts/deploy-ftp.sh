#!/usr/bin/env bash
# Envoie release/ sur un hébergement mutualisé par FTPS (lftp), avec mode maintenance pendant l'envoi.
#
#   FTP_HOST=ftp.votre-hebergeur.net FTP_USER=… FTP_PASSWORD=… scripts/deploy-ftp.sh
#   (option) DRY_RUN=1 : affiche ce qui serait envoyé, sans rien modifier.
#
# Le mot de passe ne s'écrit jamais dans ce fichier ni en argument de commande visible :
# il est lu dans l'environnement et passé à lftp via LFTP_PASSWORD (--env-password).
#
# Ordre : 1) dépôt du fichier MAINTENANCE  2) code PHP (~/cuvylo)  3) racine web (www/)
#         4) retrait de MAINTENANCE. La migration de base s'applique d'elle-même à la première requête.
# Les fichiers de configuration du serveur (.env, var/) ne sont ni envoyés ni supprimés.
set -euo pipefail

: "${FTP_HOST:?FTP_HOST manquant}"
: "${FTP_USER:?FTP_USER manquant}"
: "${FTP_PASSWORD:?FTP_PASSWORD manquant}"
REMOTE_HOME="${REMOTE_HOME:-cuvylo}"
REMOTE_WWW="${REMOTE_WWW:-www}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REL="$ROOT/release"

command -v lftp >/dev/null || { echo "lftp est requis (brew install lftp / apt install lftp)." >&2; exit 1; }
[ -f "$REL/MANIFEST.txt" ] || { echo "release/ absent : lancez d'abord node scripts/package-release.mjs" >&2; exit 1; }

DRY=""
MAINT_ON="put -O \"$REMOTE_HOME\" \"$REL/MAINTENANCE\""
MAINT_OFF="rm \"$REMOTE_HOME/MAINTENANCE\""
if [ "${DRY_RUN:-}" = "1" ]; then
  # Simulation : aucun fichier n'est modifié, le site reste en ligne.
  DRY="--dry-run"
  MAINT_ON="echo (simulation : MAINTENANCE non déposé)"
  MAINT_OFF="echo (simulation terminée)"
fi
touch "$REL/MAINTENANCE"

export LFTP_PASSWORD="$FTP_PASSWORD"
# --delete ne touche qu'aux dossiers gérés par le paquet ; .env et var/ sont exclus explicitement.
lftp --env-password -u "$FTP_USER" "ftps://$FTP_HOST" <<EOF
set ftp:ssl-force true
set ftp:ssl-protect-data true
set ssl:verify-certificate true
set net:max-retries 3
set cmd:fail-exit true
$MAINT_ON
mirror -R $DRY --delete --verbose --exclude-glob .env --exclude-glob var/ --exclude-glob MAINTENANCE "$REL/cuvylo" "$REMOTE_HOME"
mirror -R $DRY --delete --verbose "$REL/www" "$REMOTE_WWW"
$MAINT_OFF
bye
EOF
rm -f "$REL/MAINTENANCE"
echo "Envoi terminé. Vérifiez https://<votre-domaine>/api/health puis la page de connexion."
