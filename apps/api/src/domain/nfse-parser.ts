/**
 * Leitura determinística do XML da NFS-e (nota de serviço). Três famílias de leiaute:
 *
 * - NACIONAL: padrão nacional (Emissor Nacional / ADN, raiz <NFSe><infNFSe>). Obrigatório para os
 *   municípios desde 2026 (LC 214/2025); São Carlos/SP emite só por ele.
 * - ABRASF: modelo usado pela maioria dos sistemas municipais antigos (Ginfes, Betha, ISSNet, IPM…),
 *   versões 1.0 e 2.x (<CompNfse><Nfse><InfNfse>), inclusive dentro de respostas de consulta.
 * - SP: Nota Paulistana da capital (<RetornoConsulta><NFe><ChaveNFe>).
 *
 * Valores em centavos. O custo da obra é o valor do serviço menos o desconto incondicional;
 * o fornecedor recebe o LÍQUIDO (custo menos retenções e desconto condicionado). As retenções
 * (ISS, INSS, IR, PIS/COFINS/CSLL) a construtora recolhe em guia, não paga ao fornecedor.
 */
import { XMLParser } from 'fast-xml-parser'
import { onlyDigits } from './cnpj.js'
import { toCents } from './money.js'

export type NfseLayout = 'NACIONAL' | 'ABRASF' | 'SP'

export interface NfseRetentions {
  iss: number
  inss: number
  ir: number
  csll: number
  pis: number
  cofins: number
  /** retenção que a nota soma no total mas não detalha (ex.: PIS/COFINS em versões do nacional) */
  outras: number
}

export interface ParsedNfse {
  layout: NfseLayout
  /** chave única para não importar duas vezes: chave nacional de 50 dígitos ou NFSE-<município>-<prestador>-<número> */
  key: string
  /** chave de acesso de 50 dígitos (só no padrão nacional) */
  nationalKey: string | null
  number: string | null
  verificationCode: string | null
  issueDate: string | null // ISO
  competence: string | null // AAAA-MM-DD
  cityCode: string | null // IBGE, 7 dígitos
  cityName: string | null
  issuer: { cnpj: string | null; name: string | null; tradeName: string | null; municipalRegistration: string | null; city: string | null; uf: string | null }
  recipient: { cnpj: string | null; name: string | null }
  /** item da lista da LC 116 (ex.: "07.02") */
  serviceCode: string | null
  serviceLabel: string | null
  description: string
  servicesCents: number
  unconditionalDiscountCents: number
  conditionalDiscountCents: number
  deductionsCents: number
  /** custo da nota: serviço − desconto incondicional */
  totalCents: number
  issCents: number
  issRate: string | null
  issRetained: boolean
  retentions: NfseRetentions
  retainedCents: number
  /** valor que o fornecedor recebe */
  netCents: number
  construction: { code: string | null; art: string | null; address: string | null } | null
  extraInfo: string | null
  cancelled: boolean
  replaced: boolean
}

export class NfseParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const txt = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v === 'object') return txt((v as any)['#text'])
  const s = String(v).trim()
  return s === '' ? null : s
}
/** Primeiro valor não vazio entre os caminhos "A.B.C". */
function pick(node: any, ...paths: string[]): any {
  for (const p of paths) {
    let cur = node
    for (const part of p.split('.')) {
      if (cur == null) break
      cur = Array.isArray(cur) ? cur[0]?.[part] : cur[part]
    }
    if (cur != null && cur !== '') return cur
  }
  return null
}
const s = (node: any, ...paths: string[]) => txt(pick(node, ...paths))
const c = (node: any, ...paths: string[]) => toCents(s(node, ...paths))
const doc = (node: any, base: string) => {
  const v = s(node, `${base}.CNPJ`, `${base}.Cnpj`, `${base}.CPF`, `${base}.Cpf`, `${base}.CpfCnpj.Cnpj`, `${base}.CpfCnpj.Cpf`)
  return v ? onlyDigits(v) : null
}

