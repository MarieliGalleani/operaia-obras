import type { CostCategory } from './format'

export interface Issue {
  code: string
  severity: 'CRITICO' | 'ATENCAO' | 'INFO'
  message: string
}

export interface ProjectLite {
  id: string
  code: string
  name: string
  status: string
}

export interface DocumentDetail {
  id: string
  type: 'NFE' | 'NFSE' | 'RECIBO' | 'OUTRO'
  source: string
  status: 'RECEBIDO' | 'EM_REVISAO' | 'APROVADO' | 'REJEITADO' | 'CANCELADO'
  accessKey: string | null
  number: string | null
  series: string | null
  issueDate: string | null
  totalAmount: number | null
  recipientCnpj: string | null
  description: string | null
  extraInfo: string | null
  category: CostCategory | null
  fileName: string | null
  hasFile: boolean
  issues: Issue[]
  suggestedProjectId: string | null
  suggestionReason: string | null
  reviewNotes: string | null
  approvedAt: string | null
  createdAt: string
  installmentsFromXml: { number: string; dueDate: string; amountCents: number }[]
  issuer: { cnpj: string | null; name: string | null } | null
  supplier: { id: string; name: string; cnpj: string; status: string } | null
  items: { id: string; description: string; ncm: string | null; unit: string | null; quantity: string; unitPrice: string; total: number }[]
  allocations: { id: string; projectId: string; projectName: string; category: CostCategory; amount: number }[]
  payables: { id: string; installment: string; dueDate: string; amount: number; paidAmount: number; status: string }[]
  alerts: { id: string; severity: string; title: string; message: string }[]
}
