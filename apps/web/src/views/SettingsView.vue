<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/lib/api'
import { ACTION_INFO, ROLE_DEFAULTS, SCREEN_INFO, type Action, type Perms, type Screen } from '@/lib/permissions'
import { useProjects } from '@/stores/projects'
import { date } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()
const projects = useProjects()

interface User {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA' | 'MESTRE'
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  permissions: Perms
}
const ROLES = [
  { value: 'ADMIN', title: 'Administrador', hint: 'Tudo, inclusive equipe e integrações' },
  { value: 'FINANCEIRO', title: 'Financeiro', hint: 'Aprova notas e registra pagamentos' },
  { value: 'GESTOR_OBRA', title: 'Gestor de obra', hint: 'Cadastra obras e confere notas, sem aprovar' },
  { value: 'MESTRE', title: 'Mestre de obra', hint: 'Só o app de obra: pede material, recebe entrega, fotos e avanço. Não vê valores' },
]
const roleTitle = (r: string) => ROLES.find((x) => x.value === r)?.title ?? r
const team = ref<User[]>([])
const inviteDialog = ref(false)
const invite = ref({ name: '', email: '', role: 'FINANCEIRO' })
const inviting = ref(false)
const created = ref<{ email: string; password: string } | null>(null)

async function loadTeam() {
  try {
    team.value = await api.get<User[]>('/api/users')
  } catch (e) {
    toastError(e)
  }
}
async function updateMember(id: string, patch: { role?: string; active?: boolean }) {
  try {
    await api.patch(`/api/users/${id}`, patch)
    toast('Acesso atualizado')
  } catch (e) {
    toastError(e)
  } finally {
    loadTeam()
  }
}
async function sendInvite() {
  inviting.value = true
  try {
    const res = await api.post<{ user: User; password: string }>('/api/users', invite.value)
    created.value = { email: res.user.email, password: res.password }
    invite.value = { name: '', email: '', role: 'FINANCEIRO' }
    loadTeam()
  } catch (e) {
    toastError(e)
  } finally {
    inviting.value = false
  }
}

onMounted(loadTeam)

// ------------------------------------------------------------ liberações
const permOpen = ref(false)
const permUser = ref<User | null>(null)
const pForm = ref<{ screens: Screen[]; actions: Action[]; allProjects: boolean; projectIds: string[] }>({ screens: [], actions: [], allProjects: true, projectIds: [] })
const savingPerm = ref(false)
function openPerms(u: User) {
  permUser.value = u
  pForm.value = {
    screens: [...u.permissions.screens],
    actions: [...u.permissions.actions],
    allProjects: !u.permissions.projectIds,
    projectIds: [...(u.permissions.projectIds ?? [])],
  }
  permOpen.value = true
  projects.ensure().catch(() => {})
}
const roleDefault = computed(() => (permUser.value ? ROLE_DEFAULTS[permUser.value.role] : null))
const sameAsDefault = computed(() => {
  const d = roleDefault.value
  if (!d) return true
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  return eq(pForm.value.screens, d.screens) && eq(pForm.value.actions, d.actions) && pForm.value.allProjects
})
function toggleScreen(s: Screen, on: boolean) {
  pForm.value.screens = on ? [...new Set([...pForm.value.screens, s])] : pForm.value.screens.filter((x) => x !== s)
  // ação sem a tela correspondente não faz sentido
  if (!on) pForm.value.actions = pForm.value.actions.filter((a) => ACTION_INFO.find((x) => x.key === a)?.screen !== s)
}
function toggleAction(a: Action, on: boolean) {
  pForm.value.actions = on ? [...new Set([...pForm.value.actions, a])] : pForm.value.actions.filter((x) => x !== a)
}
function resetToDefault() {
  const d = roleDefault.value
  if (!d) return
  pForm.value = { screens: [...d.screens], actions: [...d.actions], allProjects: true, projectIds: [] }
}
async function savePerms(thenViewAs = false) {
  if (!permUser.value) return
  savingPerm.value = true
  try {
    const permissions = sameAsDefault.value
      ? null
      : { screens: pForm.value.screens, actions: pForm.value.actions, projectIds: pForm.value.allProjects ? null : pForm.value.projectIds }
    await api.patch(`/api/users/${permUser.value.id}`, { permissions })
    permOpen.value = false
    toast(permissions ? `Liberações de ${permUser.value.name} salvas` : `${permUser.value.name} voltou ao padrão do perfil`)
    await loadTeam()
    if (thenViewAs) await viewAs(permUser.value)
  } catch (e) {
    toastError(e)
  } finally {
    savingPerm.value = false
  }
}
const summary = (u: User) => {
  if (u.role === 'ADMIN') return 'Tudo'
  const n = u.permissions.screens.length
  const obras = u.permissions.projectIds ? ` · ${u.permissions.projectIds.length} obra(s)` : ''
  return `${n} tela(s) · ${u.permissions.actions.length} ação(ões)${obras}`
}