/** Procura nós com o nome dado em qualquer nível (respostas de consulta embrulham as notas). */
function findAll(node: any, name: string, out: any[] = [], depth = 0): any[] {
  if (node == null || typeof node !== 'object' || depth > 12) return out
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, name, out, depth + 1)
    return out
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@_') || k === '#text') continue
    if (k === name) out.push(...asArray(v))
    else findAll(v, name, out, depth + 1)
  }
  return out
}

const toIso = (v: string | null) => {
  if (!v) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00-03:00` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}-03:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

/** Item da LC 116 a partir de "07.02", "0702", "7.02", "702" ou do código nacional "070201". */
export function normalizeServiceCode(v: string | null): string | null {
  if (!v) return null
  const t = v.trim()
  if (/^\d{1,2}\.\d{1,2}/.test(t)) {
    const [a, b] = t.split('.')
    return `${a.padStart(2, '0')}.${b.slice(0, 2).padStart(2, '0')}`
  }
  const d = onlyDigits(t)
  if (d.length === 3) return `0${d[0]}.${d.slice(1)}`
  if (d.length === 4 || d.length === 6) return `${d.slice(0, 2)}.${d.slice(2, 4)}`
  return null
}

const ZERO: NfseRetentions = { iss: 0, inss: 0, ir: 0, csll: 0, pis: 0, cofins: 0, outras: 0 }

/** Fecha as contas: líquido informado manda; o que faltar para chegar nele vira "outras". */
function settle(p: {
  servicesCents: number
  unconditional: number
  conditional: number
  retentions: NfseRetentions
  informedNet: number | null
}) {
  const totalCents = p.servicesCents - p.unconditional
  const r = { ...p.retentions }
  let known = r.iss + r.inss + r.ir + r.csll + r.pis + r.cofins
  if (p.informedNet != null && p.informedNet > 0) {
    const implied = totalCents - p.conditional - p.informedNet
    if (implied > known) r.outras = implied - known
    // nota que lista o tributo mas não reteve (ex.: PIS informado sem retenção): confia no líquido
    if (implied < known && implied >= 0) {
      for (const k of ['pis', 'cofins', 'csll', 'ir'] as const) {
        if (known <= implied) break
        const cut = Math.min(r[k], known - implied)
        r[k] -= cut
        known -= cut
      }
    }
  }
  const retainedCents = r.iss + r.inss + r.ir + r.csll + r.pis + r.cofins + r.outras
  return { totalCents, retentions: r, retainedCents, netCents: totalCents - p.conditional - retainedCents }
}

const joinText = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' | ') || null

// ------------------------------------------------------------------ padrão nacional

function parseNacional(nfse: any): ParsedNfse {
  const inf = nfse.infNFSe
  const dps = pick(inf, 'DPS.infDPS') ?? {}
  const idAttr = txt(inf['@_Id'])
  const nationalKey = idAttr ? onlyDigits(idAttr) : null

  const issuerCnpj = doc(inf, 'emit') ?? doc(dps, 'prest')
  const servicesCents = c(dps, 'valores.vServPrest.vServ')
  const unconditional = c(dps, 'valores.vDescCondIncond.vDescIncond')
  const conditional = c(dps, 'valores.vDescCondIncond.vDescCond')
  const tpRet = s(dps, 'valores.trib.tribMun.tpRetISSQN')
  const issRetained = tpRet === '2' || tpRet === '3'
  const issCents = c(inf, 'valores.vISSQN')
  const fed = pick(dps, 'valores.trib.tribFed') ?? {}
  const pisRetained = ['1', '3', '4', '5', '6'].includes(s(fed, 'piscofins.tpRetPisCofins') ?? '')
  const settled = settle({
    servicesCents,
    unconditional,
    conditional,
    retentions: {
      ...ZERO,
      iss: issRetained ? issCents : 0,
      inss: c(fed, 'vRetCP'),
      ir: c(fed, 'vRetIRRF'),
      csll: c(fed, 'vRetCSLL'),
      pis: pisRetained ? c(fed, 'piscofins.vPis') : 0,
      cofins: pisRetained ? c(fed, 'piscofins.vCofins') : 0,
    },
    informedNet: s(inf, 'valores.vLiq') ? c(inf, 'valores.vLiq') : null,
  })

  const obra = pick(dps, 'serv.obra')
  const end = obra ? pick(obra, 'end') : null
  const address = end ? [s(end, 'xLgr'), s(end, 'nro'), s(end, 'xCpl'), s(end, 'xBairro'), s(end, 'CEP', 'endNac.CEP')].filter(Boolean).join(', ') : null
  const description = s(dps, 'serv.cServ.xDescServ') ?? s(inf, 'xTribNac') ?? '(serviço sem descrição)'

  return {
    layout: 'NACIONAL',
    key: nationalKey && nationalKey.length === 50 ? nationalKey : `NFSE-${s(dps, 'cLocEmi') ?? 'BR'}-${issuerCnpj ?? 'X'}-${s(inf, 'nNFSe') ?? s(dps, 'nDPS')}`,
    nationalKey: nationalKey && nationalKey.length === 50 ? nationalKey : null,
    number: s(inf, 'nNFSe'),
    verificationCode: null,
    issueDate: toIso(s(dps, 'dhEmi') ?? s(inf, 'dhProc')),
    competence: day(s(dps, 'dCompet')),
    cityCode: s(inf, 'emit.enderNac.cMun') ?? s(dps, 'cLocEmi'),
    cityName: s(inf, 'xLocEmi'),
    issuer: {
      cnpj: issuerCnpj,
      name: s(inf, 'emit.xNome') ?? s(dps, 'prest.xNome'),
      tradeName: s(inf, 'emit.xFant'),
      municipalRegistration: s(inf, 'emit.IM') ?? s(dps, 'prest.IM'),
      city: s(inf, 'xLocEmi'),
      uf: s(inf, 'emit.enderNac.UF'),
    },
    recipient: { cnpj: doc(dps, 'toma'), name: s(dps, 'toma.xNome') },
    serviceCode: normalizeServiceCode(s(dps, 'serv.cServ.cTribNac')),
    serviceLabel: s(inf, 'xTribNac'),
    description,
    servicesCents,
    unconditionalDiscountCents: unconditional,
    conditionalDiscountCents: conditional,
    deductionsCents: c(dps, 'valores.vDedRed.vDR'),
    ...settled,
    issCents,
    issRate: s(inf, 'valores.pAliqAplic') ?? s(dps, 'valores.trib.tribMun.pAliq'),
    issRetained,
    construction: obra ? { code: s(obra, 'cObra', 'inscImobFisc'), art: null, address: address || null } : null,
    extraInfo: joinText(s(dps, 'serv.infoCompl.xInfComp'), obra ? `Obra ${[s(obra, 'cObra', 'inscImobFisc'), address].filter(Boolean).join(' — ')}` : null),
    cancelled: false,
    replaced: s(inf, 'cStat') === '101',
  }
}

// ------------------------------------------------------------------ ABRASF 1.0 e 2.x

function parseAbrasf(inf: any, comp: any | null): ParsedNfse {
  // 2.x: dados do serviço dentro da declaração; 1.0: direto no InfNfse
  const decl = pick(inf, 'DeclaracaoPrestacaoServico.InfDeclaracaoPrestacaoServico') ?? inf
  const serv = pick(decl, 'Servico') ?? {}
  const val = pick(serv, 'Valores') ?? {}
  const prest = pick(inf, 'PrestadorServico') ?? {}
  const toma = pick(decl, 'TomadorServico', 'Tomador') ?? pick(inf, 'TomadorServico') ?? {}
  const issuerCnpj = doc(prest, 'IdentificacaoPrestador') ?? doc(decl, 'Prestador') ?? doc(decl, 'Prestador.IdentificacaoPrestador')
  const cityCode = s(inf, 'OrgaoGerador.CodigoMunicipio') ?? s(prest, 'Endereco.CodigoMunicipio') ?? s(serv, 'CodigoMunicipio')

  const servicesCents = c(val, 'ValorServicos')
  const unconditional = c(val, 'DescontoIncondicionado')
  const conditional = c(val, 'DescontoCondicionado')
  const issRetained = (s(serv, 'IssRetido') ?? s(val, 'IssRetido')) === '1'
  const issCents = c(inf, 'ValoresNfse.ValorIss') || c(val, 'ValorIss')
  const informed = s(inf, 'ValoresNfse.ValorLiquidoNfse') ?? s(val, 'ValorLiquidoNfse')
  const settled = settle({
    servicesCents,
    unconditional,
    conditional,
    retentions: {
      iss: issRetained ? (c(val, 'ValorIssRetido') || issCents) : 0,
      inss: c(val, 'ValorInss'),
      ir: c(val, 'ValorIr'),
      csll: c(val, 'ValorCsll'),
      pis: c(val, 'ValorPis'),
      cofins: c(val, 'ValorCofins'),
      outras: c(val, 'OutrasRetencoes'),
    },
    informedNet: informed ? toCents(informed) : null,
  })
  const cc = pick(decl, 'ConstrucaoCivil') ?? pick(inf, 'ConstrucaoCivil')
  const number = s(inf, 'Numero')
  const code = cc ? s(cc, 'CodigoObra') : null
  const art = cc ? s(cc, 'Art') : null

  return {
    layout: 'ABRASF',
    key: `NFSE-${cityCode ?? 'X'}-${issuerCnpj ?? 'X'}-${number ?? s(inf, 'CodigoVerificacao')}`,
    nationalKey: null,
    number,
    verificationCode: s(inf, 'CodigoVerificacao'),
    issueDate: toIso(s(inf, 'DataEmissao') ?? s(decl, 'Rps.DataEmissao')),
    competence: day(s(decl, 'Competencia') ?? s(inf, 'Competencia')),
    cityCode,
    cityName: null,
    issuer: {
      cnpj: issuerCnpj,
      name: s(prest, 'RazaoSocial'),
      tradeName: s(prest, 'NomeFantasia'),
      municipalRegistration: s(prest, 'IdentificacaoPrestador.InscricaoMunicipal'),
      city: null,
      uf: s(prest, 'Endereco.Uf') ?? s(inf, 'OrgaoGerador.Uf'),
    },
    recipient: { cnpj: doc(toma, 'IdentificacaoTomador'), name: s(toma, 'RazaoSocial') },
    serviceCode: normalizeServiceCode(s(serv, 'ItemListaServico')),
    serviceLabel: null,
    description: s(serv, 'Discriminacao') ?? '(serviço sem descrição)',
    servicesCents,
    unconditionalDiscountCents: unconditional,
    conditionalDiscountCents: conditional,
    deductionsCents: c(val, 'ValorDeducoes'),
    ...settled,
    issCents,
    issRate: s(inf, 'ValoresNfse.Aliquota') ?? s(val, 'Aliquota'),
    issRetained,
    construction: cc && (code || art) ? { code, art, address: null } : null,
    extraInfo: joinText(s(inf, 'OutrasInformacoes'), code ? `Obra ${code}` : null, art ? `ART ${art}` : null),
    cancelled: !!(comp && pick(comp, 'NfseCancelamento')),
    replaced: !!(comp && pick(comp, 'NfseSubstituicao.SubstituicaoNfse.NfseSubstituidora')),
  }
}

// ------------------------------------------------------------------ Nota Paulistana (São Paulo capital)

function parseSp(n: any): ParsedNfse {
  const issuerCnpj = doc(n, 'CPFCNPJPrestador')
  const number = s(n, 'ChaveNFe.NumeroNFe')
  const servicesCents = c(n, 'ValorServicos')
  const issRetained = (s(n, 'ISSRetido') ?? '').toLowerCase() === 'true'
  const issCents = c(n, 'ValorISS')
  const settled = settle({
    servicesCents,
    unconditional: 0,
    conditional: 0,
    retentions: { ...ZERO, iss: issRetained ? issCents : 0, inss: c(n, 'ValorINSS'), ir: c(n, 'ValorIR'), csll: c(n, 'ValorCSLL'), pis: c(n, 'ValorPIS'), cofins: c(n, 'ValorCOFINS') },
    informedNet: null,
  })
  const end = pick(n, 'EnderecoPrestador') ?? {}
  return {
    layout: 'SP',
    key: `NFSE-3550308-${issuerCnpj ?? 'X'}-${number}`,
    nationalKey: null,
    number,
    verificationCode: s(n, 'ChaveNFe.CodigoVerificacao'),
    issueDate: toIso(s(n, 'DataEmissaoNFe')),
    competence: day(s(n, 'DataFatoGeradorNFe')),
    cityCode: '3550308',
    cityName: 'São Paulo',
    issuer: {
      cnpj: issuerCnpj,
      name: s(n, 'RazaoSocialPrestador'),
      tradeName: null,
      municipalRegistration: s(n, 'ChaveNFe.InscricaoPrestador'),
      city: 'São Paulo',
      uf: s(end, 'UF') ?? 'SP',
    },
    recipient: { cnpj: doc(n, 'CPFCNPJTomador'), name: s(n, 'RazaoSocialTomador') },
    serviceCode: null,
    serviceLabel: s(n, 'CodigoServico') ? `código municipal ${s(n, 'CodigoServico')}` : null,
    description: s(n, 'Discriminacao') ?? '(serviço sem descrição)',
    servicesCents,
    unconditionalDiscountCents: 0,
    conditionalDiscountCents: 0,
    deductionsCents: c(n, 'ValorDeducoes'),
    ...settled,
    issCents,
    issRate: s(n, 'AliquotaServicos'),
    issRetained,
    construction: null,
    extraInfo: null,
    cancelled: (s(n, 'StatusNFe') ?? '').toUpperCase() === 'C',
    replaced: false,
  }
}

// ------------------------------------------------------------------ entrada

/** Diz se o XML parece NFS-e (sem levantar erro). */
export function looksLikeNfse(xml: string): boolean {
  return /<(?:\w+:)?(?:infNFSe|InfNfse|CompNfse)\b/.test(xml) || (/<(?:\w+:)?ChaveNFe\b/.test(xml) && /<(?:\w+:)?ValorServicos\b/.test(xml))
}

export function parseNfseXml(xml: string | Buffer): ParsedNfse {
  let tree: any
  try {
    tree = parser.parse(typeof xml === 'string' ? xml : xml.toString('utf8'))
  } catch {
    throw new NfseParseError('Arquivo não é um XML válido')
  }

  const found: ParsedNfse[] = []
  for (const n of findAll(tree, 'NFSe')) if (n?.infNFSe) found.push(parseNacional(n))
  if (!found.length) {
    const comps = findAll(tree, 'CompNfse')
    if (comps.length) {
      for (const comp of comps) {
        const inf = pick(comp, 'Nfse.InfNfse')
        if (inf) found.push(parseAbrasf(inf, comp))
      }
    } else for (const inf of findAll(tree, 'InfNfse')) found.push(parseAbrasf(inf, null))
  }
  if (!found.length) for (const n of findAll(tree, 'NFe')) if (n?.ChaveNFe) found.push(parseSp(n))

  if (!found.length) throw new NfseParseError('XML não parece ser uma NFS-e (padrão nacional, ABRASF ou Nota Paulistana)')
  if (found.length > 1) throw new NfseParseError(`O arquivo traz ${found.length} notas de serviço. Envie um XML por nota.`)
  return found[0]
}
