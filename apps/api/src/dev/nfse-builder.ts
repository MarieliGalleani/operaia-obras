/**
 * Gera XMLs de NFS-e FICTÍCIOS (padrão nacional, ABRASF 2.04, ABRASF 1.0 e Nota Paulistana)
 * para testes, seed e demonstração. Sem assinatura digital — servem para exercitar a leitura.
 * Valores em reais (número), como num XML real.
 */
import { accessKeyDigit, onlyDigits } from '../domain/cnpj.js'

export interface BuildNfseInput {
  layout: 'NACIONAL' | 'ABRASF' | 'ABRASF1' | 'SP'
  number: number
  issueDate: string // ISO com fuso
  cityCode?: string // IBGE; padrão São Carlos/SP
  issuer: { cnpj: string; name: string; tradeName?: string }
  recipientCnpj: string
  recipientName?: string
  description: string
  serviceCode?: string // LC 116, ex.: "07.02"
  services: number
  issRate?: number // ex.: 0.03
  issRetained?: boolean
  inss?: number
  ir?: number
  csll?: number
  pis?: number
  cofins?: number
  unconditionalDiscount?: number
  obra?: string // código da obra (CNO) ou texto
  extraInfo?: string
  cancelled?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const d2 = (n: number) => n.toFixed(2)
const r2 = (n: number) => Math.round(n * 100) / 100

function totals(i: BuildNfseInput) {
  const base = i.services - (i.unconditionalDiscount ?? 0)
  const iss = r2(base * (i.issRate ?? 0.03))
  const fed = (i.inss ?? 0) + (i.ir ?? 0) + (i.csll ?? 0) + (i.pis ?? 0) + (i.cofins ?? 0)
  const retained = r2(fed + (i.issRetained ? iss : 0))
  return { base, iss, retained, net: r2(base - retained) }
}

export function buildNfseXml(i: BuildNfseInput): { xml: string; key: string } {
  const city = i.cityCode ?? '3548906'
  const cnpj = onlyDigits(i.issuer.cnpj)
  const t = totals(i)
  const code = (i.serviceCode ?? '07.02').replace('.', '')

  if (i.layout === 'NACIONAL') {
    const yymm = i.issueDate.slice(2, 4) + i.issueDate.slice(5, 7)
    const base49 = `${city}12${cnpj}${String(i.number).padStart(13, '0')}${yymm}${String((i.number * 7919) % 1e9).padStart(9, '0')}`
    const key = base49 + accessKeyDigit(base49)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS${key}">
    <xLocEmi>São Carlos</xLocEmi><xLocPrestacao>São Carlos</xLocPrestacao>
    <nNFSe>${i.number}</nNFSe><cLocIncid>${city}</cLocIncid><xLocIncid>São Carlos</xLocIncid>
    <xTribNac>Execução, por administração, empreitada ou subempreitada, de obras de construção civil</xTribNac>
    <verAplic>EmissorWeb_1.0</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>1</procEmi>
    <cStat>100</cStat><dhProc>${i.issueDate}</dhProc><nDFSe>${100000 + i.number}</nDFSe>
    <emit><CNPJ>${cnpj}</CNPJ><IM>12345</IM><xNome>${esc(i.issuer.name)}</xNome>${i.issuer.tradeName ? `<xFant>${esc(i.issuer.tradeName)}</xFant>` : ''}
      <enderNac><xLgr>Rua Episcopal</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>${city}</cMun><UF>SP</UF><CEP>13560000</CEP></enderNac></emit>
    <valores><vBC>${d2(t.base)}</vBC><pAliqAplic>${d2((i.issRate ?? 0.03) * 100)}</pAliqAplic><vISSQN>${d2(t.iss)}</vISSQN><vTotalRet>${d2(t.retained)}</vTotalRet><vLiq>${d2(t.net)}</vLiq></valores>
    <DPS versao="1.00"><infDPS Id="DPS${city}2${cnpj}00001${String(i.number).padStart(15, '0')}">
      <tpAmb>2</tpAmb><dhEmi>${i.issueDate}</dhEmi><verAplic>EmissorWeb_1.0</verAplic><serie>1</serie><nDPS>${i.number}</nDPS>
      <dCompet>${i.issueDate.slice(0, 10)}</dCompet><tpEmit>1</tpEmit><cLocEmi>${city}</cLocEmi>
      <prest><CNPJ>${cnpj}</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
      <toma><CNPJ>${onlyDigits(i.recipientCnpj)}</CNPJ><xNome>${esc(i.recipientName ?? 'Construtora')}</xNome></toma>
      <serv><locPrest><cLocPrestacao>${city}</cLocPrestacao></locPrest>
        <cServ><cTribNac>${code}01</cTribNac><xDescServ>${esc(i.description)}</xDescServ></cServ>
        ${i.obra ? `<obra><cObra>${esc(i.obra)}</cObra></obra>` : ''}
        ${i.extraInfo ? `<infoCompl><xInfComp>${esc(i.extraInfo)}</xInfComp></infoCompl>` : ''}
      </serv>
      <valores><vServPrest><vServ>${d2(i.services)}</vServ></vServPrest>
        ${i.unconditionalDiscount ? `<vDescCondIncond><vDescIncond>${d2(i.unconditionalDiscount)}</vDescIncond></vDescCondIncond>` : ''}
        <trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${i.issRetained ? 2 : 1}</tpRetISSQN></tribMun>
          <tribFed>${i.pis || i.cofins ? `<piscofins><CST>01</CST><vPis>${d2(i.pis ?? 0)}</vPis><vCofins>${d2(i.cofins ?? 0)}</vCofins><tpRetPisCofins>1</tpRetPisCofins></piscofins>` : ''}${i.inss ? `<vRetCP>${d2(i.inss)}</vRetCP>` : ''}${i.ir ? `<vRetIRRF>${d2(i.ir)}</vRetIRRF>` : ''}${i.csll ? `<vRetCSLL>${d2(i.csll)}</vRetCSLL>` : ''}</tribFed>
          <totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`
    return { xml, key }
  }

  if (i.layout === 'SP') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RetornoConsulta xmlns="http://www.prefeitura.sp.gov.br/nfe"><Cabecalho Versao="1"><Sucesso>true</Sucesso></Cabecalho>
<NFe><ChaveNFe><InscricaoPrestador>48201234</InscricaoPrestador><NumeroNFe>${i.number}</NumeroNFe><CodigoVerificacao>AB12CD34</CodigoVerificacao></ChaveNFe>
<DataEmissaoNFe>${i.issueDate.slice(0, 19)}</DataEmissaoNFe><DataFatoGeradorNFe>${i.issueDate.slice(0, 19)}</DataFatoGeradorNFe>
<CPFCNPJPrestador><CNPJ>${cnpj}</CNPJ></CPFCNPJPrestador><RazaoSocialPrestador>${esc(i.issuer.name)}</RazaoSocialPrestador>
<EnderecoPrestador><Logradouro>Av Paulista</Logradouro><NumeroEndereco>1000</NumeroEndereco><Cidade>3550308</Cidade><UF>SP</UF><CEP>1310100</CEP></EnderecoPrestador>
<StatusNFe>${i.cancelled ? 'C' : 'N'}</StatusNFe><TributacaoNFe>T</TributacaoNFe><OpcaoSimples>0</OpcaoSimples>
<ValorServicos>${d2(i.services)}</ValorServicos><ValorDeducoes>0</ValorDeducoes>
<ValorPIS>${d2(i.pis ?? 0)}</ValorPIS><ValorCOFINS>${d2(i.cofins ?? 0)}</ValorCOFINS><ValorINSS>${d2(i.inss ?? 0)}</ValorINSS><ValorIR>${d2(i.ir ?? 0)}</ValorIR><ValorCSLL>${d2(i.csll ?? 0)}</ValorCSLL>
<CodigoServico>07102</CodigoServico><AliquotaServicos>${i.issRate ?? 0.03}</AliquotaServicos><ValorISS>${d2(t.iss)}</ValorISS><ValorCredito>0</ValorCredito><ISSRetido>${i.issRetained ? 'true' : 'false'}</ISSRetido>
<CPFCNPJTomador><CNPJ>${onlyDigits(i.recipientCnpj)}</CNPJ></CPFCNPJTomador><RazaoSocialTomador>${esc(i.recipientName ?? 'Construtora')}</RazaoSocialTomador>
<Discriminacao>${esc([i.description, i.extraInfo].filter(Boolean).join(' - '))}</Discriminacao></NFe></RetornoConsulta>`
    return { xml, key: `NFSE-3550308-${cnpj}-${i.number}` }
  }

  const valores = `<ValorServicos>${d2(i.services)}</ValorServicos><ValorDeducoes>0.00</ValorDeducoes>
        <ValorPis>${d2(i.pis ?? 0)}</ValorPis><ValorCofins>${d2(i.cofins ?? 0)}</ValorCofins><ValorInss>${d2(i.inss ?? 0)}</ValorInss><ValorIr>${d2(i.ir ?? 0)}</ValorIr><ValorCsll>${d2(i.csll ?? 0)}</ValorCsll>
        <OutrasRetencoes>0.00</OutrasRetencoes><ValorIss>${d2(t.iss)}</ValorIss><Aliquota>${(i.issRate ?? 0.03) * 100}</Aliquota>
        <DescontoIncondicionado>${d2(i.unconditionalDiscount ?? 0)}</DescontoIncondicionado><DescontoCondicionado>0.00</DescontoCondicionado>`
  const cancel = i.cancelled ? `<NfseCancelamento><Confirmacao><Pedido><InfPedidoCancelamento><CodigoCancelamento>1</CodigoCancelamento></InfPedidoCancelamento></Pedido><DataHora>${i.issueDate.slice(0, 19)}</DataHora></Confirmacao></NfseCancelamento>` : ''

  if (i.layout === 'ABRASF1') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseResposta xmlns="http://www.abrasf.org.br/nfse.xsd"><ListaNfse><CompNfse><tc:Nfse xmlns:tc="http://www.abrasf.org.br/tipos_nfse_v01.xsd"><tc:InfNfse Id="nfse${i.number}">
  <tc:Numero>${i.number}</tc:Numero><tc:CodigoVerificacao>X9Y8Z7</tc:CodigoVerificacao><tc:DataEmissao>${i.issueDate.slice(0, 19)}</tc:DataEmissao>
  <tc:NaturezaOperacao>1</tc:NaturezaOperacao><tc:Competencia>${i.issueDate.slice(0, 19)}</tc:Competencia>
  ${i.extraInfo ? `<tc:OutrasInformacoes>${esc(i.extraInfo)}</tc:OutrasInformacoes>` : ''}
  <tc:Servico><tc:Valores>${valores.replace(/<(\/?)(\w+)>/g, '<$1tc:$2>')}<tc:IssRetido>${i.issRetained ? 1 : 2}</tc:IssRetido><tc:ValorLiquidoNfse>${d2(t.net)}</tc:ValorLiquidoNfse></tc:Valores>
    <tc:ItemListaServico>${i.serviceCode ?? '07.02'}</tc:ItemListaServico><tc:Discriminacao>${esc(i.description)}</tc:Discriminacao><tc:CodigoMunicipio>${city}</tc:CodigoMunicipio></tc:Servico>
  <tc:PrestadorServico><tc:IdentificacaoPrestador><tc:Cnpj>${cnpj}</tc:Cnpj><tc:InscricaoMunicipal>778899</tc:InscricaoMunicipal></tc:IdentificacaoPrestador><tc:RazaoSocial>${esc(i.issuer.name)}</tc:RazaoSocial>
    <tc:Endereco><tc:Endereco>Rua Um</tc:Endereco><tc:Numero>1</tc:Numero><tc:CodigoMunicipio>${city}</tc:CodigoMunicipio><tc:Uf>SP</tc:Uf></tc:Endereco></tc:PrestadorServico>
  <tc:TomadorServico><tc:IdentificacaoTomador><tc:CpfCnpj><tc:Cnpj>${onlyDigits(i.recipientCnpj)}</tc:Cnpj></tc:CpfCnpj></tc:IdentificacaoTomador><tc:RazaoSocial>${esc(i.recipientName ?? 'Construtora')}</tc:RazaoSocial></tc:TomadorServico>
  <tc:OrgaoGerador><tc:CodigoMunicipio>${city}</tc:CodigoMunicipio><tc:Uf>SP</tc:Uf></tc:OrgaoGerador>
  ${i.obra ? `<tc:ConstrucaoCivil><tc:CodigoObra>${esc(i.obra)}</tc:CodigoObra><tc:Art>ART-2026-0001</tc:Art></tc:ConstrucaoCivil>` : ''}
</tc:InfNfse></tc:Nfse>${cancel}</CompNfse></ListaNfse></ConsultarNfseResposta>`
    return { xml, key: `NFSE-${city}-${cnpj}-${i.number}` }
  }

  // ABRASF 2.04
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd"><Nfse versao="2.04"><InfNfse Id="NFSe${i.number}">
  <Numero>${i.number}</Numero><CodigoVerificacao>K7L8M9</CodigoVerificacao><DataEmissao>${i.issueDate.slice(0, 19)}</DataEmissao>
  ${i.extraInfo ? `<OutrasInformacoes>${esc(i.extraInfo)}</OutrasInformacoes>` : ''}
  <ValoresNfse><BaseCalculo>${d2(t.base)}</BaseCalculo><Aliquota>${(i.issRate ?? 0.03) * 100}</Aliquota><ValorIss>${d2(t.iss)}</ValorIss><ValorLiquidoNfse>${d2(t.net)}</ValorLiquidoNfse></ValoresNfse>
  <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj><InscricaoMunicipal>556677</InscricaoMunicipal></IdentificacaoPrestador>
    <RazaoSocial>${esc(i.issuer.name)}</RazaoSocial>${i.issuer.tradeName ? `<NomeFantasia>${esc(i.issuer.tradeName)}</NomeFantasia>` : ''}
    <Endereco><Endereco>Av. Sao Carlos</Endereco><Numero>2000</Numero><CodigoMunicipio>${city}</CodigoMunicipio><Uf>SP</Uf><Cep>13560000</Cep></Endereco></PrestadorServico>
  <OrgaoGerador><CodigoMunicipio>${city}</CodigoMunicipio><Uf>SP</Uf></OrgaoGerador>
  <DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico Id="rps${i.number}">
    <Rps><IdentificacaoRps><Numero>${i.number}</Numero><Serie>A1</Serie><Tipo>1</Tipo></IdentificacaoRps><DataEmissao>${i.issueDate.slice(0, 10)}</DataEmissao><Status>1</Status></Rps>
    <Competencia>${i.issueDate.slice(0, 10)}</Competencia>
    <Servico><Valores>${valores}</Valores><IssRetido>${i.issRetained ? 1 : 2}</IssRetido>
      <ItemListaServico>${i.serviceCode ?? '07.02'}</ItemListaServico><CodigoTributacaoMunicipio>070201</CodigoTributacaoMunicipio>
      <Discriminacao>${esc(i.description)}</Discriminacao><CodigoMunicipio>${city}</CodigoMunicipio><ExigibilidadeISS>1</ExigibilidadeISS></Servico>
    <Prestador><CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj></Prestador>
    <TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>${onlyDigits(i.recipientCnpj)}</Cnpj></CpfCnpj></IdentificacaoTomador><RazaoSocial>${esc(i.recipientName ?? 'Construtora')}</RazaoSocial></TomadorServico>
    ${i.obra ? `<ConstrucaoCivil><CodigoObra>${esc(i.obra)}</CodigoObra><Art>ART-2026-0002</Art></ConstrucaoCivil>` : ''}
  </InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>
</InfNfse></Nfse>${cancel}</CompNfse>`
  return { xml, key: `NFSE-${city}-${cnpj}-${i.number}` }
}
