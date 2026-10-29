import { defineStore } from 'pinia'
import { api, getToken, setToken } from '@/lib/api'

interface Me {
  user: { id: string; name: string; email: string; role: 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA' }
  company: { id: string; name: string; cnpj: string }
}

export const useAuth = defineStore('auth', {
  state: () => ({ me: null as Me | null, token: getToken() }),
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
  },
  actions: {
    async login(email: string, password: string) {
      const res = await api.post<Me & { token: string }>('/api/auth/login', { email, password })
      setToken(res.token)
      this.token = res.token
      this.me = { user: res.user, company: res.company }
    },
    async load() {
      if (!this.token || this.me) return
      this.me = await api.get<Me>('/api/auth/me')
    },
    logout() {
      setToken(null)
      this.token = null
      this.me = null
    },
  },
})
