/**
 * Gera XMLs de NF-e 4.00 (nfeProc) FICTÍCIOS para testes, seed e demonstração.
 * Não têm assinatura digital válida — servem para exercitar a leitura, não para efeito fiscal.
 */
import { accessKeyDigit, onlyDigits } from '../domain/cnpj.js'

export interface BuildNfeInput {
  number: number
  series?: number
  issueDate: string // ISO com fuso, ex.: 2025-08-10T10:00:00-03:00
  uf?: string // código IBGE da UF, default 35 (SP)
  issuer: { cnpj: string; name: string; tradeName?: string; city?: string }
  recipientCnpj: string
  recipientName?: string
  operation?: string
  items: Array<{ code?: string; description: string; ncm?: string; cfop?: string; unit?: string; quantity: number; unitPrice: number }>
  installments?: Array<{ dueDate: string; amount: number }>
  extraInfo?: string
  purchaseOrder?: string
  /** força uma chave específica (para simular reenvio da mesma nota) */
  cNF?: number
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dec = (n: number, d = 2) => n.toFixed(d)

export function buildNfeXml(input: BuildNfeInput): { xml: string; accessKey: string } {
  const uf = input.uf ?? '35'
  const series = input.series ?? 1
  const yymm = input.issueDate.slice(2, 4) + input.issueDate.slice(5, 7)
  const cnpj = onlyDigits(input.issuer.cnpj)
  const cNF = String(input.cNF ?? (input.number * 7919) % 100000000).padStart(8, '0')
  const base = `${uf}${yymm}${cnpj}55${String(series).padStart(3, '0')}${String(input.number).padStart(9, '0')}1${cNF}`
  const accessKey = base + accessKeyDigit(base)

  const items = input.items.map((it, i) => {
    const total = Math.round(it.quantity * it.unitPrice * 100) / 100
    return { ...it, total, n: i + 1 }
  })
  const vProd = items.reduce((a, b) => a + b.total, 0)

  const det = items
    .map(
      (it) => `
      <det nItem="${it.n}">
        <prod>
          <cProd>${esc(it.code ?? String(1000 + it.n))}</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>${esc(it.description)}</xProd>
          <NCM>${it.ncm ?? '00000000'}</NCM>
          <CFOP>${it.cfop ?? '5102'}</CFOP>
          <uCom>${esc(it.unit ?? 'UN')}</uCom>
          <qCom>${dec(it.quantity, 4)}</qCom>
          <vUnCom>${dec(it.unitPrice, 4)}</vUnCom>
          <vProd>${dec(it.total)}</vProd>
          <cEANTrib>SEM GTIN</cEANTrib>
          <uTrib>${esc(it.unit ?? 'UN')}</uTrib>
          <qTrib>${dec(it.quantity, 4)}</qTrib>
          <vUnTrib>${dec(it.unitPrice, 4)}</vUnTrib>
          <indTot>1</indTot>${input.purchaseOrder ? `\n          <xPed>${esc(input.purchaseOrder)}</xPed>` : ''}
        </prod>
        <imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto>
      </det>`,
    )
    .join('')

  const dups = (input.installments ?? [])
    .map((d, i) => `<dup><nDup>${String(i + 1).padStart(3, '0')}</nDup><dVenc>${d.dueDate}</dVenc><vDup>${dec(d.amount)}</vDup></dup>`)
    .join('')
  const cobr = dups ? `<cobr><fat><nFat>${input.number}</nFat><vOrig>${dec(vProd)}</vOrig><vDesc>0.00</vDesc><vLiq>${dec(vProd)}</vLiq></fat>${dups}</cobr>` : ''

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${accessKey}" versao="4.00">
      <ide>
        <cUF>${uf}</cUF><cNF>${cNF}</cNF><natOp>${esc(input.operation ?? 'Venda de mercadoria')}</natOp>
        <mod>55</mod><serie>${series}</serie><nNF>${input.number}</nNF>
        <dhEmi>${input.issueDate}</dhEmi><tpNF>1</tpNF><idDest>1</idDest>
        <cMunFG>3548906</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${accessKey[43]}</cDV>
        <tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres><procEmi>0</procEmi><verProc>operaia-fixture</verProc>
      </ide>
      <emit>
        <CNPJ>${cnpj}</CNPJ><xNome>${esc(input.issuer.name)}</xNome>${input.issuer.tradeName ? `<xFant>${esc(input.issuer.tradeName)}</xFant>` : ''}
        <enderEmit><xLgr>Rua Exemplo</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>3548906</cMun><xMun>${esc(input.issuer.city ?? 'São Carlos')}</xMun><UF>SP</UF><CEP>13560000</CEP></enderEmit>
        <IE>123456789110</IE><CRT>1</CRT>
      </emit>
      <dest>
        <CNPJ>${onlyDigits(input.recipientCnpj)}</CNPJ><xNome>${esc(input.recipientName ?? 'Construtora')}</xNome><indIEDest>9</indIEDest>
      </dest>${det}
      <total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>${dec(vProd)}</vProd><vFrete>0.00</vFrete><vDesc>0.00</vDesc><vNF>${dec(vProd)}</vNF></ICMSTot></total>
      <transp><modFrete>0</modFrete></transp>
      ${cobr}
      <pag><detPag><tPag>15</tPag><vPag>${dec(vProd)}</vPag></detPag></pag>
      ${input.extraInfo ? `<infAdic><infCpl>${esc(input.extraInfo)}</infCpl></infAdic>` : ''}
      ${input.purchaseOrder ? `<compra><xPed>${esc(input.purchaseOrder)}</xPed></compra>` : ''}
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${accessKey}</chNFe><dhRecbto>${input.issueDate}</dhRecbto><nProt>1352500000${String(input.number).padStart(5, '0')}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
</nfeProc>
`
  return { xml, accessKey }
}
