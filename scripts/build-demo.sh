#!/usr/bin/env bash
# Gera a demonstração somente leitura (apps/web/dist-demo) a partir do banco de desenvolvimento.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm --filter @operaia-obras/api demo:snapshot
cd apps/web
rm -rf dist-demo
VITE_DEMO=1 npx vite build --outDir dist-demo --base ./ --emptyOutDir >/dev/null
cp demo/demo-data.json dist-demo/
# página para publicar como artifact: só o corpo, sem <html>/<head>
node -e '
const fs = require("fs")
const html = fs.readFileSync("dist-demo/index.html", "utf8")
const pick = (re) => [...html.matchAll(re)].map((m) => m[0])
const fonts = pick(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g).join("\n")
const css = pick(/<link rel="stylesheet" crossorigin href="[^"]+">/g).map((l) => l.replace(" crossorigin", "")).join("\n")
const js = pick(/<script type="module" crossorigin src="[^"]+"><\/script>/g).map((l) => l.replace(" crossorigin", "")).join("\n")
fs.writeFileSync("dist-demo/page.html", `<title>OperaIA Obras</title>\n${fonts}\n${css}\n<style>\n  html, body { background: #f4f6f5; color: #16211d; }\n</style>\n<div id="app"></div>\n${js}\n`)
'
echo "✔ demo em apps/web/dist-demo ($(ls dist-demo/assets | wc -l) arquivos)"
