import { describe, expect, it } from 'vitest'
import { compareSuggestion, rate, type FinalValues } from './accuracy.js'

const final = (o: Partial<FinalValues> = {}): FinalValues => ({
  allocations: [{ projectId: 'p1', category: 'MATERIAIS', amount: 100 }],
  installments: [{ dueDate: '2026-12-01', amount: 100 }],
  purchaseOrderId: null,
  supplierId: 's1',
  totalAmount: 100,
  number: '10',
  issueDate: '2026-11-01',
  ...o,
})
const by = (checks: ReturnType<typeof compareSuggestion>) => Object.fromEntries(checks.map((c) => [c.field, c.outcome]))

describe('medição de acerto', () => {
  it('aprovou igual à sugestão: acertou em tudo', () => {
    const c = compareSuggestion({ source: 'XML', projectId: 'p1', category: 'MATERIAIS', purchaseOrderId: null, installments: [{ dueDate: '2026-12-01', amount: 100 }] }, final())
    expect(by(c)).toEqual({ obra: 'ACERTOU', categoria: 'ACERTOU', vencimento: 'ACERTOU' })
  })
  it('trocou obra, categoria e vencimento: errou', () => {
    const c = compareSuggestion(
      { source: 'XML', projectId: 'p2', category: 'SERVICOS', purchaseOrderId: null, installments: [{ dueDate: '2026-11-20', amount: 100 }] },
      final(),
    )
    expect(by(c)).toEqual({ obra: 'ERROU', categoria: 'ERROU', vencimento: 'ERROU' })
    expect(c.find((x) => x.field === 'obra')).toMatchObject({ suggested: 'p2', final: 'p1' })
  })
  it('rateio em duas obras conta como erro da obra sugerida', () => {
    const c = compareSuggestion(
      { source: 'XML', projectId: 'p1', category: 'MATERIAIS', purchaseOrderId: null, installments: null },
      final({ allocations: [{ projectId: 'p1', category: 'MATERIAIS', amount: 60 }, { projectId: 'p2', category: 'MATERIAIS', amount: 40 }] }),
    )
    expect(by(c).obra).toBe('ERROU')
    expect(by(c).categoria).toBe('ACERTOU')
  })
  it('sem sugestão de obra; nota sem vencimento e sem pedido não contam esses campos', () => {
    const c = compareSuggestion({ source: 'XML', projectId: null, category: 'MATERIAIS', purchaseOrderId: null, installments: null }, final())
    expect(by(c)).toEqual({ obra: 'SEM_SUGESTAO', categoria: 'ACERTOU' })
  })
  it('pedido: vínculo mantido, trocado e achado só pela pessoa', () => {
    const s = { source: 'XML' as const, projectId: 'p1', category: 'MATERIAIS', installments: null }
    expect(by(compareSuggestion({ ...s, purchaseOrderId: 'o1' }, final({ purchaseOrderId: 'o1' }))).pedido).toBe('ACERTOU')
    expect(by(compareSuggestion({ ...s, purchaseOrderId: 'o1' }, final({ purchaseOrderId: null }))).pedido).toBe('ERROU')
    expect(by(compareSuggestion({ ...s, purchaseOrderId: null }, final({ purchaseOrderId: 'o1' }))).pedido).toBe('SEM_SUGESTAO')
  })
  it('leitura por IA mede fornecedor, valor, número e data', () => {
    const c = compareSuggestion(
      { source: 'IA', projectId: 'p1', category: 'MATERIAIS', purchaseOrderId: null, installments: null, read: { supplierId: 's1', totalAmount: 90, number: '10', issueDate: null } },
      final(),
    )
    expect(by(c)).toMatchObject({ fornecedor: 'ACERTOU', valor: 'ERROU', numero: 'ACERTOU', emissao: 'SEM_SUGESTAO' })
  })
  it('taxa conta "sem sugestão" como trabalho da pessoa', () => {
    expect(rate(95, 3, 2)).toBe(95)
    expect(rate(0, 0, 0)).toBeNull()
  })
})
