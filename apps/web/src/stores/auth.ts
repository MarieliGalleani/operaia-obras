import { defineStore } from 'pinia'
import { ApiError, api, getToken, setToken } from '@/lib/api'
import { DEMO } from '@/lib/demo'
import { clearOfflineCache, setOfflineUser } from '@/lib/offline'
import { ROLE_DEFAULTS, type Action, type Perms, type Screen } from '@/lib/permissions'

/** token do administrador guardado enquanto ele usa "ver como" */
const BACK_KEY = 'operaia-obras:token-back'
const getBack = () => {
  try {
    return localStorage.getItem(BACK_KEY)
  } catch {
    return null
  }
}
const setBack = (t: string | null) => {
  try {
    if (t) localStorage.setItem(BACK_KEY, t)
    else localStorage.removeItem(BACK_KEY)
  } catch {
    /* navegação privada */
  }
}

const ME_KEY = 'operaia-obras:me'
const readMe = (): Me | null => {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null')
  } catch {
    return null
  }
}
const writeMe = (me: Me | null) => {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me))
    else localStorage.removeItem(ME_KEY)
  } catch {
    /* navegação privada */
  }
}

interface Me {
  user: { id: string; name: string; email: string; role: 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA' | 'MESTRE'; isPlatformOwner?: boolean }
  company: { id: string; name: string; cnpj: string; status?: string }
  impersonating?: boolean
  permissions?: Perms
  /** "ver como": o administrador está vendo o sistema como esta pessoa (só leitura) */
  viewAs?: { byName: string } | null
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
    /** liberações efetivas (vindas da API; sem elas, o padrão do perfil) */
    perms(s): Perms {
      if (s.me?.permissions) return s.me.permissions
      const role = s.me?.user.role ?? 'MESTRE'
      return { ...ROLE_DEFAULTS[role], projectIds: null, custom: false, admin: role === 'ADMIN' }
    },
    can(): (screen: Screen) => boolean {
      return (screen) => this.perms.admin || this.perms.screens.includes(screen)
    },
    canDo(): (action: Action) => boolean {
      return (action) => this.perms.admin || this.perms.actions.includes(action)
    },
    canApprove(): boolean {
      return this.canDo('aprovar_notas')
    },
    isAdmin: (s) => s.me?.user.role === 'ADMIN',
    viewingAs: (s) => !!s.me?.viewAs,
    isPlatformOwner: (s) => !!s.me?.user.isPlatformOwner,
    isMestre: (s) => s.me?.user.role === 'MESTRE',
    impersonating: (s) => !!s.me?.impersonating,
  },
  actions: {
    async login(email: string, password: string) {
      const res = await api.post<Me & { token: string }>('/api/auth/login', { email, password })
      setToken(res.token)
      this.token = res.token
      this.me = { user: res.user, company: res.company, impersonating: false }
      writeMe(this.me)
      setOfflineUser(this.me.user.id)
      await this.load(true).catch(() => {})
    },
    /** Administrador: ver o sistema como esta pessoa (só leitura, até 1 hora). */
    async startViewAs(userId: string) {
      const { token } = await api.post<{ token: string }>(`/api/users/${userId}/view-as`)
      setBack(this.token)
      setToken(token)
      this.token = token
      await this.load(true)
    },
    /** Volta ao acesso do administrador. */
    async exitViewAs() {
      const back = getBack()
      setBack(null)
      setToken(back)
      this.token = back
      this.me = null
      if (back) await this.load(true)
    },
    async load(force = false) {
      if (!this.token || (this.me && !force)) return
      try {
        this.me = await api.get<Me>('/api/auth/me')
        writeMe(this.me)
      } catch (e) {
        // sem internet: segue com a última identidade conhecida (o app de obra funciona com a fila)
        const cached = readMe()
        if (e instanceof ApiError && e.status === 0 && cached) this.me = cached
        else throw e
      }
      setOfflineUser(this.me.user.id)
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
      setBack(null)
      setToken(null)
      this.token = null
      this.me = null
      writeMe(null)
      setOfflineUser(null)
      void clearOfflineCache()
    },
  },
})
