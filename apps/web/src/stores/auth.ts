import { defineStore } from 'pinia'
import { api, getToken, setToken } from '@/lib/api'
import { DEMO } from '@/lib/demo'

interface Me {
  user: { id: string; name: string; email: string; role: 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA'; isPlatformOwner?: boolean }
  company: { id: string; name: string; cnpj: string; status?: string }
  impersonating?: boolean
}

export const useAuth = defineStore('auth', {
  state: () => ({ me: null as Me | null, token: DEMO ? 'demo' : getToken() }),
  getters: {
    isLogged: (s) => !!s.token,
    initials: (s) =>
      (s.me?.user.name ?? '?')
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase(),
    canApprove: (s) => ['ADMIN', 'FINANCEIRO'].includes(s.me?.user.role ?? ''),
    isPlatformOwner: (s) => !!s.me?.user.isPlatformOwner,
    impersonating: (s) => !!s.me?.impersonating,
  },
  actions: {
    async login(email: string, password: string) {
      const res = await api.post<Me & { token: string }>('/api/auth/login', { email, password })
      setToken(res.token)
      this.token = res.token
      this.me = { user: res.user, company: res.company, impersonating: false }
    },
    async load(force = false) {
      if (!this.token || (this.me && !force)) return
      this.me = await api.get<Me>('/api/auth/me')
    },
    /** Dona da plataforma: entra numa construtora para dar suporte */
    async enterCompany(companyId: string) {
      const { token } = await api.post<{ token: string }>(`/api/platform/companies/${companyId}/impersonate`)
      setToken(token)
      this.token = token
      await this.load(true)
    },
    async returnToPlatform() {
      const { token } = await api.post<{ token: string }>('/api/platform/return')
      setToken(token)
      this.token = token
      await this.load(true)
    },
    logout() {
      setToken(null)
      this.token = null
      this.me = null
    },
  },
})
