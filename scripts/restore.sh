#!/usr/bin/env bash
# Restaura um backup. ATENÇÃO: substitui o banco e os arquivos atuais.
#   ./scripts/restore.sh backups/db-2026-11-02_0310.dump backups/storage-2026-11-02_0310.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
DB_FILE="${1:?informe o arquivo db-*.dump}"
STORAGE_FILE="${2:-}"
COMPOSE="docker compose -f compose.prod.yml --env-file .env.production"
# shellcheck disable=SC1091
set -a; source .env.production; set +a

read -r -p "Isto apaga os dados atuais e restaura $DB_FILE. Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

$COMPOSE stop app
$COMPOSE exec -T db pg_restore -U "${POSTGRES_USER:-obras}" -d "${POSTGRES_DB:-operaia_obras}" --clean --if-exists --no-owner < "$DB_FILE"
if [ -n "$STORAGE_FILE" ]; then
  $COMPOSE run --rm -T --no-deps --entrypoint sh app -c 'rm -rf /app/storage/* && tar -C /app -xzf -' < "$STORAGE_FILE"
fi
$COMPOSE start app
echo "✔ restaurado"
