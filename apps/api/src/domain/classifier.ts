/**
 * Sugestões determinísticas e explicáveis: toda sugestão vem com o motivo.
 * A camada de IA (GRIOT) poderá entrar depois como mais um "sugestor", nunca como quem decide.
 */
import type { CostCategory } from '../db/schema.js'

export function normalize(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const CATEGORY_KEYWORDS: Array<[CostCategory, string[]]> = [
  ['EQUIPAMENTOS', ['locacao', 'aluguel', 'retroescavadeira', 'betoneira', 'andaime', 'escavadeira', 'guindaste', 'maquina', 'equipamento', 'compactador']],
  ['TERCEIRIZADOS', ['empreitada', 'subempreitada', 'terceirizad', 'instalacao', 'montagem', 'mao de obra terceir']],
  ['MAO_DE_OBRA', ['mao de obra', 'diaria', 'pedreiro', 'servente', 'folha']],
  ['SERVICOS', ['servico', 'consultoria', 'projeto', 'frete', 'transporte', 'laudo', 'topografia', 'engenharia']],
  ['MATERIAIS', ['concreto', 'cimento', 'areia', 'brita', 'aco', 'vergalhao', 'ca 50', 'ca 60', 'tijolo', 'bloco', 'argamassa', 'cabo', 'fio', 'eletric', 'tubo', 'conexao', 'pvc', 'tinta', 'madeira', 'telha', 'piso', 'ceramica', 'cal ', 'ferro']],
]

/** Prefixos de NCM típicos de materiais de construção */
const MATERIAL_NCM_PREFIXES = ['25', '68', '69', '70', '72', '73', '74', '76', '3214', '3208', '3209', '3917', '4418', '8544']

export function suggestCategory(input: {
  supplierDefault?: CostCategory | null
  operation?: string | null
  items: Array<{ description: string; ncm?: string | null; totalCents: number }>
}): { category: CostCategory; reason: string } {
  if (input.supplierDefault) return { category: input.supplierDefault, reason: 'padrão do fornecedor' }

  // pontua por valor: o item mais caro pesa mais
  const score = new Map<CostCategory, number>()
  const add = (c: CostCategory, w: number) => score.set(c, (score.get(c) ?? 0) + w)
  const op = normalize(input.operation)
  for (const [cat, words] of CATEGORY_KEYWORDS) if (words.some((w) => op.includes(w))) add(cat, 1)

  for (const item of input.items) {
    const text = ` ${normalize(item.description)} `
    const weight = Math.max(1, item.totalCents)
    let matched = false
    for (const [cat, words] of CATEGORY_KEYWORDS) {
      if (words.some((w) => text.includes(w))) {
        add(cat, weight)
        matched = true
        break
      }
    }
    if (!matched && item.ncm && MATERIAL_NCM_PREFIXES.some((p) => item.ncm!.startsWith(p))) add('MATERIAIS', weight)
  }

  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) return { category: 'OUTROS', reason: 'nenhuma regra correspondeu' }
  return { category: best[0], reason: 'palavras-chave e NCM dos itens' }
}

/**
 * Itens da LC 116 mais comuns em obra → categoria de custo.
 * Empreitada, reforma, demolição e instalações viram terceirizados; projeto, sondagem e
 * fiscalização viram serviços; cessão de andaime e estruturas temporárias viram equipamentos.
 */
const SERVICE_CODE_CATEGORY: Record<string, CostCategory> = {
  '07.02': 'TERCEIRIZADOS', // execução de obra por empreitada ou subempreitada
  '07.04': 'TERCEIRIZADOS', // demolição
  '07.05': 'TERCEIRIZADOS', // reparação, conservação e reforma
  '07.06': 'TERCEIRIZADOS', // colocação de pisos, revestimentos, vidros
  '07.08': 'TERCEIRIZADOS', // calafetação
  '07.17': 'TERCEIRIZADOS', // escoramento e contenção de encostas
  '07.01': 'SERVICOS', // engenharia, arquitetura
  '07.03': 'SERVICOS', // projetos e estudos
  '07.19': 'SERVICOS', // acompanhamento e fiscalização
  '07.20': 'SERVICOS', // topografia, sondagem
  '07.09': 'SERVICOS', // coleta e destinação de resíduos (caçamba)
  '07.10': 'SERVICOS', // limpeza
  '03.04': 'EQUIPAMENTOS', // cessão de estruturas temporárias
  '03.05': 'EQUIPAMENTOS', // cessão de andaimes
  '16.01': 'SERVICOS', // transporte
  '16.02': 'SERVICOS',
}

export function suggestServiceCategory(input: {
  supplierDefault?: CostCategory | null
  serviceCode: string | null
  description: string
}): { category: CostCategory; reason: string } {
  if (input.supplierDefault) return { category: input.supplierDefault, reason: 'padrão do fornecedor' }
  const byCode = input.serviceCode ? SERVICE_CODE_CATEGORY[input.serviceCode] : undefined
  if (byCode) return { category: byCode, reason: `item ${input.serviceCode} da lista de serviços` }
  const byText = suggestCategory({ items: [{ description: input.description, totalCents: 1 }] })
  if (byText.category !== 'OUTROS') return { category: byText.category, reason: 'palavras-chave da descrição do serviço' }
  return { category: 'SERVICOS', reason: 'nota de serviço' }
}

export interface ProjectRef {
  id: string
  code: string
  name: string
}

/**
 * Procura a obra no texto da nota (informações complementares, pedido de compra).
 * Construtoras costumam pedir ao fornecedor que informe "Obra: Residencial Aurora" ou o código.
 */
export function findProjectInText(text: string | null | undefined, projects: ProjectRef[]): { project: ProjectRef; reason: string } | null {
  const t = ` ${normalize(text)} `
  if (!t.trim()) return null

  // 1. código exato (ex.: OBR-001 → "obr 001")
  for (const p of projects) {
    const code = normalize(p.code)
    if (code && t.includes(` ${code} `)) return { project: p, reason: `código ${p.code} citado na nota` }
  }
  // 2. nome completo
  for (const p of projects) {
    const name = normalize(p.name)
    if (name && t.includes(` ${name} `)) return { project: p, reason: `nome "${p.name}" citado na nota` }
  }
  // 3. palavra distintiva do nome (ignora termos genéricos), só se for única entre as obras
  const generic = new Set(['residencial', 'edificio', 'casa', 'condominio', 'obra', 'torre', 'bloco', 'reforma', 'predio', 'loteamento', 'de', 'do', 'da', 'jardim'])
  const hits = projects.filter((p) => {
    const words = normalize(p.name).split(' ').filter((w) => w.length >= 4 && !generic.has(w))
    return words.some((w) => t.includes(` ${w} `))
  })
  if (hits.length === 1) return { project: hits[0], reason: `referência a "${hits[0].name}" na nota` }
  return null
}
