<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import { api } from '@/lib/api'
import { brl, cnpj, date } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'
import type { CompanyUsage } from './PlatformView.vue'

type Role = 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA'
interface Detail extends CompanyUsage {
  apiKey: string
  users: { id: string; name: string; email: string; role: Role; active: boolean; isPlatformOwner: boolean; lastLoginAt: string | null; createdAt: string }[]
  history: { id: string; entity: string; action: string; createdAt: string; userName: string | null }[]
}

const ROLES = [
  { value: 'ADMIN', title: 'Administrador' },
  { value: 'FINANCEIRO', title: 'Financeiro' },
  { value: 'GESTOR_OBRA', title: 'Gestor de obra' },
]
const ACTIONS: Record<string, string> = {
  'user:created': 'Acesso de pessoa criado',
  created: 'Construtora criada',
  created_by_platform: 'Construtora criada pela plataforma',
  suspended: 'Construtora suspensa',
  reactivated: 'Construtora reativada',
  updated: 'Dados atualizados',
  api_key_rotated: 'Chave de integração trocada',
  support_session_started: 'Sessão de suporte iniciada',
  password_changed: 'Senha trocada pela pessoa',
  password_reset: 'Senha resetada (linha de comando)',
  password_reset_by_platform: 'Senha resetada pela plataforma',
  updated_by_platform: 'Acesso alterado pela plataforma',
}

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const data = ref<Detail | null>(null)
const notes = ref('')
const revealKey = ref(false)
const secret = ref<{ title: string; text: string } | null>(null)

async function load() {
  try {
    data.value = await api.get<Detail>(`/api/platform/companies/${route.params.id}`)
    notes.value = data.value.notes ?? ''
  } catch (e) {
    toastError(e)
    router.replace('/plataforma')
  }
}
onMounted(load)

const isOwnCompany = computed(() => data.value?.users.some((u) => u.id === auth.me?.user.id))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copiado')
  } catch {
    toast('Não foi possível copiar; selecione o texto e copie manualmente.', 'warning')
  }
}

// ---- situação
const statusDialog = ref(false)
async function toggleStatus() {
  if (!data.value) return
  try {
    await api.patch(`/api/platform/companies/${data.value.id}`, { status: data.value.status === 'ATIVA' ? 'SUSPENSA' : 'ATIVA' })
    statusDialog.value = false
    toast(data.value.status === 'ATIVA' ? 'Construtora suspensa' : 'Construtora reativada')
    load()
  } catch (e) {
    toastError(e)
  }
}
async function saveNotes() {
  try {
    await api.patch(`/api/platform/companies/${data.value!.id}`, { notes: notes.value || null })
    toast('Anotações salvas')
  } catch (e) {
    toastError(e)
  }
}
async function enter() {
  try {
    await auth.enterCompany(data.value!.id)
    router.push('/')
  } catch (e) {
    toastError(e)
  }
}

// ---- equipe
async function updateUser(id: string, patch: { role?: Role; active?: boolean }) {
  try {
    await api.patch(`/api/platform/users/${id}`, patch)
    toast('Acesso atualizado')
    load()
  } catch (e) {
    toastError(e)
    load()
  }
}
async function resetPassword(u: Detail['users'][number]) {
  try {
    const res = await api.post<{ email: string; password: string }>(`/api/platform/users/${u.id}/reset-password`)
    secret.value = { title: `Nova senha provisória de ${u.name}`, text: res.password }
  } catch (e) {
    toastError(e)
  }
}
const addDialog = ref(false)
const newUser = ref({ name: '', email: '', role: 'FINANCEIRO' as Role })
async function addUser() {
  try {
    const res = await api.post<{ user: { name: string }; password: string }>(`/api/platform/companies/${data.value!.id}/users`, newUser.value)
    addDialog.value = false
    secret.value = { title: `Senha provisória de ${res.user.name}`, text: res.password }
    newUser.value = { name: '', email: '', role: 'FINANCEIRO' }
    load()
  } catch (e) {
    toastError(e)
  }
}

// ---- integração
const rotateDialog = ref(false)
async function rotateKey() {
  try {
    const res = await api.post<{ apiKey: string }>(`/api/platform/companies/${data.value!.id}/rotate-key`)
    data.value!.apiKey = res.apiKey
    revealKey.value = true
    rotateDialog.value = false
    toast('Chave trocada. Atualize onde a antiga era usada.')
  } catch (e) {
    toastError(e)
  }
}
</script>

