/** Prévia da medição (espelho de apps/api/src/services/measurement.ts) */
export interface Contract {
  type: 'EMPREITADA' | 'ADMINISTRACAO'
  adminFeeBps: number
  adminFeeFromDefault: boolean
  measurementDay: number | null
  measurementDayFromDefault: boolean
  ownerPaysSuppliers: boolean
  ownerName: string | null
  ownerEmail: string | null
}

export interface Measurement {
  project: { id: string; code: string; name: string; address: string | null; imageUrl: string | null }
  contract: Contract
  period: { month: string; first: string; last: string; closed: boolean }
  realized: {
    total: number
    groups: Array<{ key: string; label: string; amount: number }>
    documents: Array<{
      id: string
      type: string
      number: string | null
      issueDate: string
      supplier: string | null
      categories: string[]
      amount: number
      documentTotal: number
      payment: 'PAGO' | 'PARCIAL' | 'ABERTO' | 'SEM_TITULO'
      hasFile: boolean
    }>
  }
  forecast: { total: number; items: Array<{ id: string; kind: 'NOTA' | 'PEDIDO'; label: string; supplier: string | null; date: string | null; category: string; amount: number }> }
  fee: { pct: number; onRealized: number; onForecast: number; total: number }
  totals: { realizedWithFee: number; expectedCosts: number; expected: number; toSuppliers: number; toBuilder: number }
  due: Array<{ id: string; dueDate: string; supplier: string | null; document: string; amount: number; status: string }>
}

export const ymdBR = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
export const monthName = (ym: string) => {
  const s = new Date(`${ym}-15T12:00:00-03:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
export const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
export const docLabel = (type: string, number: string | null) => `${type === 'NFSE' ? 'NFS-e' : type === 'NFE' ? 'NF-e' : 'Documento'} ${number ?? ''}`.trim()
export const contractLabel = (c: Contract) =>
  c.type === 'ADMINISTRACAO' ? `Administração · taxa de ${(c.adminFeeBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : 'Empreitada (preço fechado)'
export const closingLabel = (day: number | null) => (day ? `fecha todo dia ${day}` : 'fecha no último dia do mês')
