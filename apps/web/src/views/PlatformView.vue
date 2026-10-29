<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import { api } from '@/lib/api'
import { brl, cnpj, date } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

export interface CompanyUsage {
  id: string
  name: string
  cnpj: string
  status: 'ATIVA' | 'SUSPENSA'
  notes: string | null
  createdAt: string
  usersActive: number
  projectsActive: number
  documentsTotal: number
  documents30d: number
  documentsPending: number
  approved30d: number
  lastDocumentAt: string | null
  lastLoginAt: string | null
}
interface Overview {
  companiesActive: number
  companiesSuspended: number
  usersActive: number
  documents30d: number
  approved30d: number
  companies: CompanyUsage[]
}

const router = useRouter()
const auth = useAuth()
const data = ref<Overview | null>(null)
const filter = ref<'todas' | 'ATIVA' | 'SUSPENSA'>('todas')
const q = ref('')

async function load() {
  try {
    data.value = await api.get<Overview>('/api/platform/overview')
  } catch (e) {
    toastError(e)
  }
}
onMounted(load)

const rows = computed(() =>
  (data.value?.companies ?? []).filter(
    (c) =>
      (filter.value === 'todas' || c.status === filter.value) &&
      (!q.value || c.name.toLowerCase().includes(q.value.toLowerCase()) || c.cnpj.includes(q.value.replace(/\D/g, ''))),
  ),
)

const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
function health(c: CompanyUsage) {
  if (c.status === 'SUSPENSA') return { color: 'grey', text: 'Suspensa' }
  const d = daysSince(c.lastDocumentAt ?? c.lastLoginAt)
  if (d === null) return { color: 'info', text: 'Implantando' }
  if (d > 14) return { color: 'warning', text: `Parada há ${d} dias` }
  return { color: 'success', text: 'Em uso' }
}

// ---- nova construtora
const dialog = ref(false)
const saving = ref(false)
const form = ref({ name: '', cnpj: '', adminName: '', adminEmail: '', notes: '' })
const created = ref<{ company: { id: string; name: string; apiKey: string }; admin: { email: string; name: string }; password: string } | null>(null)

function openNew() {
  form.value = { name: '', cnpj: '', adminName: '', adminEmail: '', notes: '' }
  created.value = null
  dialog.value = true
}
async function create() {
  saving.value = true
  try {
    created.value = await api.post('/api/platform/companies', { ...form.value, notes: form.value.notes || undefined })
    load()
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
const welcome = computed(() =>
  created.value
    ? `Olá, ${created.value.admin.name.split(' ')[0]}! Seu acesso ao OperaIA Obras está pronto.\n\nEndereço: ${window.location.origin}\nE-mail: ${created.value.admin.email}\nSenha provisória: ${created.value.password}\n\nNo primeiro acesso, troque a senha em: avatar (canto superior direito) → Trocar senha.`
    : '',
)
async function copy(text: string, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text)
    toast(label)
  } catch {
    toast('Não foi possível copiar; selecione o texto e copie manualmente.', 'warning')
  }
}

