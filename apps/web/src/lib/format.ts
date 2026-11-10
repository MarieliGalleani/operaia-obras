export type CostCategory = 'MATERIAIS' | 'MAO_DE_OBRA' | 'TERCEIRIZADOS' | 'EQUIPAMENTOS' | 'SERVICOS' | 'OUTROS'

export const CATEGORIES: { value: CostCategory; title: string; color: string }[] = [
  { value: 'MATERIAIS', title: 'Materiais', color: '#1FA77A' },
  { value: 'MAO_DE_OBRA', title: 'Mão de obra', color: '#2D5B9A' },
  { value: 'TERCEIRIZADOS', title: 'Terceirizados', color: '#F2A93B' },
  { value: 'EQUIPAMENTOS', title: 'Equipamentos', color: '#C79A5B' },
  { value: 'SERVICOS', title: 'Serviços', color: '#9AA5A0' },
  { value: 'OUTROS', title: 'Outros', color: '#D5DAD8' },
]
export const categoryLabel = (c?: string | null) => CATEGORIES.find((x) => x.value === c)?.title ?? c ?? '—'
export const categoryColor = (c?: string | null) => CATEGORIES.find((x) => x.value === c)?.color ?? '#ccc'

/** Valores chegam em centavos */
export const brl = (cents?: number | null, opts: { compact?: boolean } = {}) => {
  if (cents == null) return '—'
  const v = cents / 100
  if (opts.compact && Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: opts.compact ? 0 : 2, maximumFractionDigits: opts.compact ? 0 : 2 })
}

export const pct = (v?: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)

export const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
export const ymd = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** CNPJ numérico ou alfanumérico (desde jul/2026: letras nas 12 primeiras posições) e CPF */
export const cnpj = (v?: string | null) =>
  v && /^[0-9A-Z]{12}\d{2}$/.test(v)
    ? v.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5')
    : v && /^\d{11}$/.test(v)
      ? v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
      : v ?? '—'
/** Rótulo curto do tipo de documento */
export const docTypeLabel = (t: string) => (t === 'NFE' ? 'NF-e' : t === 'NFSE' ? 'NFS-e' : t === 'RECIBO' ? 'Recibo' : 'Arquivo')

/** "12.500,50" → centavos */
export function parseBRL(input: string | number | null | undefined): number {
  if (input == null || input === '') return 0
  if (typeof input === 'number') return Math.round(input * 100)
  const s = input.replace(/[R$\s]/g, '')
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normalized)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
export const centsToInput = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const DOC_STATUS: Record<string, { label: string; color: string }> = {
  RECEBIDO: { label: 'Pronta para aprovar', color: 'info' },
  EM_REVISAO: { label: 'Em revisão', color: 'warning' },
  APROVADO: { label: 'Aprovada', color: 'success' },
  REJEITADO: { label: 'Rejeitada', color: 'grey' },
  CANCELADO: { label: 'Cancelada', color: 'grey' },
}
export const PAYABLE_STATUS: Record<string, { label: string; color: string }> = {
  ABERTO: { label: 'Pendente', color: 'warning' },
  PARCIAL: { label: 'Parcial', color: 'info' },
  PAGO: { label: 'Pago', color: 'success' },
  CANCELADO: { label: 'Cancelado', color: 'grey' },
}
export const SEVERITY: Record<string, { color: string; icon: string; label: string }> = {
  CRITICO: { color: 'error', icon: 'mdi-alert', label: 'Crítico' },
  ATENCAO: { color: 'warning', icon: 'mdi-alert-circle-outline', label: 'Atenção' },
  INFO: { color: 'info', icon: 'mdi-information-outline', label: 'Info' },
  OPORTUNIDADE: { color: 'success', icon: 'mdi-piggy-bank-outline', label: 'Oportunidade' },
}
export const SOURCE: Record<string, string> = { UPLOAD: 'Upload', EMAIL: 'E-mail', API: 'Integração', MANUAL: 'Manual' }

/** "vence hoje", "vence em 3 dias", "venceu há 2 dias" — mais fácil de ler que uma data */
export function daysFromToday(iso?: string | null): number | null {
  if (!iso) return null
  const today = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00')
  const d = new Date((iso.length > 10 ? iso.slice(0, 10) : iso) + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}
export function dueLabel(iso?: string | null, verb: 'vence' | 'entrega' | 'termina' = 'vence') {
  const n = daysFromToday(iso)
  if (n === null) return '—'
  const past = { vence: 'venceu', entrega: 'era para entregar', termina: 'terminou' }[verb]
  if (n === 0) return `${verb} hoje`
  if (n === 1) return `${verb} amanhã`
  if (n === -1) return `${past} ontem`
  return n > 0 ? `${verb} em ${n} dias` : `${past} há ${Math.abs(n)} dias`
}
/** cor da situação de um prazo: atrasado, perto, tranquilo */
export const dueState = (iso?: string | null): 'late' | 'attention' | 'ok' => {
  const n = daysFromToday(iso)
  if (n === null) return 'ok'
  return n < 0 ? 'late' : n <= 3 ? 'attention' : 'ok'
}

/** assunto do alerta, em palavra do dia a dia */
export const ALERT_TOPIC: Record<string, string> = {
  ORCAMENTO: 'Orçamento',
  DUPLICIDADE: 'Nota repetida',
  PRECO: 'Preço',
  DADOS: 'Dados da nota',
  DESTINATARIO: 'Destinatário',
  OBRA_NAO_IDENTIFICADA: 'Obra',
  VENCIMENTO: 'Pagamento',
  ECONOMIA: 'Economia',
  PEDIDO: 'Compra',
  OCORRENCIA: 'Obra parada',
}
export const alertTopic = (t?: string | null) => (t && ALERT_TOPIC[t]) || 'Conferência'
/** o quanto pesa, em palavra */
export const IMPACT: Record<string, { label: string; cls: string }> = {
  CRITICO: { label: 'Resolver hoje', cls: 'state-late' },
  ATENCAO: { label: 'Fica de olho', cls: 'state-attention' },
  INFO: { label: 'Só para saber', cls: 'state-ok' },
  OPORTUNIDADE: { label: 'Dá para economizar', cls: 'state-ok' },
}
