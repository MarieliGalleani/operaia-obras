/**
 * Liberações por pessoa.
 *
 * Cada perfil tem um padrão (telas + ações). O administrador pode ajustar pessoa a pessoa:
 * - telas: quais menus a pessoa vê (e quais rotas da API ela consegue chamar);
 * - ações: o que ela pode aprovar, pagar ou editar;
 * - obras: todas ou só algumas (vale para o sistema todo; ver services/scope.ts).
 * Administrador sempre tem tudo. Integrações e Configurações (equipe, chave da API, e-mail) são só do administrador.
 * A API confere a cada requisição; o front só esconde o que a API já bloquearia.
 */
export const SCREENS = ['dashboard', 'obras', 'app_obra', 'orcamentos', 'compras', 'fornecedores', 'notas', 'pagar', 'relatorios', 'inteligencia'] as const
export const ACTIONS = ['aprovar_notas', 'pagamentos', 'aprovar_pedidos', 'editar_obras', 'homologar_fornecedores'] as const
export type Screen = (typeof SCREENS)[number]
export type Action = (typeof ACTIONS)[number]
export type Role = 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA' | 'MESTRE' | 'PROPRIETARIO'

export interface StoredPerms {
  screens?: Screen[]
  actions?: Action[]
  /** null/ausente = todas as obras */
  projectIds?: string[] | null
}
export interface Perms {
  screens: Screen[]
  actions: Action[]
  projectIds: string[] | null
  /** ajustado pelo administrador (diferente do padrão do perfil) */
  custom: boolean
  admin: boolean
}

const OFFICE: Screen[] = ['dashboard', 'obras', 'app_obra', 'orcamentos', 'compras', 'fornecedores', 'notas', 'pagar', 'relatorios', 'inteligencia']
export const ROLE_DEFAULTS: Record<Role, { screens: Screen[]; actions: Action[] }> = {
  ADMIN: { screens: [...SCREENS], actions: [...ACTIONS] },
  FINANCEIRO: { screens: OFFICE, actions: ['aprovar_notas', 'pagamentos', 'homologar_fornecedores'] },
  GESTOR_OBRA: { screens: OFFICE, actions: ['aprovar_pedidos', 'editar_obras'] },
  MESTRE: { screens: ['app_obra'], actions: [] },
  // proprietário (dono da obra): só o portal, só das obras liberadas para ele (ver ownerApiAllowed)
  PROPRIETARIO: { screens: [], actions: [] },
}

export function effectivePerms(role: Role, stored: StoredPerms | null | undefined): Perms {
  if (role === 'ADMIN') return { ...ROLE_DEFAULTS.ADMIN, projectIds: null, custom: false, admin: true }
  const def = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.MESTRE
  // proprietário nunca vê "todas as obras": sem obra liberada, não vê nenhuma
  if (role === 'PROPRIETARIO') return { screens: [], actions: [], projectIds: stored?.projectIds ?? [], custom: false, admin: false }
  if (!stored) return { screens: [...def.screens], actions: [...def.actions], projectIds: null, custom: false, admin: false }
  return {
    screens: (stored.screens ?? def.screens).filter((s) => SCREENS.includes(s)),
    actions: (stored.actions ?? def.actions).filter((a) => ACTIONS.includes(a)),
    projectIds: stored.projectIds?.length ? stored.projectIds : null,
    custom: true,
    admin: false,
  }
}

/**
 * Qual tela libera cada grupo de rotas da API (basta ter uma delas).
 * Rotas fora da lista seguem as regras próprias (login, equipe e integrações são só do administrador).
 */
const API_SCREENS: Array<[string, Screen[]]> = [
  ['/api/dashboard', ['dashboard']],
  ['/api/field/', ['app_obra', 'obras']],
  ['/api/stage-templates', ['obras']],
  ['/api/purchase-orders', ['compras']],
  ['/api/material-requests', ['compras']],
  ['/api/suppliers', ['fornecedores', 'compras']],
  ['/api/documents', ['notas', 'obras', 'compras', 'inteligencia', 'pagar']],
  ['/api/payables', ['pagar']],
  ['/api/exports/payables', ['pagar']],
  ['/api/exports/lancamentos', ['relatorios', 'pagar']],
  ['/api/exports/relatorio', ['relatorios']],
  ['/api/exports/notas-contador', ['relatorios', 'notas']],
  ['/api/reports', ['relatorios']],
  ['/api/alerts', ['inteligencia', 'dashboard', 'obras']],
  ['/api/audit', ['notas', 'obras', 'compras']],
  // nomes das obras aparecem em quase todas as telas do escritório
  ['/api/projects', ['dashboard', 'obras', 'orcamentos', 'compras', 'fornecedores', 'notas', 'pagar', 'relatorios', 'inteligencia']],
]

/** true/false se a rota é de alguma tela; null se a rota não é controlada por tela. */
export function apiAllowed(url: string, perms: Perms): boolean | null {
  if (perms.admin) return true
  const path = url.split('?')[0]
  const hit = API_SCREENS.find(([prefix]) => path.startsWith(prefix))
  if (!hit) return null
  return hit[1].some((s) => perms.screens.includes(s))
}

/**
 * Proprietário só chama o portal (/api/owner), login e troca de senha. Qualquer outra rota da API
 * é bloqueada aqui, inclusive as que não pertencem a nenhuma tela.
 */
export function ownerApiAllowed(url: string): boolean {
  const path = url.split('?')[0]
  return path.startsWith('/api/owner/') || path === '/api/auth/me' || path === '/api/auth/password' || path === '/api/auth/logout'
}

export const canProject = (perms: Perms, projectId: string) => !perms.projectIds || perms.projectIds.includes(projectId)
