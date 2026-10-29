# Deploy na VPS — passo a passo

**Cenário:** VPS Ubuntu com Docker e um proxy reverso já rodando nas portas 80/443 (nginx, Caddy ou Traefik).

O OperaIA Obras sobe como dois containers:

- `app`: API + telas.
- `db`: PostgreSQL.

O app escuta só em `127.0.0.1:8090`. Quem publica na internet, com HTTPS, é o proxy que já existe.

```
internet ──HTTPS──▶ proxy da VPS (80/443) ──▶ 127.0.0.1:8090 [app] ──▶ [db] (rede interna)
```

Tempo estimado: 30 a 45 minutos.

---

## 1. DNS

No painel do seu domínio, crie um registro **A**: `obras` → IP da VPS. Pode levar alguns minutos para propagar.

Confira com:

```bash
dig +short obras.SEUDOMINIO.com.br
```

## 2. Conferir a VPS

```bash
docker --version && docker compose version       # Docker 24+ com compose v2
sudo ss -ltnp | grep -E ':80 |:443 '              # qual proxy está nas portas públicas
sudo ss -ltnp | grep ':8090 ' || echo "8090 livre" # porta interna do OperaIA Obras
free -h && df -h /                                # ~1 GB de RAM e 5 GB de disco livres bastam para o piloto
```

Se a 8090 estiver ocupada, escolha outra e use-a no `APP_PORT` do passo 4.

## 3. Código

```bash
cd ~ && git clone https://github.com/MarieliGalleani/operaia-obras.git && cd operaia-obras
```

## 4. Segredos

```bash
cp .env.production.example .env.production
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.production
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env.production
nano .env.production    # ajuste PUBLIC_URL (https://obras.SEUDOMINIO.com.br) e APP_PORT se precisar
chmod 600 .env.production
```

O `.env.production` nunca vai para o git; o `.gitignore` já cuida disso. Faça uma cópia dele num cofre de senhas.

## 5. Subir

```bash
docker compose -f compose.prod.yml --env-file .env.production up -d --build
docker compose -f compose.prod.yml --env-file .env.production ps    # app e db "healthy"
curl -s http://127.0.0.1:8090/api/health                            # {"status":"up"}
```

As migrations do banco rodam sozinhas toda vez que o app inicia.

## 6. Proxy reverso (HTTPS)

Use o bloco do proxy que já está na VPS.

**nginx** (com certbot):

```nginx
server {
    server_name obras.SEUDOMINIO.com.br;
    client_max_body_size 20m;            # uploads de vários XMLs
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois rode:

```bash
sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d obras.SEUDOMINIO.com.br
```

**Caddy** (HTTPS automático), no Caddyfile:

```
obras.SEUDOMINIO.com.br {
    reverse_proxy 127.0.0.1:8090
}
```

Depois rode `sudo systemctl reload caddy`.

**Traefik ou outro proxy em container:**

- O container do proxy não enxerga o `127.0.0.1` da VPS.
- Ou aponte para `http://host.docker.internal:8090` (com `extra_hosts: ["host.docker.internal:host-gateway"]` no proxy),
- ou coloque o serviço `app` na mesma rede Docker do proxy e use `http://app:3333`.

Confira com:

```bash
curl -sI https://obras.SEUDOMINIO.com.br | head -1     # HTTP/2 200
```

## 7. Primeira construtora

```bash
docker compose -f compose.prod.yml --env-file .env.production exec app \
  node dist/cli/admin.js criar-construtora \
  --nome "Construtora X Ltda" --cnpj 12.345.678/0001-90 \
  --admin-nome "Nome do responsável" --admin-email responsavel@construtorax.com.br
```

O comando imprime:

- **senha provisória**: envie por WhatsApp ou ligação, nunca no mesmo e-mail do login;
- **chave de integração**: usada no n8n.

Outros comandos:

```bash
... exec app node dist/cli/admin.js criar-usuario --cnpj 12345678000190 --nome "Fulano" --email f@x.com --perfil FINANCEIRO
... exec app node dist/cli/admin.js resetar-senha --email f@x.com
... exec app node dist/cli/admin.js listar           # construtoras, usuários, nº de notas, última nota
```

Dentro do sistema, o admin da construtora também adiciona pessoas em **Configurações → Equipe**.

## 8. Backup diário

```bash
mkdir -p backups && ./scripts/backup.sh                # teste manual: gera backups/db-*.dump e storage-*.tar.gz
crontab -e                                             # e adicione a linha abaixo
10 3 * * * cd $HOME/operaia-obras && ./scripts/backup.sh >> backups/backup.log 2>&1
```

O backup guarda 14 dias. Para restaurar: `./scripts/restore.sh backups/db-AAAA-MM-DD_HHMM.dump backups/storage-AAAA-MM-DD_HHMM.tar.gz`.

**Recomendado:** copiar os backups para fora da VPS (Google Drive via `rclone`). A linha já está comentada no fim do `backup.sh`.

## 9. E-mail de notas (n8n)

Siga [`integrations/n8n/README.md`](../integrations/n8n/README.md). São 10 minutos por construtora.

## 10. Atualizar para uma nova versão

```bash
cd ~/operaia-obras && git pull
./scripts/backup.sh                                            # sempre antes de atualizar
docker compose -f compose.prod.yml --env-file .env.production up -d --build
docker compose -f compose.prod.yml --env-file .env.production logs -f --tail=50 app
```

---

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| App reinicia com "JWT_SECRET precisa ter pelo menos 32 caracteres" | `.env.production` sem o segredo (passo 4) |
| 502 no navegador | Proxy apontando para a porta errada ou app ainda subindo; veja `docker compose ... logs app` |
| Upload de muitos XMLs falha com 413 | Aumente `client_max_body_size` no nginx |
| Login responde 429 | Mais de 10 tentativas em 15 minutos do mesmo IP; aguarde ou reinicie o app |
| Horários errados | O container usa America/Sao_Paulo; confira o relógio da VPS (`timedatectl`) |
