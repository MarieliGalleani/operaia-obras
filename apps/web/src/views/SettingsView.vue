<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/lib/api'
import MailInboxCard from '@/components/MailInboxCard.vue'
import { date } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

const auth = useAuth()

interface User {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA'
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}
const ROLES = [
  { value: 'ADMIN', title: 'Administrador', hint: 'Tudo, inclusive equipe e integrações' },
  { value: 'FINANCEIRO', title: 'Financeiro', hint: 'Aprova notas e registra pagamentos' },
  { value: 'GESTOR_OBRA', title: 'Gestor de obra', hint: 'Cadastra obras e confere notas, sem aprovar' },
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

const info = ref<{ apiKey: string; nfeEndpoint: string } | null>(null)
const reveal = ref(false)
onMounted(async () => {
  loadTeam()
  try {
    info.value = await api.get('/api/integrations')
  } catch (e) {
    toastError(e)
  }
})
const base = computed(() => `${window.location.origin}${info.value?.nfeEndpoint ?? ''}`)
const curl = computed(
  () => `curl -X POST ${base.value} \\
  -H "x-api-key: ${reveal.value ? info.value?.apiKey : '••••••••'}" \\
  -H "x-source: email" \\
  -H "Content-Type: application/xml" \\
  --data-binary @nota.xml`,
)
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copiado')
  } catch {
    toast('Não foi possível copiar', 'warning')
  }
}

const planned = [
  { name: 'E-mail de notas', desc: 'O sistema lê a caixa de notas e importa os XMLs sozinho (acima).', status: 'Disponível', color: 'success' },
  { name: 'Planilha / CSV', desc: 'Exporte lançamentos por obra (Visão Geral) e contas a pagar para o financeiro e a contabilidade.', status: 'Disponível', color: 'success' },
  { name: 'Sienge · TOTVS · Conta Azul', desc: 'Sincronizar obras, fornecedores e títulos com o ERP existente.', status: 'Planejado', color: 'grey' },
  { name: 'Google Drive', desc: 'Arquivar XML e PDF por obra e mês.', status: 'Planejado', color: 'grey' },
  { name: 'WhatsApp', desc: 'Notificar alertas críticos e receber fotos de comprovantes do canteiro.', status: 'Planejado', color: 'grey' },
]
</script>

<template>
  <div class="mb-6">
    <div class="page-title">Configurações</div>
    <div class="page-subtitle">Equipe com acesso e integrações da construtora.</div>
  </div>

  <v-card class="pa-5 mb-4">
    <div class="d-flex align-center justify-space-between mb-3">
      <div class="card-title">Equipe</div>
      <v-btn color="primary" prepend-icon="mdi-account-plus-outline" @click="inviteDialog = true; created = null">Adicionar pessoa</v-btn>
    </div>
    <v-table density="comfortable">
      <thead><tr><th>Pessoa</th><th style="min-width: 215px">Perfil</th><th style="min-width: 150px">Acesso</th><th>Último login</th></tr></thead>
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
        </tr>
      </tbody>
    </v-table>
  </v-card>

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

  <MailInboxCard base="/api/mail-inbox" class="mb-4" />

  <v-card class="pa-5 mb-4">
    <div class="card-title mb-1">Integração por API (avançado)</div>
    <div class="text-body-2 muted mb-4">
      Para enviar notas a partir de outro sistema ou automatizador (n8n, ERP). Reenvios da mesma nota são ignorados.
    </div>
    <v-text-field :model-value="reveal ? info?.apiKey : '•'.repeat(24)" label="Chave de integração" readonly class="mb-3" style="max-width: 520px">
      <template #append-inner>
        <v-btn size="small" variant="text" :icon="reveal ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" @click="reveal = !reveal" />
        <v-btn size="small" variant="text" icon="mdi-content-copy" @click="copy(info?.apiKey ?? '')" />
      </template>
    </v-text-field>
    <pre class="code">{{ curl }}</pre>
    <div class="text-caption muted mt-2">A chave dá acesso de escrita às notas desta construtora. Guarde como credencial no n8n.</div>
  </v-card>

  <v-row dense>
    <v-col v-for="p in planned" :key="p.name" cols="12" sm="6" lg="4">
      <v-card class="pa-4 h-100">
        <div class="d-flex justify-space-between align-start">
          <div class="font-weight-bold">{{ p.name }}</div>
          <v-chip :color="p.color" variant="tonal">{{ p.status }}</v-chip>
        </div>
        <div class="text-body-2 muted mt-2">{{ p.desc }}</div>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.code {
  background: #0f1f1a;
  color: #d8f3e7;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 0.8rem;
  overflow-x: auto;
}
</style>
