import { describe, expect, it } from 'vitest'
import { accessKeyDigit, cnpjWithDigits, isValidAccessKey, isValidCnpj } from './cnpj.js'
import { findProjectInText, suggestCategory } from './classifier.js'
import { splitProportional, toCents } from './money.js'
import { parseNfeXml } from './nfe-parser.js'
import { buildNfeXml } from '../dev/nfe-builder.js'

describe('money', () => {
  it('converte formatos XML e brasileiro para centavos', () => {
    expect(toCents('12500.00')).toBe(1250000)
    expect(toCents('12.500,50')).toBe(1250050)
    expect(toCents('0.1')).toBe(10)
    expect(toCents('19.995')).toBe(2000)
    expect(toCents(null)).toBe(0)
  })
  it('rateia sem perder centavos', () => {
    const parts = splitProportional(1000, [1, 1, 1])
    expect(parts).toEqual([333, 333, 334])
    expect(parts.reduce((a, b) => a + b)).toBe(1000)
  })
})

describe('cnpj e chave de acesso', () => {
  it('valida CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
    expect(isValidCnpj('11111111111111')).toBe(false)
    expect(isValidCnpj(cnpjWithDigits('123456780001'))).toBe(true)
  })
  it('valida dígito da chave', () => {
    const base = '3525081234567800019055001000012345100000001'
    const key = base + accessKeyDigit(base)
    expect(isValidAccessKey(key)).toBe(true)
    expect(isValidAccessKey(base + ((accessKeyDigit(base) + 1) % 10))).toBe(false)
  })
})

describe('classificador', () => {
  const projects = [
    { id: '1', code: 'OBR-001', name: 'Residencial Aurora' },
    { id: '2', code: 'OBR-002', name: 'Edifício Horizonte' },
    { id: '3', code: 'OBR-003', name: 'Casa Jardim' },
  ]
  it('acha a obra por código, nome e palavra distintiva', () => {
    expect(findProjectInText('Pedido 55 - OBR-002', projects)?.project.id).toBe('2')
    expect(findProjectInText('Entrega na obra Casa Jardim, portão 2', projects)?.project.id).toBe('3')
    expect(findProjectInText('Entregar no canteiro Aurora', projects)?.project.id).toBe('1')
    expect(findProjectInText('Entrega no endereço do cliente', projects)).toBeNull()
  })
  it('sugere categoria pelos itens', () => {
    expect(suggestCategory({ items: [{ description: 'CONCRETO USINADO FCK 30', ncm: '38245000', totalCents: 100 }] }).category).toBe('MATERIAIS')
    expect(suggestCategory({ items: [{ description: 'LOCACAO DE RETROESCAVADEIRA', totalCents: 100 }] }).category).toBe('EQUIPAMENTOS')
    expect(suggestCategory({ supplierDefault: 'SERVICOS', items: [] }).category).toBe('SERVICOS')
  })
})

describe('parser NF-e', () => {
  it('lê nfeProc completo com duplicatas', () => {
    const { xml, accessKey } = buildNfeXml({
      number: 12345,
      issueDate: '2025-08-10T10:00:00-03:00',
      issuer: { cnpj: cnpjWithDigits('123456780001'), name: 'Concremax Ltda' },
      recipientCnpj: cnpjWithDigits('987654320001'),
      items: [{ description: 'CONCRETO USINADO FCK 30', ncm: '38245000', quantity: 25, unitPrice: 500 }],
      installments: [
        { dueDate: '2025-09-10', amount: 6250 },
        { dueDate: '2025-10-10', amount: 6250 },
      ],
      extraInfo: 'Obra: Residencial Aurora',
    })
    const nfe = parseNfeXml(xml)
    expect(nfe.accessKey).toBe(accessKey)
    expect(isValidAccessKey(nfe.accessKey)).toBe(true)
    expect(nfe.number).toBe('12345')
    expect(nfe.totalCents).toBe(1250000)
    expect(nfe.items).toHaveLength(1)
    expect(nfe.items[0].totalCents).toBe(1250000)
    expect(nfe.installments.map((i) => i.amountCents)).toEqual([625000, 625000])
    expect(nfe.extraInfo).toContain('Residencial Aurora')
    expect(nfe.authorized).toBe(true)
  })
  it('rejeita XML que não é NF-e', () => {
    expect(() => parseNfeXml('<foo><bar/></foo>')).toThrow()
    expect(() => parseNfeXml('isso não é xml <<<')).toThrow()
  })
})
