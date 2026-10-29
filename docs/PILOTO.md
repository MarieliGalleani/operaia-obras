# Piloto com construtora — checklist

**Objetivo do piloto:** provar, em 30 a 60 dias, que o OperaIA Obras elimina retrabalho entre nota, obra e financeiro **sem introduzir erro financeiro**, e que a construtora pagaria por isso.

## Antes de começar

- [ ] **Perfil certo:**
  - 3 a 20 obras simultâneas;
  - recebe NF-e de material com frequência;
  - controla custo por obra em planilha ou num sistema que não amarra nota → obra.
- [ ] **Combinado por escrito (e-mail basta):**
  - período do piloto;
  - preço do piloto (mesmo simbólico; piloto pago valida mais);
  - o que está incluso;
  - o que acontece com os dados no fim.
- [ ] **Dados (LGPD):**
  - Informe que as notas e dados financeiros ficam numa VPS sob sua responsabilidade, com backup diário e acesso só da equipe deles e da OperaIA.
  - Para contrato definitivo, vale revisar com um advogado: termo de uso, acordo de tratamento de dados e prazo de retenção de documentos fiscais.
- [ ] **Lista das obras ativas:** nome, endereço, orçamento total e, se tiverem, orçamento por categoria.
- [ ] **Quem usa:**
  - 1 admin (dono ou diretor);
  - 1 a 2 do financeiro;
  - gestores de obra, se quiserem.

## Dia da implantação (1 a 2 horas)

1. **Criar a construtora e o admin:**

   ```bash
   docker compose -f compose.prod.yml --env-file .env.production exec app \
     node dist/cli/admin.js criar-construtora --nome "..." --cnpj ... --admin-nome "..." --admin-email ...
   ```

   Envie a senha provisória por WhatsApp.
2. **Cadastrar as obras** junto com eles (tela **Obras → Nova obra**). Use códigos curtos: `OBR-001`, `OBR-002`…
3. **Caixa de notas:**
   - Criar `notas@construtora` (ou um Gmail dedicado).
   - No Gmail, gerar uma *senha de app*.
   - Conectar em **Configurações → E-mail de notas** (ou você, pela Plataforma). O sistema testa na hora.
   - Se preferirem, começam arrastando os XMLs na tela.
4. **Combinar com os fornecedores principais:** colocar a obra na nota. É o que mais aumenta o acerto automático. Mensagem sugerida:
   > "A partir de agora, por favor informe nas Informações Complementares da NF-e: **Obra: OBR-001 – Residencial Aurora** (ou o código da obra do pedido) e envie o XML para notas@construtora.com.br."
5. **Carga inicial:** importar os XMLs dos últimos 30 a 60 dias, para os números da Visão Geral fazerem sentido desde o primeiro dia.
6. **Treino rápido (30 min) com o financeiro:**
   - conferir uma nota;
   - ratear entre obras;
   - aprovar;
   - registrar pagamento;
   - exportar a planilha.

## Durante o piloto — conversa semanal de 20 minutos

Anote toda semana:

| Indicador | Como medir | Meta |
| --- | --- | --- |
| Notas processadas | `admin.js listar` | crescendo semana a semana |
| Obra identificada automaticamente | notas aprovadas sem trocar a obra sugerida | ≥ 70% depois de combinar com fornecedores |
| Erros de leitura | campos que precisaram correção ÷ notas | ≤ 5% nos campos críticos |
| Tempo do financeiro | perguntar: quanto tempo gastava por semana antes × agora | −50% nas tarefas cobertas |
| Problemas pegos pelo sistema | duplicidades, preço acima da média, orçamento | pelo menos 1 com valor real |
| Uso real | quem entrou e quantas vezes | o financeiro usa toda semana |

Registre também **o que eles pediram e não existe**. É a matéria-prima do próximo ciclo; o `docs/ROADMAP.md` já tem os candidatos.

## Fim do piloto — decisão

- **Continua pagando?** Esse é o sinal mais forte. Se sim, combine o plano e o preço.
- **Não continua?** Descubra se o problema foi a dor (não era tão grande), o produto (faltou NFS-e, PDF etc.), o preço ou o uso (ninguém adotou).
- **Indicação:** peça para indicarem outra construtora. Indicação de cliente satisfeito é o canal mais barato.

## Em caso de problema

- **Nota errada aprovada:** **Notas → abrir → Cancelar nota.** Só funciona se não houver pagamento registrado.
- **Esqueceram a senha:** `admin.js resetar-senha --email ...`
- **Algo estranho nos números:** a trilha de auditoria registra quem aprovou o quê e quando (tabela `audit_logs`).
- **Perda de dados:** `scripts/restore.sh` com o backup do dia anterior.
