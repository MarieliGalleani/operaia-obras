import { describe, expect, it } from 'vitest'
import { buildNfeXml } from '../dev/nfe-builder.js'
import { buildNfseXml } from '../dev/nfse-builder.js'
import { cnpjWithDigits, formatCnpj, isValidAccessKey, isValidCnpj, normalizeAccessKey, normalizeCnpj } from './cnpj.js'
import { parseNfeXml } from './nfe-parser.js'
import { parseNfseXml } from './nfse-parser.js'

describe('CNPJ alfanumérico (desde jul/2026)', () => {
  it('valida o exemplo oficial da Receita', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true)
    expect(isValidCnpj('12abc34501de35')).toBe(true) // digitado em minúsculas
    expect(cnpjWithDigits('12ABC34501DE')).toBe('12ABC34501DE35')
  })
  it('recusa dígito errado, letra no dígito verificador e tamanho errado', () => {
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false)
    expect(isValidCnpj('12ABC34501DEAB')).toBe(false)
    expect(isValidCnpj('12ABC34501D35')).toBe(false)
    expect(isValidCnpj('AAAAAAAAAAAAAA')).toBe(false)
  })
  it('CNPJ só com números continua igual', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
    expect(cnpjWithDigits('112223330001')).toBe('11222333000181')
  })
  it('normaliza e formata', () => {
    expect(normalizeCnpj(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35')
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81')
  })
  it('NF-e de emitente alfanumérico: chave com letras e dígito verificador válido', () => {
    const issuer = cnpjWithDigits('A1B2C3D40001')
    const recipient = cnpjWithDigits('Z9Y8X7W60001')
    const { xml, accessKey } = buildNfeXml({
      number: 4321,
      issueDate: '2026-10-20T10:00:00-03:00',
      issuer: { cnpj: issuer, name: 'Fornecedor Novo Ltda' },
      recipientCnpj: recipient,
      items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', quantity: 10, unitPrice: 40 }],
    })
    expect(accessKey).toMatch(/[A-Z]/)
    const nfe = parseNfeXml(xml)
    expect(nfe.accessKey).toBe(accessKey)
    expect(isValidAccessKey(nfe.accessKey)).toBe(true)
    expect(isValidAccessKey(accessKey.slice(0, 43) + ((Number(accessKey[43]) + 1) % 10))).toBe(false)
    expect(nfe.issuer.cnpj).toBe(issuer)
    expect(nfe.recipient.cnpj).toBe(recipient)
    expect(normalizeAccessKey(`NFe${accessKey.toLowerCase()}`)).toBe(accessKey)
  })
  it('NFS-e nacional de prestador alfanumérico', () => {
    const issuer = cnpjWithDigits('QW12ER340001')
    const n = parseNfseXml(
      buildNfseXml({ layout: 'NACIONAL', number: 9, issueDate: '2026-10-20T10:00:00-03:00', issuer: { cnpj: issuer, name: 'Prestador' }, recipientCnpj: cnpjWithDigits('112223330001'), description: 'Reboco', services: 1000 }).xml,
    )
    expect(n.issuer.cnpj).toBe(issuer)
    expect(n.nationalKey).toHaveLength(50)
    expect(n.nationalKey).toContain('QW12ER34')
  })
})
