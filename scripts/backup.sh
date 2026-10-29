#!/usr/bin/env bash
# Backup diário do OperaIA Obras: banco (pg_dump) + arquivos das notas (XML/PDF).
# Guarda em ./backups e apaga os com mais de RETENTION_DAYS dias.
#
# Agendar (crontab -e na VPS), todo dia às 3h10:
#   10 3 * * * cd /home/ubuntu/operaia-obras && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="backups"
FILES="-f compose.prod.yml"
[ -f compose.proxy.yml ] && FILES="$FILES -f compose.proxy.yml"
COMPOSE="docker compose $FILES --env-file .env.production"
mkdir -p "$DEST"

# shellcheck disable=SC1091
set -a; source .env.production; set +a

echo "[$(date -Iseconds)] backup $STAMP"
$COMPOSE exec -T db pg_dump -U "${POSTGRES_USER:-obras}" -d "${POSTGRES_DB:-operaia_obras}" --format=custom \
  > "$DEST/db-$STAMP.dump"

# arquivos: lê o volume de storage pelo próprio container do app
$COMPOSE exec -T app tar -C /app -czf - storage > "$DEST/storage-$STAMP.tar.gz"

# confere que não saiu vazio
for f in "$DEST/db-$STAMP.dump" "$DEST/storage-$STAMP.tar.gz"; do
  [ -s "$f" ] || { echo "✖ $f vazio"; exit 1; }
done

find "$DEST" -name 'db-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$DEST" -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
echo "✔ ok: $(du -h "$DEST/db-$STAMP.dump" | cut -f1) banco, $(du -h "$DEST/storage-$STAMP.tar.gz" | cut -f1) arquivos"

# Cópia fora da VPS (recomendado): descomente e configure o rclone (ex.: Google Drive)
# rclone copy "$DEST" remote:operaia-obras-backups --max-age 2d
