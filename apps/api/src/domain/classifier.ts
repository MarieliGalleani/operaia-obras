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
