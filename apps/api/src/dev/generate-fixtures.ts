/**
 * Gera XMLs de exemplo em apps/api/fixtures/ para testar o upload na tela,
 * já com o CNPJ da Construtora Alpha (seed). Dados fictícios.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { cnpjWithDigits } from '../domain/cnpj.js'
import { buildNfeXml } from './nfe-builder.js'

const ALPHA = cnpjWithDigits('451230980001')
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const plus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
const out = new URL('../../fixtures/', import.meta.url)
mkdirSync(out, { recursive: true })

const samples = [
  {
    file: '01-concremax-residencial-aurora.xml',
    note: 'Caminho feliz: obra citada na nota, 2 parcelas',
    input: {
      number: 20001,
      issuer: { cnpj: cnpjWithDigits('123456780001'), name: 'Concremax Concreto Ltda' },
      items: [{ description: 'CONCRETO USINADO FCK 30 MPA', ncm: '38245000', unit: 'M3', quantity: 30, unitPrice: 418 }],
      installments: [
        { dueDate: plus(28), amount: 6270 },
        { dueDate: plus(56), amount: 6270 },
      ],
      extraInfo: 'Obra: Residencial Aurora. Bomba lança incluída.',
    },
  },
  {
    file: '02-construluz-sem-obra.xml',
    note: 'Sem obra informada → vai para revisão',
    input: {
      number: 20002,
      issuer: { cnpj: cnpjWithDigits('445566770001'), name: 'Construluz Materiais Elétricos Ltda' },
      items: [
        { description: 'CABO FLEXIVEL 2,5MM 750V', ncm: '85444900', unit: 'M', quantity: 1200, unitPrice: 3.25 },
        { description: 'DISJUNTOR DIN 32A', ncm: '85362000', unit: 'UN', quantity: 40, unitPrice: 28.5 },
      ],
      installments: [{ dueDate: plus(21), amount: 5040 }],
    },
  },
  {
    file: '03-acoforte-preco-alto.xml',
    note: 'Aço 25% acima da média do fornecedor → alerta de preço',
    input: {
      number: 20003,
      issuer: { cnpj: cnpjWithDigits('334455660001'), name: 'Aço Forte Comércio de Ferro Ltda' },
      items: [{ description: 'VERGALHAO ACO CA-50 10MM', ncm: '72142000', unit: 'KG', quantity: 2500, unitPrice: 8.0 }],
      installments: [{ dueDate: plus(30), amount: 20000 }],
      extraInfo: 'OBR-002',
    },
  },
  {
    file: '04-outro-destinatario.xml',
    note: 'Nota emitida para outro CNPJ → pendência crítica',
    input: {
      number: 20004,
      recipientCnpj: cnpjWithDigits('111111110001'),
      issuer: { cnpj: cnpjWithDigits('556677880001'), name: 'Depósito São Carlos Materiais de Construção' },
      items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 100, unitPrice: 39 }],
      installments: [{ dueDate: plus(15), amount: 3900 }],
      extraInfo: 'Obra: Casa Jardim',
    },
  },
  {
    file: '05-fornecedor-novo-rateio.xml',
    note: 'Fornecedor novo (cadastro automático); bom para testar rateio entre obras',
    input: {
      number: 20005,
      issuer: { cnpj: cnpjWithDigits('135792460001'), name: 'Hidráulica Center Ltda' },
      items: [
        { description: 'TUBO PVC SOLDAVEL 50MM 6M', ncm: '39172300', unit: 'UN', quantity: 120, unitPrice: 54.9 },
        { description: 'CONEXAO JOELHO 90 PVC 50MM', ncm: '39174090', unit: 'UN', quantity: 300, unitPrice: 4.2 },
      ],
      installments: [{ dueDate: plus(30), amount: 7848 }],
      extraInfo: 'Entregas: Residencial Aurora e Edifício Horizonte',
    },
  },
]

const readme = ['# XMLs de exemplo (fictícios)', '', 'Gerados para a Construtora Alpha do seed. Arraste na tela **Notas Fiscais**.', '']
for (const s of samples) {
  const { xml } = buildNfeXml({ issueDate: `${today}T09:00:00-03:00`, recipientCnpj: ALPHA, recipientName: 'Construtora Alpha Ltda', ...s.input } as any)
  writeFileSync(new URL(s.file, out), xml)
  readme.push(`- \`${s.file}\` — ${s.note}`)
}
writeFileSync(new URL('README.md', out), readme.join('\n') + '\n')
console.log(`✔ ${samples.length} XMLs em apps/api/fixtures/`)
