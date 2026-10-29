# OperaIA Obras — imagem única (API + telas), pensada para ficar atrás do proxy da VPS.
# Build:  docker compose -f compose.prod.yml build

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @operaia-obras/api build \
 && pnpm --filter @operaia-obras/web exec vite build \
 && pnpm --filter @operaia-obras/api deploy --prod --legacy /out \
 && rm -rf /out/dist /out/drizzle /out/web /out/src /out/fixtures /out/storage \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/drizzle /out/drizzle \
 && cp -r apps/web/dist /out/web

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3333 \
    WEB_DIST=/app/web \
    STORAGE_DIR=/app/storage \
    TZ=America/Sao_Paulo
RUN apk add --no-cache tzdata \
 && addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/storage && chown -R app:app /app
WORKDIR /app
COPY --from=build --chown=app:app /out /app
USER app
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/api/health || exit 1
# aplica migrations pendentes e sobe o servidor
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
