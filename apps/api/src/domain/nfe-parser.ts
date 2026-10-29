/**
 * Leitura determinística do XML da NF-e (modelo 55), versão 4.00.
 * Aceita tanto o XML "nfeProc" (autorizado, com protocolo) quanto o "NFe" puro.
 * Nenhuma IA aqui: o XML é estruturado e a leitura precisa ser 100% reproduzível.
 */
import { XMLParser } from 'fast-xml-parser'
import { onlyDigits } from './cnpj.js'
import { toCents } from './money.js'

export interface ParsedNfeItem {
  code: string | null
  description: string
  ncm: string | null
  cfop: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  totalCents: number
}

export interface ParsedNfeInstallment {
  number: string
  dueDate: string // YYYY-MM-DD
  amountCents: number
}

export interface ParsedNfe {
  accessKey: string | null
  number: string | null
  series: string | null
  issueDate: string | null // ISO
  operation: string | null // natOp
  issuer: { cnpj: string | null; name: string | null; tradeName: string | null; city: string | null; uf: string | null }
  recipient: { cnpj: string | null; name: string | null }
  totalCents: number
  productsCents: number
  items: ParsedNfeItem[]
  installments: ParsedNfeInstallment[]
  /** Texto livre de informações complementares (onde costuma vir "Obra: ...") */
  extraInfo: string | null
  /** xPed / pedido de compra, quando informado */
  purchaseOrder: string | null
  authorized: boolean
  protocol: string | null
}

export class NfeParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

export function parseNfeXml(xml: string | Buffer): ParsedNfe {
  let doc: any
  try {
    doc = parser.parse(typeof xml === 'string' ? xml : xml.toString('utf8'))
  } catch (e) {
    throw new NfeParseError('Arquivo não é um XML válido')
  }

  const proc = doc.nfeProc ?? null
  const nfe = proc?.NFe ?? doc.NFe
  const inf = nfe?.infNFe
  if (!inf) throw new NfeParseError('XML não parece ser uma NF-e (infNFe não encontrado)')

  const ide = inf.ide ?? {}
  const emit = inf.emit ?? {}
  const dest = inf.dest ?? {}
  const total = inf.total?.ICMSTot ?? {}
  const cobr = inf.cobr ?? {}
  const infAdic = inf.infAdic ?? {}
  const compra = inf.compra ?? {}
  const prot = proc?.protNFe?.infProt

  const idAttr = str(inf['@_Id'])
  const accessKey = idAttr ? onlyDigits(idAttr) : str(prot?.chNFe)

  const items: ParsedNfeItem[] = asArray(inf.det).map((det: any) => {
    const p = det.prod ?? {}
    return {
      code: str(p.cProd),
      description: str(p.xProd) ?? '(sem descrição)',
      ncm: str(p.NCM),
      cfop: str(p.CFOP),
      unit: str(p.uCom),
      quantity: str(p.qCom) ?? '0',
      unitPrice: str(p.vUnCom) ?? '0',
      totalCents: toCents(str(p.vProd)),
    }
  })

  // xPed pode vir no item ou no grupo compra
  const itemOrders = asArray(inf.det)
    .map((d: any) => str(d.prod?.xPed))
    .filter(Boolean) as string[]

  const installments: ParsedNfeInstallment[] = asArray(cobr.dup).map((d: any, i: number) => ({
    number: str(d.nDup) ?? String(i + 1).padStart(3, '0'),
    dueDate: (str(d.dVenc) ?? '').slice(0, 10),
    amountCents: toCents(str(d.vDup)),
  }))

  const issue = str(ide.dhEmi) ?? str(ide.dEmi)

  return {
    accessKey: accessKey && accessKey.length === 44 ? accessKey : accessKey,
    number: str(ide.nNF),
    series: str(ide.serie),
    issueDate: issue ? new Date(issue.length === 10 ? `${issue}T12:00:00-03:00` : issue).toISOString() : null,
    operation: str(ide.natOp),
    issuer: {
      cnpj: str(emit.CNPJ) ? onlyDigits(emit.CNPJ) : null,
      name: str(emit.xNome),
      tradeName: str(emit.xFant),
      city: str(emit.enderEmit?.xMun),
      uf: str(emit.enderEmit?.UF),
    },
    recipient: {
      cnpj: str(dest.CNPJ) ? onlyDigits(dest.CNPJ) : null,
      name: str(dest.xNome),
    },
    totalCents: toCents(str(total.vNF)),
    productsCents: toCents(str(total.vProd)),
    items,
    installments,
    extraInfo: [str(infAdic.infCpl), str(infAdic.infAdFisco)].filter(Boolean).join(' | ') || null,
    purchaseOrder: str(compra.xPed) ?? itemOrders[0] ?? null,
    authorized: str(prot?.cStat) === '100',
    protocol: str(prot?.nProt),
  }
}
