import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import { DEMO } from './lib/demo'
import { setUnauthorizedHandler } from './lib/api'
import { useAuth } from './stores/auth'

const router = createRouter({
  // a demonstração roda dentro de um frame: navegação em memória, sem mexer na URL
  history: DEMO ? createMemoryHistory() : createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: 'Visão Geral' } },
    { path: '/obras', name: 'projects', component: () => import('./views/ProjectsView.vue'), meta: { title: 'Obras' } },
    { path: '/obras/:id', name: 'project', component: () => import('./views/ProjectDetailView.vue'), meta: { title: 'Obra' } },
    { path: '/orcamentos', name: 'budgets', component: () => import('./views/BudgetsView.vue'), meta: { title: 'Orçamentos' } },
    { path: '/notas', name: 'documents', component: () => import('./views/DocumentsView.vue'), meta: { title: 'Notas Fiscais' } },
    { path: '/contas-a-pagar', name: 'payables', component: () => import('./views/PayablesView.vue'), meta: { title: 'Contas a Pagar' } },
    { path: '/fornecedores', name: 'suppliers', component: () => import('./views/SuppliersView.vue'), meta: { title: 'Fornecedores' } },
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
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · OperaIA Obras` : 'OperaIA Obras'
})

setUnauthorizedHandler(() => {
  useAuth().logout()
  if (router.currentRoute.value.name !== 'login') router.push({ name: 'login' })
})

export default router