// ------------------------------------------------------------ ver como
const viewing = ref<string | null>(null)
async function viewAs(u: User) {
  viewing.value = u.id
  try {
    await auth.startViewAs(u.id)
    const first = SCREEN_INFO.find((s) => auth.can(s.key))
    router.push(first?.to ?? '/')
  } catch (e) {
    toastError(e)
  } finally {
    viewing.value = null
  }
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copiado')
  } catch {
    toast('Não foi possível copiar', 'warning')
  }
}
</script>

<template>
  <div class="mb-6">
    <div class="page-title">Configurações</div>
    <div class="page-subtitle">Equipe com acesso ao sistema da construtora.</div>
  </div>

  <v-card class="pa-5 mb-4">
    <div class="d-flex align-center justify-space-between mb-3">
      <div class="card-title">Equipe</div>
      <v-btn color="primary" prepend-icon="mdi-account-plus-outline" @click="inviteDialog = true; created = null">Adicionar pessoa</v-btn>
    </div>
    <v-table density="comfortable">
      <thead><tr><th>Pessoa</th><th style="min-width: 215px">Perfil</th><th>Liberações</th><th style="min-width: 150px">Acesso</th><th>Último login</th><th /></tr></thead>
      <tbody>
        <tr v-for="u in team" :key="u.id" :style="u.active ? '' : 'opacity:.55'">
          <td>
            <div class="font-weight-medium">{{ u.name }}<span v-if="u.id === auth.me?.user.id" class="text-caption muted"> (você)</span></div>
            <div class="text-caption muted">{{ u.email }}</div>
          </td>
          <td>
            <v-chip v-if="u.id === auth.me?.user.id" variant="tonal" color="primary">{{ roleTitle(u.role) }}</v-chip>
            <v-select
              v-else
              :id="`team-role-${u.id}`"
              :model-value="u.role"
              :items="ROLES"
              item-title="title"
              item-value="value"
              density="compact"
              @update:model-value="(r: string) => updateMember(u.id, { role: r })"
            />
          </td>
          <td>
            <div class="text-body-2">{{ summary(u) }}</div>
            <v-chip v-if="u.permissions.custom" size="x-small" color="info" variant="tonal">personalizado</v-chip>
            <span v-else class="text-caption muted">padrão do perfil</span>
          </td>
          <td>
            <v-switch
              :id="`team-active-${u.id}`"
              :model-value="u.active"
              :disabled="u.id === auth.me?.user.id"
              color="success"
              density="compact"
              hide-details
              inset
              :label="u.active ? 'Ativo' : 'Desativado'"
              @update:model-value="(v: boolean | null) => updateMember(u.id, { active: !!v })"
            />
          </td>
          <td class="text-no-wrap">{{ u.lastLoginAt ? date(u.lastLoginAt) : 'nunca entrou' }}</td>
          <td class="text-right text-no-wrap">
            <template v-if="u.id !== auth.me?.user.id">
              <v-btn size="small" variant="text" prepend-icon="mdi-shield-key-outline" :disabled="u.role === 'ADMIN'" @click="openPerms(u)">Permissões</v-btn>
              <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-eye-outline" :disabled="!u.active" :loading="viewing === u.id" @click="viewAs(u)">Ver como</v-btn>
            </template>
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-card>

  <div class="text-caption muted mb-4 mt-n2">
    <v-icon size="14">mdi-information-outline</v-icon>
    Cada perfil já vem com um padrão de liberações. Em <b>Permissões</b> você ajusta pessoa a pessoa; em <b>Ver como</b> você confere a tela
    exatamente como ela vê (só leitura). Administrador sempre vê tudo.
  </div>

  <v-dialog v-model="permOpen" max-width="760" scrollable>
    <v-card v-if="permUser">
      <div class="pa-5 pb-2 d-flex align-center ga-2">
        <div class="flex-grow-1">
          <div class="card-title">Permissões de {{ permUser.name }}</div>
          <div class="text-caption muted">Perfil {{ roleTitle(permUser.role) }} · {{ sameAsDefault ? 'igual ao padrão do perfil' : 'personalizado' }}</div>
        </div>
        <v-btn icon="mdi-close" variant="text" aria-label="Fechar" @click="permOpen = false" />
      </div>
      <v-card-text class="pt-2">
        <div class="font-weight-bold mb-1">Telas que vê</div>
        <div class="perm-grid mb-5">
          <label v-for="s in SCREEN_INFO" :key="s.key" class="perm-item" :class="{ on: pForm.screens.includes(s.key) }">
            <v-checkbox-btn :model-value="pForm.screens.includes(s.key)" color="primary" @update:model-value="(v: boolean | null) => toggleScreen(s.key, !!v)" />
            <v-icon size="20" class="mr-2">{{ s.icon }}</v-icon>
            <span>
              <span class="d-block font-weight-medium">{{ s.title }}</span>
              <span class="d-block text-caption muted">{{ s.hint }}</span>
            </span>
          </label>
        </div>

        <div class="font-weight-bold mb-1">O que pode fazer</div>
        <div v-for="a in ACTION_INFO" :key="a.key" class="action-row">
          <v-switch
            :model-value="pForm.actions.includes(a.key)"
            :disabled="!pForm.screens.includes(a.screen)"
            color="primary"
            inset
            hide-details
            density="compact"
            @update:model-value="(v: boolean | null) => toggleAction(a.key, !!v)"
          />
          <div>
            <div class="font-weight-medium">{{ a.title }}</div>
            <div class="text-caption muted">
              {{ a.hint }}<template v-if="!pForm.screens.includes(a.screen)"> · precisa da tela {{ SCREEN_INFO.find((x) => x.key === a.screen)?.title }}</template>
            </div>
          </div>
        </div>

        <div class="font-weight-bold mb-1 mt-5">Obras</div>
        <v-radio-group v-model="pForm.allProjects" inline hide-details class="mb-2">
          <v-radio :value="true" label="Todas as obras" />
          <v-radio :value="false" label="Só estas obras" />
        </v-radio-group>
        <v-autocomplete
          v-if="!pForm.allProjects"
          v-model="pForm.projectIds"
          :items="projects.list"
          item-title="name"
          item-value="id"
          label="Obras liberadas"
          multiple
          chips
          closable-chips
        />
        <div class="text-caption muted">Vale para o sistema todo: obras, notas, compras, contas a pagar, relatórios, alertas e App de obra. Nota ainda sem obra aparece para todos, para ser triada.</div>
      </v-card-text>
      <v-divider />
      <div class="pa-4 d-flex align-center ga-2 flex-wrap">
        <v-btn variant="text" :disabled="sameAsDefault" prepend-icon="mdi-restore" @click="resetToDefault">Padrão do perfil</v-btn>
        <v-spacer />
        <v-btn variant="outlined" :loading="savingPerm" :disabled="!pForm.screens.length || (!pForm.allProjects && !pForm.projectIds.length)" prepend-icon="mdi-eye-outline" @click="savePerms(true)">Salvar e ver como</v-btn>
        <v-btn color="primary" :loading="savingPerm" :disabled="!pForm.screens.length || (!pForm.allProjects && !pForm.projectIds.length)" @click="savePerms()">Salvar</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <v-dialog v-model="inviteDialog" max-width="480">
    <v-card class="pa-5">
      <template v-if="!created">
        <div class="card-title mb-4">Adicionar pessoa</div>
        <v-text-field id="invite-name" v-model="invite.name" label="Nome" class="mb-3" />
        <v-text-field id="invite-email" v-model="invite.email" label="E-mail" type="email" class="mb-3" />
        <v-select id="invite-role" v-model="invite.role" :items="ROLES" item-title="title" item-value="value" label="Perfil">
          <template #item="{ props, item }"><v-list-item v-bind="props" :subtitle="item.raw.hint" /></template>
        </v-select>
        <div class="d-flex justify-end ga-2 mt-5">
          <v-btn variant="text" @click="inviteDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="inviting" :disabled="!invite.name || !invite.email" @click="sendInvite">Criar acesso</v-btn>
        </div>
      </template>
      <template v-else>
        <div class="card-title mb-2">Acesso criado</div>
        <div class="text-body-2 mb-4">Envie para <strong>{{ created.email }}</strong> a senha provisória abaixo, por um canal diferente do e-mail de login. Ela aparece só agora.</div>
        <v-text-field :model-value="created.password" label="Senha provisória" readonly>
          <template #append-inner><v-btn size="small" variant="text" icon="mdi-content-copy" @click="copy(created.password)" /></template>
        </v-text-field>
        <div class="text-caption muted mt-2">No primeiro acesso, a pessoa troca a senha pelo menu do avatar → Trocar senha.</div>
        <div class="d-flex justify-end mt-5"><v-btn color="primary" @click="inviteDialog = false">Pronto</v-btn></div>
      </template>
    </v-card>
  </v-dialog>

  <v-card class="pa-5 d-flex align-center justify-space-between flex-wrap ga-3">
    <div>
      <div class="card-title mb-1">Integrações</div>
      <div class="text-body-2 muted">E-mail de notas, chave de API e sistemas conectados agora ficam em uma tela própria.</div>
    </div>
    <v-btn variant="tonal" color="primary" to="/integracoes" append-icon="mdi-arrow-right">Abrir Integrações</v-btn>
  </v-card>
</template>


<style scoped>
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 8px;
}
.perm-item {
  display: flex;
  align-items: center;
  padding: 6px 10px 6px 2px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  cursor: pointer;
}
.perm-item > span:last-child {
  flex: 1;
  text-align: left;
}
.perm-item.on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(14, 107, 83, 0.05);
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
</style>
