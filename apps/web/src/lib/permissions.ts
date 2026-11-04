/** Telas e ações que o administrador libera pessoa a pessoa (espelho de apps/api/src/services/permissions.ts). */
export type Screen = 'dashboard' | 'obras' | 'app_obra' | 'orcamentos' | 'compras' | 'fornecedores' | 'notas' | 'pagar' | 'relatorios' | 'inteligencia'
export type Action = 'aprovar_notas' | 'pagamentos' | 'aprovar_pedidos' | 'editar_obras' | 'homologar_fornecedores'
export type Role = 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA' | 'MESTRE'

export interface Perms {
  screens: Screen[]
  actions: Action[]
  projectIds: string[] | null
  custom: boolean
  admin: boolean
}

export const SCREEN_INFO: Array<{ key: Screen; title: string; icon: string; to: string; hint: string }> = [
  { key: 'dashboard', title: 'Visão Geral', icon: 'mdi-home-outline', to: '/', hint: 'Números da construtora e alertas do dia' },
  { key: 'obras', title: 'Obras', icon: 'mdi-office-building-outline', to: '/obras', hint: 'Custo, notas e andamento de cada obra' },
  { key: 'app_obra', title: 'App de obra', icon: 'mdi-hard-hat', to: '/campo', hint: 'Celular do canteiro: material, entregas, fotos, ocorrências, avanço. Sem valores' },
  { key: 'orcamentos', title: 'Orçamentos', icon: 'mdi-calculator-variant-outline', to: '/orcamentos', hint: 'Previsto × realizado por categoria' },
  { key: 'compras', title: 'Compras', icon: 'mdi-cart-outline', to: '/compras', hint: 'Pedidos de compra e pedidos de material da obra' },
  { key: 'fornecedores', title: 'Fornecedores', icon: 'mdi-truck-outline', to: '/fornecedores', hint: 'Cadastro, preços e pontualidade' },
  { key: 'notas', title: 'Notas Fiscais', icon: 'mdi-file-document-outline', to: '/notas', hint: 'Conferir notas e vincular à obra' },
  { key: 'pagar', title: 'Contas a Pagar', icon: 'mdi-calendar-check-outline', to: '/contas-a-pagar', hint: 'Títulos e pagamentos' },
  { key: 'relatorios', title: 'Relatórios', icon: 'mdi-chart-box-outline', to: '/relatorios', hint: 'Custo por obra, fornecedor e mês' },
  { key: 'inteligencia', title: 'Inteligência', icon: 'mdi-creation-outline', to: '/inteligencia', hint: 'Alertas de orçamento, preço, duplicidade e obra' },
]

export const ACTION_INFO: Array<{ key: Action; title: string; hint: string; screen: Screen }> = [
  { key: 'aprovar_notas', title: 'Aprovar, rejeitar e cancelar notas', hint: 'Lança o custo na obra e gera os títulos a pagar', screen: 'notas' },
  { key: 'pagamentos', title: 'Registrar pagamentos', hint: 'Dar baixa nos títulos de Contas a Pagar', screen: 'pagar' },
  { key: 'aprovar_pedidos', title: 'Aprovar pedidos de compra', hint: 'Liberar pedido para o fornecedor, cancelar e recusar pedido de material', screen: 'compras' },
  { key: 'editar_obras', title: 'Cadastrar e editar obras', hint: 'Obras, orçamento, foto e etapas', screen: 'obras' },
  { key: 'homologar_fornecedores', title: 'Homologar e bloquear fornecedores', hint: 'Mudar a situação do fornecedor', screen: 'fornecedores' },
]

const OFFICE: Screen[] = ['dashboard', 'obras', 'app_obra', 'orcamentos', 'compras', 'fornecedores', 'notas', 'pagar', 'relatorios', 'inteligencia']
export const ROLE_DEFAULTS: Record<Role, { screens: Screen[]; actions: Action[] }> = {
  ADMIN: { screens: OFFICE, actions: ACTION_INFO.map((a) => a.key) },
  FINANCEIRO: { screens: OFFICE, actions: ['aprovar_notas', 'pagamentos', 'homologar_fornecedores'] },
  GESTOR_OBRA: { screens: OFFICE, actions: ['aprovar_pedidos', 'editar_obras'] },
  MESTRE: { screens: ['app_obra'], actions: [] },
}

/** Rota → tela (rotas fora daqui não dependem de liberação de tela). */
export function screenOfPath(path: string): Screen | null {
  if (path === '/') return 'dashboard'
  const hit = SCREEN_INFO.filter((s) => s.to !== '/').find((s) => path === s.to || path.startsWith(`${s.to}/`))
  return hit?.key ?? null
}
