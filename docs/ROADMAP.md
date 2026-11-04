# Roadmap — OperaIA Obras

Alinhado ao plano de validação de 120 dias. Cada item serve para responder se a construtora paga para eliminar o retrabalho entre nota, compra, obra e financeiro.

## Fila atual — ficar igual à imagem de visão (do mais fácil ao mais difícil)

Marcado conforme vai ficando pronto. A ordem é a fila de execução.

### Fácil (horas a 1 dia)
- [x] 1. Menu igual ao da imagem: Integrações separada de Configurações
- [x] 2. Foto de capa da obra nos cards (no lugar das iniciais)
- [x] 3. Miniatura da nota (PDF/DANFE) ao lado dos dados na conferência
- [x] 4. Fornecedor "homologado" com selo na lista

### Médio (2 a 5 dias)
- [x] 5. Tela de Orçamentos: previsto × realizado por categoria, todas as obras
- [x] 6. Tela de Relatórios: custo por obra, por fornecedor e por mês (PDF/planilha)
- [x] 7. Último preço, média por material e prazo de pagamento do fornecedor (prazo de entrega entrou com Compras)
- [ ] 8. Alertas críticos por WhatsApp (depende de serviço de envio) — ⏸ pulado em 30/10: lembrar a Marieli de escolher o serviço
- [ ] 9. Cópia das notas aprovadas no Google Drive da construtora — ⏸ pulado em 30/10: lembrar a Marieli de criar o projeto no Google Cloud

### Difícil (1 a 3 semanas)
- [ ] 10. Leitura de nota em PDF ou foto (IA sugere, humano confirma)
- [x] 11. Tela de Compras: pedido antes da nota e conferência pedido × nota (vínculo pelo nº do pedido na nota, divergência de preço/quantidade, entrega parcial, pontualidade do fornecedor)
- [x] 12. App de obra do mestre: pedir material, aprovar entrega, fotos, ocorrências, avanço físico (perfil Mestre de obra, tela de celular em /campo, físico × financeiro na obra)
- [x] 13. Funcionar sem internet (junto com o app de obra): app abre sem sinal, fila no celular com fotos, envio automático sem duplicar, hora real do registro

### Muito difícil / depende de terceiros
- [ ] 14. Integração Conta Azul
- [ ] 15. Integração com bancos (pagamento e conciliação)
- [ ] 16. Integração Sienge e TOTVS (parceria ou acesso pago)
- [ ] 17. Marketplace de fornecedores

## Já feito
- [x] Deploy na VPS (Docker, HTTPS via proxy, backup diário do PostgreSQL e do `storage/`)
- [x] Recebimento de notas pelo e-mail da construtora (IMAP dentro do sistema; n8n opcional)
- [x] Exportação CSV de lançamentos e títulos (para o financeiro e a contabilidade)
- [x] Painel da plataforma: cadastro de construtoras, usuários, suspensão e acesso de suporte

## Ainda em aberto do plano de validação
- [ ] Importação de obras e orçamento por planilha
- [ ] Medição de erros por campo nos documentos reais (meta: ≥ 95% nos campos críticos)
- [ ] NFS-e (serviços): padrões municipais mais comuns na região dos pilotos
- [ ] Estorno de pagamento
- [ ] Armazenamento de arquivos em object storage (S3-compatível)
- [ ] Métrica de margem de contribuição por cliente
- [ ] Previsões (custo final estimado da obra) quando houver histórico suficiente

## Decisões registradas
- Leitura de XML é determinística: IA só entra onde não há dado estruturado.
- Nota fiscal, título, pagamento e custo apropriado são entidades separadas.
- Dinheiro em centavos inteiros; rateio sem perder centavos.
- Todo alerta tem um "fingerprint" do fato que o gerou: não duplica e atualiza o texto quando o número muda.
- Drizzle ORM no lugar de Prisma (sem engine binária; migrations SQL versionadas).
- Aprovação de nota e pagamento continuam só online, mesmo quando houver modo sem internet.
- Nota sem pedido de compra pode ser aprovada, com o aviso "sem pedido" (construtora pequena ainda compra sem pedido formal).
- Perfil Mestre de obra só acessa o app de obra e nunca vê valores em dinheiro (bloqueado na API, não só na tela).
- Recebimento na obra é registro separado da nota: a conferência passa a ser pedido × nota × o que chegou no canteiro.
- Ocorrência de gravidade alta vira alerta crítico; média vira alerta de atenção; baixa fica só no diário.
- Sem internet: só o app de obra funciona offline (pedir material, receber entrega, foto, ocorrência, avanço). Aprovação de nota, pagamento e o resto do escritório continuam só online.
- Fila do celular usa Idempotency-Key: reenvio nunca duplica. O registro guarda a hora em que aconteceu (limitada a agora e a 30 dias atrás); avanço antigo da fila não sobrescreve um mais novo.
- Fotos do canteiro são reduzidas no celular (máx. 1600 px, JPEG) antes de enviar.
- Nota só é vinculada sozinha ao pedido quando traz o número dele (xPed, ex.: PC-0012). Sem número, o sistema apenas sugere o pedido.
