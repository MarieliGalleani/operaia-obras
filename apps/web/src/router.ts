import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import { DEMO } from './lib/demo'
import { setUnauthorizedHandler } from './lib/api'
import { useAuth } from './stores/auth'
import { SCREEN_INFO, screenOfPath } from './lib/permissions'

const router = createRouter({
  // a demonstração roda dentro de um frame: navegação em memória, sem mexer na URL
  history: DEMO ? createMemoryHistory() : createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: 'Visão Geral' } },
    { path: '/obras', name: 'projects', component: () => import('./views/ProjectsView.vue'), meta: { title: 'Obras' } },
    { path: '/obras/:id', name: 'project', component: () => import('./views/ProjectDetailView.vue'), meta: { title: 'Obra' } },
    { path: '/orcamentos', name: 'budgets', component: () => import('./views/BudgetsView.vue'), meta: { title: 'Orçamentos' } },
    { path: '/campo', name: 'field', component: () => import('./views/FieldHomeView.vue'), meta: { title: 'App de obra' } },
    { path: '/campo/:id', name: 'field-project', component: () => import('./views/FieldProjectView.vue'), meta: { title: 'App de obra' } },
    { path: '/compras', name: 'purchases', component: () => import('./views/PurchasesView.vue'), meta: { title: 'Compras' } },
    { path: '/notas', name: 'documents', component: () => import('./views/DocumentsView.vue'), meta: { title: 'Notas Fiscais' } },
    { path: '/contas-a-pagar', name: 'payables', component: () => import('./views/PayablesView.vue'), meta: { title: 'Contas a Pagar' } },
    { path: '/fornecedores', name: 'suppliers', component: () => import('./views/SuppliersView.vue'), meta: { title: 'Fornecedores' } },
    { path: '/relatorios', name: 'reports', component: () => import('./views/ReportsView.vue'), meta: { title: 'Relatórios' } },
    { path: '/inteligencia', name: 'alerts', component: () => import('./views/AlertsView.vue'), meta: { title: 'Inteligência' } },
    { path: '/configuracoes', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: 'Configurações' } },
    { path: '/integracoes', name: 'integrations', component: () => import('./views/IntegrationsView.vue'), meta: { title: 'Integrações' } },
    { path: '/plataforma', name: 'platform', component: () => import('./views/PlatformView.vue'), meta: { title: 'Plataforma', owner: true } },
    { path: '/plataforma/:id', name: 'platform-company', component: () => import('./views/PlatformCompanyView.vue'), meta: { title: 'Plataforma', owner: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  if (to.meta.public) return true
  if (!auth.isLogged) return { name: 'login', query: { next: to.fullPath } }
  try {
    await auth.load()
  } catch {
    auth.logout()
    return { name: 'login' }
  }
  if (to.meta.owner && (!auth.isPlatformOwner || auth.impersonating)) return { name: 'dashboard' }
  // admin-only: integrações e configurações
  if ((to.path.startsWith('/integracoes') || to.path.startsWith('/configuracoes')) && !auth.isAdmin) return firstAllowed()
  // telas liberadas pelo administrador
  const screen = screenOfPath(to.path)
  if (screen && !auth.can(screen)) return firstAllowed()
  return true
})

/** primeira tela liberada para a pessoa (ex.: mestre cai direto no app de obra) */
function firstAllowed() {
  const auth = useAuth()
  const s = SCREEN_INFO.find((x) => auth.can(x.key))
  return s ? s.to : { name: 'login' }
}

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · OperaIA Obras` : 'OperaIA Obras'
})

setUnauthorizedHandler(() => {
  const auth = useAuth()
  // "ver como" expirou: volta ao acesso do administrador em vez de deslogar
  if (auth.viewingAs) {
    void auth.exitViewAs().then(() => router.push('/configuracoes'))
    return
  }
  auth.logout()
  if (router.currentRoute.value.name !== 'login') router.push({ name: 'login' })
})

export default router
