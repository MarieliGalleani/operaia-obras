#!/usr/bin/env bash
# Atualiza o OperaIA Obras na VPS com segurança:
# backup → baixa a versão nova → reconstrói → confere se o app e o site respondem.
#   ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

FILES="-f compose.prod.yml"
[ -f compose.proxy.yml ] && FILES="$FILES -f compose.proxy.yml"
COMPOSE="docker compose $FILES --env-file .env.production"
# shellcheck disable=SC1091
set -a; source .env.production; set +a

echo "▶ backup antes de atualizar"
./scripts/backup.sh

echo "▶ baixando a versão nova"
git pull --ff-only

echo "▶ reconstruindo e subindo"
$COMPOSE up -d --build

echo "▶ aguardando o app responder"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT:-8090}/api/health" >/dev/null 2>&1; then
    echo "  app ok"
    break
  fi
  sleep 2
  [ "$i" = 30 ] && { echo "✖ o app não respondeu; veja: $COMPOSE logs --tail=50 app"; exit 1; }
done

if [ -n "${PUBLIC_URL:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/health" || true)
  if [ "$code" = "200" ]; then
    echo "✔ no ar: $PUBLIC_URL"
  else
    echo "✖ o app está ok, mas $PUBLIC_URL respondeu $code. Confira a rede do proxy (compose.proxy.yml / PROXY_NETWORK)."
    exit 1
  fi
fi
