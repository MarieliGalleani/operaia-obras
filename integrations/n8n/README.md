# E-mail → OperaIA Obras (n8n) — alternativa

> O caminho padrão agora é o **E-mail de notas** dentro do sistema (Configurações), sem n8n. Use este fluxo só se a construtora já tiver uma automação no n8n.

Cada construtora tem uma caixa de e-mail só para notas, por exemplo `notas@construtora.com.br` ou um Gmail dedicado. Os fornecedores mandam a NF-e para lá, como já fazem hoje. O n8n lê a caixa a cada minuto, separa os anexos `.xml` e envia ao OperaIA Obras. PDFs e imagens são ignorados nesta versão. Se o mesmo XML chegar duas vezes, ele não é duplicado.

## Configurar (uma vez por construtora)

1. **Credencial IMAP** (n8n → Credentials → IMAP), com os dados da caixa de notas.
   - Gmail: host `imap.gmail.com`, porta 993, SSL ligado. A senha é uma *senha de app* (Conta Google → Segurança → Verificação em duas etapas → Senhas de app).
   - Outros provedores: use o host IMAP que eles informam.
2. **Credencial da chave da construtora** (Credentials → Header Auth):
   - Name: `x-api-key`
   - Value: a chave que aparece em **Configurações** no OperaIA Obras (perfil Admin), ou a impressa pelo `criar-construtora`.
3. **Importar o fluxo:** Workflows → Import from File → `operaia-obras-email-nfe.json`.
4. Abra os três nós:
   - No **Caixa de notas (IMAP)**, selecione a credencial IMAP.
   - No **Enviar ao OperaIA Obras**, troque a URL pelo seu domínio e selecione a credencial da chave.
5. Renomeie o fluxo com o nome da construtora e **ative**.

## Testar

Envie para a caixa de notas um e-mail com um dos XMLs de `apps/api/fixtures/`. Em até um minuto a nota aparece em **Notas Fiscais**, com a origem "E-mail".

## Observações

- O nó IMAP marca o e-mail como lido depois de processar. Para reprocessar, marque como não lido.
- Para mais de uma construtora, duplique o fluxo, um por caixa e chave.
- A resposta do OperaIA Obras indica, por arquivo:
  - `CRIADO`: nota nova.
  - `JA_IMPORTADO`: reenvio ignorado.
  - `ERRO`: XML inválido; a mensagem diz o motivo.

  Isso fica visível nas execuções do n8n.
