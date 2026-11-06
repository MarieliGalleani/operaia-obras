/**
 * Medição de acerto (plano de validação: ≥ 95% nos campos críticos).
 *
 * Na entrada da nota o sistema guarda o que sugeriu (obra, categoria, pedido, vencimentos e, na
 * leitura por IA, os dados lidos). Na aprovação compara com o que a pessoa confirmou, campo a campo:
 *   ACERTOU       a pessoa aprovou exatamente o que o sistema sugeriu
 *   ERROU         a pessoa trocou a sugestão
 *   SEM_SUGESTAO  o sistema não sugeriu nada e a pessoa teve que preencher
 * Campo que não se aplica à nota (sem pedido dos dois lados, nota sem vencimento) não conta.
 * Os dados lidos do XML (fornecedor, valor, número, data) são exatos por definição e não entram:
 * só entram quando a leitura não é exata (PDF ou foto lidos por IA).
 */
import type { DocumentSuggestion } from '../db/schema.js'

export type CheckOutcome = 'ACERTOU' | 'ERROU' | 'SEM_SUGESTAO'
export type CheckField = 'obra' | 'categoria' | 'vencimento' | 'pedido' | 'fornecedor' | 'valor' | 'numero' | 'emissao'

export interface FinalValues {
  allocations: Array<{ projectId: string; category: string; amount: number }>
  installments: Array<{ dueDate: string; amount: number }>
  purchaseOrderId: string | null
  supplierId: string | null
  totalAmount: number | null
  number: string | null
  issueDate: string | null // AAAA-MM-DD
}

export interface Check {
  field: CheckField
  outcome: CheckOutcome
  suggested: string | null
  final: string | null
}

/** Campos que contam para a meta de 95% */
export const CRITICAL_FIELDS: CheckField[] = ['obra', 'categoria', 'vencimento', 'fornecedor', 'valor', 'numero', 'emissao']
export const ACCURACY_TARGET = 95

const sameInstallments = (a: FinalValues['installments'], b: FinalValues['installments']) =>
  a.length === b.length && a.every((x, i) => x.dueDate === b[i].dueDate && x.amount === b[i].amount)
const fmtInst = (l: FinalValues['installments']) => l.map((i) => `${i.dueDate}=${i.amount}`).join(' | ')

function check(field: CheckField, suggested: string | null | undefined, final: string | null): Check {
  if (suggested == null || suggested === '') return { field, outcome: 'SEM_SUGESTAO', suggested: null, final }
  return { field, outcome: suggested === final ? 'ACERTOU' : 'ERROU', suggested, final }
}

export function compareSuggestion(s: DocumentSuggestion, f: FinalValues): Check[] {
  const out: Check[] = []

  // obra: acerta se todo o custo foi para a obra sugerida
  const projects = [...new Set(f.allocations.map((a) => a.projectId))]
  out.push(check('obra', s.projectId, projects.join(',')))

  // categoria: acerta se todo o custo ficou na categoria sugerida
  const cats = [...new Set(f.allocations.map((a) => a.category))]
  out.push(check('categoria', s.category, cats.join(',')))

  // vencimentos só contam quando vieram na nota (duplicatas); o "30 dias" padrão não é leitura
  if (s.installments?.length) {
    const sorted = [...f.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    const sug = [...s.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    out.push({ field: 'vencimento', outcome: sameInstallments(sug, sorted) ? 'ACERTOU' : 'ERROU', suggested: fmtInst(sug), final: fmtInst(sorted) })
  }

  // pedido de compra: não conta quando a nota não tem pedido nem antes nem depois
  if (s.purchaseOrderId || f.purchaseOrderId) out.push(check('pedido', s.purchaseOrderId, f.purchaseOrderId))

  // dados lidos por IA (PDF/foto)
  if (s.read) {
    if ('supplierId' in s.read) out.push(check('fornecedor', s.read.supplierId, f.supplierId))
    if ('totalAmount' in s.read) out.push(check('valor', s.read.totalAmount == null ? null : String(s.read.totalAmount), f.totalAmount == null ? null : String(f.totalAmount)))
    if ('number' in s.read) out.push(check('numero', s.read.number, f.number))
    if ('issueDate' in s.read) out.push(check('emissao', s.read.issueDate, f.issueDate))
  }
  return out
}

/** Acerto = acertos ÷ (acertos + erros + sem sugestão): o que a pessoa não precisou mexer. */
export function rate(acertou: number, errou: number, semSugestao: number) {
  const total = acertou + errou + semSugestao
  return total ? Math.round((acertou / total) * 1000) / 10 : null
}
