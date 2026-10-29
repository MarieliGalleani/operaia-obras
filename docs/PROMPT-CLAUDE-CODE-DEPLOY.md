# Prompt para o Claude Code na VPS

Abra o Claude Code na VPS (`claude`) e cole o texto abaixo. Troque `obras.SEUDOMINIO.com.br` antes de colar.

```
Vou colocar no ar o OperaIA Obras nesta VPS. Siga o guia docs/DEPLOY.md do repositório
https://github.com/MarieliGalleani/operaia-obras e trabalhe passo a passo, parando para eu confirmar
antes de qualquer mudança no proxy reverso ou no crontab.

Domínio: obras.SEUDOMINIO.com.br

1. Diagnóstico (só leitura): versão do Docker/compose, qual proxy está em 80/443 (nginx, Caddy ou
   Traefik, e se roda no host ou em container), se a porta 8090 está livre, RAM e disco livres, e se o
   DNS do domínio já aponta para o IP desta VPS. Me mostre um resumo.
2. Clone o repositório em ~/operaia-obras (ou faça git pull se já existir).
3. Crie o .env.production a partir do .env.production.example, gerando POSTGRES_PASSWORD e JWT_SECRET
   com openssl, PUBLIC_URL=https://obras.SEUDOMINIO.com.br, chmod 600. Não mostre os segredos na tela.
4. Suba com docker compose -f compose.prod.yml --env-file .env.production up -d --build e confirme
   que app e db ficam healthy e que curl http://127.0.0.1:8090/api/health responde {"status":"up"}.
5. Me proponha o bloco de configuração para o proxy que existe aqui (o guia tem nginx, Caddy e
   Traefik), aplique depois que eu aprovar, valide a configuração antes de recarregar e emita o HTTPS.
   Confirme com curl -sI https://obras.SEUDOMINIO.com.br.
6. Rode ./scripts/backup.sh uma vez para testar e, com meu ok, agende no crontab às 3h10.
7. Não crie construtoras ainda. No fim, me diga o que ficou pendente.
```

Depois, para cada construtora piloto, siga [PILOTO.md](PILOTO.md).
