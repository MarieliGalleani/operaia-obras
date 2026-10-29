# Roadmap — OperaIA Obras

Alinhado ao plano de validação de 120 dias. Cada item serve para responder se a construtora paga para eliminar o retrabalho entre nota, compra, obra e financeiro.

## Antes dos pilotos (dias 16–30)
- [ ] Deploy na VPS (Docker, HTTPS, backup diário do PostgreSQL e do diretório `storage/`)
- [ ] Fluxo n8n: caixa de e-mail → `/api/integrations/nfe`
- [ ] Exportação CSV/Excel de lançamentos e títulos (para o financeiro atual e a contabilidade)
- [ ] Onboarding: cadastro de construtora, usuários e convite por e-mail
- [ ] Importação de obras e orçamento por planilha
- [ ] Medição de erros por campo nos documentos reais (meta: ≥ 95% nos campos críticos)

## Durante os pilotos (dias 31–90)
- [ ] NFS-e (serviços): leitura dos padrões municipais mais comuns na região dos pilotos
- [ ] PDF/imagem com extração assistida por IA (GRIOT sugere; humano confirma), com confiança mínima por campo
- [ ] Pedido de compra: comprometido **antes** da nota e conferência pedido × nota
- [ ] Estorno de pagamento
- [ ] Notificações de alerta crítico (e-mail/WhatsApp)
- [ ] Armazenamento de arquivos em object storage (S3-compatível)
- [ ] Métrica de margem de contribuição por cliente (tempo de suporte, processamento e infraestrutura)

## Depois da validação
- [ ] App de obra (mobile, offline): fotos de comprovantes, solicitação de material, aprovação de entrega
- [ ] Integrações com ERPs (Sienge, TOTVS, Conta Azul)
- [ ] Marketplace e comparativo de fornecedores
- [ ] Previsões (custo final estimado da obra) quando houver histórico suficiente
- [ ] EXOTRAJE como camada de orquestração das integrações

## Decisões registradas
- Leitura de XML é determinística: IA só entra onde não há dado estruturado.
- Nota fiscal, título, pagamento e custo apropriado são entidades separadas.
- Dinheiro em centavos inteiros; rateio sem perder centavos.
- Todo alerta tem um "fingerprint" do fato que o gerou: não duplica e atualiza o texto quando o número muda.
- Drizzle ORM no lugar de Prisma (sem engine binária; migrations SQL versionadas).