<template>
  <div v-if="!data" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
  <template v-else>
    <div class="d-flex align-start ga-3 mb-6 flex-wrap">
      <v-btn icon="mdi-arrow-left" variant="text" to="/plataforma" aria-label="Voltar à plataforma" />
      <div class="flex-grow-1">
        <div class="text-caption muted">{{ cnpj(data.cnpj) }} · desde {{ date(data.createdAt) }}</div>
        <div class="page-title d-flex align-center ga-2 flex-wrap">
          {{ data.name }}
          <v-chip :color="data.status === 'ATIVA' ? 'success' : 'grey'" variant="tonal">{{ data.status === 'ATIVA' ? 'Ativa' : 'Suspensa' }}</v-chip>
          <v-chip v-if="isOwnCompany" variant="tonal" color="primary">sua construtora</v-chip>
        </div>
      </div>
      <div class="d-flex ga-2 flex-wrap">
        <v-btn v-if="!isOwnCompany" color="primary" prepend-icon="mdi-login-variant" @click="enter">Entrar como</v-btn>
        <v-btn
          v-if="!isOwnCompany"
          variant="outlined"
          :color="data.status === 'ATIVA' ? 'error' : 'success'"
          :prepend-icon="data.status === 'ATIVA' ? 'mdi-pause-circle-outline' : 'mdi-play-circle-outline'"
          @click="statusDialog = true"
        >
          {{ data.status === 'ATIVA' ? 'Suspender' : 'Reativar' }}
        </v-btn>
      </div>
    </div>

    <v-row dense class="mb-2">
      <v-col cols="6" md="3"><KpiCard label="Pessoas com acesso" :value="String(data.usersActive)" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="Obras ativas" :value="String(data.projectsActive)" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="Notas (30 dias / total)" :value="`${data.documents30d} / ${data.documentsTotal}`" :hint="data.documentsPending ? `${data.documentsPending} aguardando conferência` : undefined" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="Aprovado (30 dias)" :value="brl(data.approved30d, { compact: true })" :hint="data.lastDocumentAt ? `última nota em ${date(data.lastDocumentAt)}` : 'nenhuma nota ainda'" /></v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" lg="8">
        <v-card class="pa-5 mb-3">
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="card-title">Equipe</div>
            <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-account-plus-outline" @click="addDialog = true">Adicionar pessoa</v-btn>
          </div>
          <div class="table-scroll">
            <v-table density="comfortable">
              <thead>
                <tr><th>Pessoa</th><th style="min-width: 215px">Perfil</th><th style="min-width: 150px">Acesso</th><th>Último login</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="u in data.users" :key="u.id" :class="{ inactive: !u.active }">
                  <td>
                    <div class="font-weight-medium">{{ u.name }} <v-chip v-if="u.isPlatformOwner" size="x-small" color="primary" variant="tonal">dona</v-chip></div>
                    <div class="text-caption muted">{{ u.email }}</div>
                  </td>
                  <td>
                    <v-select
                      :id="`role-${u.id}`"
                      :model-value="u.role"
                      :items="ROLES"
                      density="compact"
                      :disabled="u.isPlatformOwner"
                      @update:model-value="(r: Role) => updateUser(u.id, { role: r })"
                    />
                  </td>
                  <td>
                    <v-switch
                      :id="`active-${u.id}`"
                      :model-value="u.active"
                      color="success"
                      density="compact"
                      hide-details
                      inset
                      :disabled="u.isPlatformOwner"
                      :label="u.active ? 'Ativo' : 'Desativado'"
                      @update:model-value="(v: boolean | null) => updateUser(u.id, { active: !!v })"
                    />
                  </td>
                  <td class="text-no-wrap">{{ u.lastLoginAt ? date(u.lastLoginAt) : 'nunca entrou' }}</td>
                  <td class="text-right">
                    <v-tooltip text="Resetar senha" location="left">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" size="small" variant="text" icon="mdi-lock-reset" aria-label="Resetar senha" @click="resetPassword(u)" />
                      </template>
                    </v-tooltip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </v-card>

        <v-card class="pa-5 mb-3">
          <div class="card-title mb-1">Chave de integração</div>
          <div class="text-body-2 muted mb-3">Usada para a construtora enviar notas automaticamente (n8n ou outro sistema).</div>
          <v-text-field id="company-api-key" :model-value="revealKey ? data.apiKey : '•'.repeat(28)" readonly style="max-width: 560px">
            <template #append-inner>
              <v-btn size="small" variant="text" :icon="revealKey ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" :aria-label="revealKey ? 'Ocultar chave' : 'Mostrar chave'" @click="revealKey = !revealKey" />
              <v-btn size="small" variant="text" icon="mdi-content-copy" aria-label="Copiar chave" @click="copy(data.apiKey)" />
            </template>
          </v-text-field>
          <v-btn class="mt-3" size="small" variant="text" color="error" prepend-icon="mdi-key-change" @click="rotateDialog = true">Trocar chave</v-btn>
        </v-card>
      </v-col>

      <v-col cols="12" lg="4">
        <v-card class="pa-5 mb-3">
          <div class="card-title mb-1">Anotações internas</div>
          <div class="text-caption muted mb-3">Só você vê. Plano, condições do piloto, contatos.</div>
          <v-textarea id="company-notes" v-model="notes" rows="5" auto-grow />
          <v-btn class="mt-3" size="small" color="primary" variant="tonal" :disabled="notes === (data.notes ?? '')" @click="saveNotes">Salvar anotações</v-btn>
        </v-card>

        <v-card class="pa-5">
          <div class="card-title mb-3">Histórico de acessos</div>
          <div v-for="h in data.history" :key="h.id" class="history-row">
            <div class="text-body-2">{{ ACTIONS[`${h.entity}:${h.action}`] ?? ACTIONS[h.action] ?? h.action }}</div>
            <div class="text-caption muted">{{ date(h.createdAt) }}{{ h.userName ? ` · ${h.userName}` : '' }}</div>
          </div>
          <div v-if="!data.history.length" class="text-body-2 muted">Sem registros.</div>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="statusDialog" max-width="460">
      <v-card class="pa-5">
        <template v-if="data.status === 'ATIVA'">
          <div class="card-title mb-2">Suspender {{ data.name }}?</div>
          <div class="text-body-2 mb-4">
            Ninguém da construtora consegue entrar e as notas por integração são recusadas, a partir de agora. Os dados ficam guardados e voltam ao reativar.
          </div>
        </template>
        <template v-else>
          <div class="card-title mb-2">Reativar {{ data.name }}?</div>
          <div class="text-body-2 mb-4">A equipe volta a entrar normalmente, com todos os dados como estavam.</div>
        </template>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="statusDialog = false">Cancelar</v-btn>
          <v-btn :color="data.status === 'ATIVA' ? 'error' : 'success'" @click="toggleStatus">{{ data.status === 'ATIVA' ? 'Suspender' : 'Reativar' }}</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rotateDialog" max-width="460">
      <v-card class="pa-5">
        <div class="card-title mb-2">Trocar a chave de integração?</div>
        <div class="text-body-2 mb-4">A chave atual para de funcionar na hora. Use se ela vazou ou se a construtora trocou de sistema.</div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="rotateDialog = false">Cancelar</v-btn>
          <v-btn color="error" @click="rotateKey">Trocar chave</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="addDialog" max-width="460">
      <v-card class="pa-5">
        <div class="card-title mb-4">Adicionar pessoa em {{ data.name }}</div>
        <v-text-field id="add-user-name" v-model="newUser.name" label="Nome" class="mb-3" />
        <v-text-field id="add-user-email" v-model="newUser.email" label="E-mail" type="email" class="mb-3" />
        <v-select id="add-user-role" v-model="newUser.role" :items="ROLES" label="Perfil" />
        <div class="d-flex justify-end ga-2 mt-5">
          <v-btn variant="text" @click="addDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :disabled="!newUser.name || !newUser.email" @click="addUser">Criar acesso</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!secret" max-width="440" @update:model-value="secret = null">
      <v-card v-if="secret" class="pa-5">
        <div class="card-title mb-2">{{ secret.title }}</div>
        <div class="text-body-2 mb-3">Envie por WhatsApp ou ligação. Ela aparece só agora.</div>
        <v-text-field id="secret-value" :model-value="secret.text" readonly>
          <template #append-inner><v-btn size="small" variant="text" icon="mdi-content-copy" aria-label="Copiar" @click="copy(secret.text)" /></template>
        </v-text-field>
        <div class="d-flex justify-end mt-4"><v-btn color="primary" @click="secret = null">Pronto</v-btn></div>
      </v-card>
    </v-dialog>
  </template>
</template>

<style scoped>
.table-scroll :deep(.v-switch .v-label) {
  white-space: nowrap;
}
.table-scroll {
  overflow-x: auto;
}
.inactive td {
  opacity: 0.55;
}
.history-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--oo-border);
}
.history-row:last-child {
  border-bottom: 0;
}
</style>
