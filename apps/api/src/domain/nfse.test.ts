import { describe, expect, it } from 'vitest'
import { buildNfeXml } from '../dev/nfe-builder.js'
import { buildNfseXml, type BuildNfseInput } from '../dev/nfse-builder.js'
import { cnpjWithDigits } from './cnpj.js'
import { looksLikeNfse, normalizeServiceCode, parseNfseXml } from './nfse-parser.js'

const issuer = { cnpj: cnpjWithDigits('445566770001'), name: 'Empreiteira Silva Ltda', tradeName: 'Silva Obras' }
const recipientCnpj = cnpjWithDigits('987654320001')
const base: Omit<BuildNfseInput, 'layout'> = {
  number: 321,
  issueDate: '2026-10-15T09:30:00-03:00',
  issuer,
  recipientCnpj,
  description: 'Mão de obra de alvenaria - medição 3 - Residencial Aurora',
  serviceCode: '07.02',
  services: 10000,
  issRate: 0.03,
}

describe('NFS-e padrão nacional', () => {
  it('lê valores, retenção de ISS e INSS, líquido e obra', () => {
    const { xml, key } = buildNfseXml({ ...base, layout: 'NACIONAL', issRetained: true, inss: 1100, obra: 'OBR-001' })
    const n = parseNfseXml(xml)
    expect(n.layout).toBe('NACIONAL')
    expect(n.key).toBe(key)
    expect(n.nationalKey).toHaveLength(50)
    expect(n.number).toBe('321')
    expect(n.issuer.cnpj).toBe(issuer.cnpj)
    expect(n.issuer.name).toBe('Empreiteira Silva Ltda')
    expect(n.recipient.cnpj).toBe(recipientCnpj)
    expect(n.serviceCode).toBe('07.02')
    expect(n.totalCents).toBe(1_000_000)
    expect(n.issCents).toBe(30_000)
    expect(n.issRetained).toBe(true)
    expect(n.retentions).toMatchObject({ iss: 30_000, inss: 110_000, outras: 0 })
    expect(n.retainedCents).toBe(140_000)
    expect(n.netCents).toBe(860_000)
    expect(n.competence).toBe('2026-10-15')
    expect(n.construction?.code).toBe('OBR-001')
    expect(n.extraInfo).toContain('OBR-001')
    expect(n.cancelled).toBe(false)
  })

  it('sem retenção: líquido igual ao total', () => {
    const n = parseNfseXml(buildNfseXml({ ...base, layout: 'NACIONAL' }).xml)
    expect(n.retainedCents).toBe(0)
    expect(n.netCents).toBe(n.totalCents)
  })

  it('retenção que a nota soma mas não detalha vira "outras"', () => {
    const { xml } = buildNfseXml({ ...base, layout: 'NACIONAL' })
    const n = parseNfseXml(xml.replace('<vLiq>10000.00</vLiq>', '<vLiq>9535.00</vLiq>'))
    expect(n.retentions.outras).toBe(46_500)
    expect(n.netCents).toBe(953_500)
  })
})

describe('NFS-e ABRASF', () => {
  it('2.04: desconto incondicional reduz o custo', () => {
    const n = parseNfseXml(buildNfseXml({ ...base, layout: 'ABRASF', unconditionalDiscount: 500, obra: 'CNO 90.000.12345/67' }).xml)
    expect(n.layout).toBe('ABRASF')
    expect(n.key).toBe(`NFSE-3548906-${issuer.cnpj}-321`)
    expect(n.cityCode).toBe('3548906')
    expect(n.issuer.municipalRegistration).toBe('556677')
    expect(n.servicesCents).toBe(1_000_000)
    expect(n.totalCents).toBe(950_000)
    expect(n.netCents).toBe(950_000)
    expect(n.construction).toEqual({ code: 'CNO 90.000.12345/67', art: 'ART-2026-0002', address: null })
    expect(n.description).toContain('Residencial Aurora')
  })

  it('2.04: tributo informado mas não retido não reduz o líquido', () => {
    const { xml } = buildNfseXml({ ...base, layout: 'ABRASF', pis: 65 })
    const n = parseNfseXml(xml.replace('<ValorLiquidoNfse>9935.00</ValorLiquidoNfse>', '<ValorLiquidoNfse>10000.00</ValorLiquidoNfse>'))
    expect(n.retentions.pis).toBe(0)
    expect(n.netCents).toBe(1_000_000)
  })

  it('1.0 com prefixo tc:, dentro de resposta de consulta, IR retido e cancelada', () => {
    const n = parseNfseXml(buildNfseXml({ ...base, layout: 'ABRASF1', ir: 150, cancelled: true }).xml)
    expect(n.layout).toBe('ABRASF')
    expect(n.number).toBe('321')
    expect(n.recipient.cnpj).toBe(recipientCnpj)
    expect(n.retentions.ir).toBe(15_000)
    expect(n.netCents).toBe(985_000)
    expect(n.cancelled).toBe(true)
  })
})

describe('Nota Paulistana', () => {
  it('lê ISS retido, INSS e status cancelada', () => {
    const n = parseNfseXml(buildNfseXml({ ...base, layout: 'SP', issRetained: true, inss: 1100, cancelled: true }).xml)
    expect(n.layout).toBe('SP')
    expect(n.cityCode).toBe('3550308')
    expect(n.verificationCode).toBe('AB12CD34')
    expect(n.retainedCents).toBe(140_000)
    expect(n.netCents).toBe(860_000)
    expect(n.cancelled).toBe(true)
  })
})

describe('detecção e erros', () => {
  it('distingue NFS-e de NF-e', () => {
    const nfe = buildNfeXml({ number: 1, issueDate: '2026-10-01T10:00:00-03:00', issuer, recipientCnpj, items: [{ description: 'CIMENTO', quantity: 1, unitPrice: 10 }] }).xml
    expect(looksLikeNfse(nfe)).toBe(false)
    for (const layout of ['NACIONAL', 'ABRASF', 'ABRASF1', 'SP'] as const) expect(looksLikeNfse(buildNfseXml({ ...base, layout }).xml)).toBe(true)
  })
  it('recusa arquivo com várias notas e XML que não é NFS-e', () => {
    const one = buildNfseXml({ ...base, layout: 'ABRASF' }).xml.replace(/^<\?xml[^>]*>\s*/, '')
    expect(() => parseNfseXml(`<ListaNfse>${one}${one}</ListaNfse>`)).toThrow(/2 notas/)
    expect(() => parseNfseXml('<foo/>')).toThrow(/não parece/)
    expect(() => parseNfseXml('<<<')).toThrow()
  })
  it('normaliza o item da LC 116', () => {
    expect(normalizeServiceCode('07.02')).toBe('07.02')
    expect(normalizeServiceCode('7.02')).toBe('07.02')
    expect(normalizeServiceCode('0702')).toBe('07.02')
    expect(normalizeServiceCode('702')).toBe('07.02')
    expect(normalizeServiceCode('070201')).toBe('07.02')
    expect(normalizeServiceCode('abc')).toBeNull()
  })
})