const entering = ref<string | null>(null)
async function enter(c: CompanyUsage) {
  entering.value = c.id
  try {
    await auth.enterCompany(c.id)
    router.push('/')
  } catch (e) {
    toastError(e)
  } finally {
    entering.value = null
  }
}
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="text-overline muted" style="letter-spacing: 0.08em">Área da dona</div>
      <div class="page-title">Plataforma</div>
      <div class="page-subtitle">Construtoras, acessos e uso do OperaIA Obras. Só você vê esta área.</div>
    </div>
    <v-btn color="primary" prepend-icon="mdi-domain-plus" @click="openNew">Nova construtora</v-btn>
  </div>

  <v-row v-if="data" dense class="mb-2">
    <v-col cols="6" md><KpiCard label="Construtoras ativas" :value="String(data.companiesActive)" :hint="data.companiesSuspended ? `${data.companiesSuspended} suspensa(s)` : undefined" /></v-col>
    <v-col cols="6" md><KpiCard label="Pessoas com acesso" :value="String(data.usersActive)" /></v-col>
    <v-col cols="6" md><KpiCard label="Notas recebidas (30 dias)" :value="data.documents30d.toLocaleString('pt-BR')" /></v-col>
    <v-col cols="6" md><KpiCard label="Volume aprovado (30 dias)" :value="brl(data.approved30d, { compact: true })" /></v-col>
  </v-row>

  <v-card>
    <div class="d-flex align-center flex-wrap ga-3 pa-4">
      <v-btn-toggle v-model="filter" mandatory color="primary" variant="outlined" density="comfortable" divided>
        <v-btn value="todas">Todas</v-btn>
        <v-btn value="ATIVA">Ativas</v-btn>
        <v-btn value="SUSPENSA">Suspensas</v-btn>
      </v-btn-toggle>
      <v-spacer />
      <v-text-field id="platform-search" v-model="q" placeholder="Nome ou CNPJ" prepend-inner-icon="mdi-magnify" style="max-width: 280px" clearable />
    </div>
    <v-table density="comfortable" class="clickable-rows">
      <thead>
        <tr>
          <th>Construtora</th>
          <th>Situação</th>
          <th class="text-right">Pessoas</th>
          <th class="text-right">Obras</th>
          <th class="text-right">Notas 30d</th>
          <th class="text-right">A conferir</th>
          <th>Último acesso</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in rows" :key="c.id" @click="router.push({ name: 'platform-company', params: { id: c.id } })">
          <td>
            <div class="font-weight-medium">{{ c.name }}</div>
            <div class="text-caption muted">{{ cnpj(c.cnpj) }} · desde {{ date(c.createdAt) }}</div>
          </td>
          <td><v-chip :color="health(c).color" variant="tonal">{{ health(c).text }}</v-chip></td>
          <td class="text-right">{{ c.usersActive }}</td>
          <td class="text-right">{{ c.projectsActive }}</td>
          <td class="text-right">{{ c.documents30d }}</td>
          <td class="text-right" :class="c.documentsPending > 10 ? 'text-warning font-weight-bold' : ''">{{ c.documentsPending }}</td>
          <td>{{ c.lastLoginAt ? date(c.lastLoginAt) : 'nunca' }}</td>
          <td class="text-right" @click.stop>
            <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-login-variant" :loading="entering === c.id" @click="enter(c)">Entrar como</v-btn>
          </td>
        </tr>
        <tr v-if="data && !rows.length">
          <td colspan="8" class="text-center muted py-6">Nenhuma construtora neste filtro.</td>
        </tr>
      </tbody>
    </v-table>
  </v-card>

  <v-dialog v-model="dialog" max-width="520" scrollable>
    <v-card class="pa-5">
      <template v-if="!created">
        <div class="card-title mb-1">Nova construtora</div>
        <div class="text-body-2 muted mb-4">Cria a construtora e o primeiro administrador. Depois ele mesmo convida a equipe.</div>
        <v-text-field id="new-company-name" v-model="form.name" label="Razão social ou nome" class="mb-3" />
        <v-text-field id="new-company-cnpj" v-model="form.cnpj" label="CNPJ" class="mb-3" />
        <v-row dense>
          <v-col cols="12" sm="6"><v-text-field id="new-admin-name" v-model="form.adminName" label="Nome do responsável" /></v-col>
          <v-col cols="12" sm="6"><v-text-field id="new-admin-email" v-model="form.adminEmail" label="E-mail do responsável" type="email" /></v-col>
        </v-row>
        <v-textarea id="new-company-notes" v-model="form.notes" label="Anotações internas (opcional)" rows="2" class="mt-3" hint="Ex.: piloto de 60 dias, R$ 399/mês, contato no WhatsApp" persistent-hint />
        <div class="d-flex justify-end ga-2 mt-5">
          <v-btn variant="text" @click="dialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!form.name || !form.cnpj || !form.adminName || !form.adminEmail" @click="create">Criar construtora</v-btn>
        </div>
      </template>
      <template v-else>
        <div class="d-flex align-center ga-2 mb-2">
          <v-icon color="success">mdi-check-circle</v-icon>
          <div class="card-title">{{ created.company.name }} criada</div>
        </div>
        <div class="text-body-2 mb-3">Envie a mensagem abaixo para o responsável pelo WhatsApp. A senha provisória aparece só agora.</div>
        <v-textarea id="welcome-message" :model-value="welcome" readonly rows="7" class="mb-2" />
        <v-btn block color="primary" variant="tonal" prepend-icon="mdi-content-copy" class="mb-4" @click="copy(welcome, 'Mensagem copiada')">Copiar mensagem</v-btn>
        <div class="text-caption muted">
          A chave de integração e a configuração do e-mail de notas ficam na página da construtora.
        </div>
        <div class="d-flex justify-end ga-2 mt-5">
          <v-btn variant="text" @click="dialog = false">Fechar</v-btn>
          <v-btn color="primary" @click="router.push({ name: 'platform-company', params: { id: created.company.id } })">Abrir construtora</v-btn>
        </div>
      </template>
    </v-card>
  </v-dialog>
</template>
