import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import type { ProjectLite } from '@/lib/types'

export const useProjects = defineStore('projects', {
  state: () => ({ list: [] as ProjectLite[], loaded: false }),
  getters: {
    active: (s) => s.list.filter((p) => p.status === 'ATIVA'),
    nameOf: (s) => (id?: string | null) => s.list.find((p) => p.id === id)?.name ?? '—',
  },
  actions: {
    async ensure(force = false) {
      if (this.loaded && !force) return
      this.list = await api.get<ProjectLite[]>('/api/projects')
      this.loaded = true
    },
  },
})
