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

export const cnpj = (v?: string | null) => (v && v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v ?? '—')

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
