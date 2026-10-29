import { createRouter, createWebHistory } from 'vue-router'
import { setUnauthorizedHandler } from './lib/api'
import { useAuth } from './stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: 'Visão Geral' } },
    { path: '/obras', name: 'projects', component: () => import('./views/ProjectsView.vue'), meta: { title: 'Obras' } },
    { path: '/obras/:id', name: 'project', component: () => import('./views/ProjectDetailView.vue'), meta: { title: 'Obra' } },
    { path: '/notas', name: 'documents', component: () => import('./views/DocumentsView.vue'), meta: { title: 'Notas Fiscais' } },
    { path: '/contas-a-pagar', name: 'payables', component: () => import('./views/PayablesView.vue'), meta: { title: 'Contas a Pagar' } },
    { path: '/fornecedores', name: 'suppliers', component: () => import('./views/SuppliersView.vue'), meta: { title: 'Fornecedores' } },
    { path: '/inteligencia', name: 'alerts', component: () => import('./views/AlertsView.vue'), meta: { title: 'Inteligência' } },
    { path: '/integracoes', name: 'integrations', component: () => import('./views/IntegrationsView.vue'), meta: { title: 'Integrações' } },
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
