<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/lib/api'
import { toast, toastError } from '@/lib/toast'

/** base: '/api/mail-inbox' (admin da construtora) ou '/api/platform/companies/:id/mail-inbox' (plataforma) */
const props = defineProps<{ base: string; forPlatform?: boolean }>()

interface Inbox {
  host: string
  port: number
  secure: boolean
  username: string
  mailbox: string
  enabled: boolean
  hasPassword: boolean
  lastCheckAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  messagesProcessed: number
  documentsReceived: number
}
interface Provider {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  help: string
}

const inbox = ref<Inbox | null>(null)
const providers = ref<Provider[]>([])
const loaded = ref(false)
const editing = ref(false)
const saving = ref(false)
const checking = ref(false)
const form = ref({ provider: 'gmail', host: 'imap.gmail.com', port: 993, secure: true, username: '', password: '', mailbox: 'INBOX' })
const formError = ref('')
const removeDialog = ref(false)

async function load() {
  try {
    const res = await api.get<{ inbox: Inbox | null; providers: Provider[] }>(props.base)
    inbox.value = res.inbox
    providers.value = res.providers
  } catch (e) {
    toastError(e)
  } finally {
    loaded.value = true
  }
}
onMounted(load)

const providerOptions = computed(() => [...providers.value.map((p) => ({ title: p.name, value: p.id })), { title: 'Outro servidor (IMAP)', value: 'outro' }])
const currentProvider = computed(() => providers.value.find((p) => p.id === form.value.provider))

function pickProvider(id: string) {
  form.value.provider = id
  const p = providers.value.find((x) => x.id === id)
  if (p) Object.assign(form.value, { host: p.host, port: p.port, secure: p.secure })
}
function startEdit() {
  formError.value = ''
  if (inbox.value) {
    const match = providers.value.find((p) => p.host === inbox.value!.host)
    form.value = { provider: match?.id ?? 'outro', host: inbox.value.host, port: inbox.value.port, secure: inbox.value.secure, username: inbox.value.username, password: '', mailbox: inbox.value.mailbox }
  } else {
    form.value = { provider: 'gmail', host: 'imap.gmail.com', port: 993, secure: true, username: '', password: '', mailbox: 'INBOX' }
  }
  editing.value = true
}

async function save() {
  saving.value = true
  formError.value = ''
  try {
    const { provider: _p, password, ...rest } = form.value
    const res = await api.put<{ inbox: Inbox; test: { unseen: number } }>(props.base, { ...rest, password: password || undefined })
    inbox.value = res.inbox
    editing.value = false
    toast(`Caixa conectada. ${res.test.unseen} e-mail(s) não lido(s) serão lidos em seguida.`)
    checkNow(true)
  } catch (e) {
    formError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function checkNow(silent = false) {
  checking.value = true
  try {
    const res = await api.post<{ result: { ok?: boolean; skipped?: boolean; messages?: number; created?: number; duplicates?: number; error?: string }; inbox: Inbox }>(`${props.base}/check`)
    inbox.value = res.inbox
    const r = res.result
    if (r.skipped) toast('Uma leitura já está em andamento.', 'info')
    else if (!r.ok) toast(r.error ?? 'Falha ao ler a caixa', 'error')
    else if (!silent || r.messages) toast(r.messages ? `${r.messages} e-mail(s) lido(s): ${r.created} nota(s) nova(s)${r.duplicates ? `, ${r.duplicates} repetida(s)` : ''}.` : 'Nenhum e-mail novo.')
  } catch (e) {
    toastError(e)
  } finally {
    checking.value = false
  }
}

async function toggle() {
  try {
    const res = await api.post<{ inbox: Inbox }>(`${props.base}/${inbox.value!.enabled ? 'pause' : 'resume'}`)
    inbox.value = res.inbox
  } catch (e) {
    toastError(e)
  }
}
async function remove() {
  try {
    await api.request('DELETE', props.base)
    inbox.value = null
    removeDialog.value = false
    toast('Caixa desconectada')
  } catch (e) {
    toastError(e)
  }
}

const ago = (iso: string | null) => {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}
const state = computed(() => {
  if (!inbox.value) return null
  if (!inbox.value.enabled) return { color: 'grey', icon: 'mdi-pause-circle-outline', text: 'Pausada' }
  if (inbox.value.lastError) return { color: 'error', icon: 'mdi-alert-circle', text: 'Com problema' }
  return { color: 'success', icon: 'mdi-check-circle', text: 'Conectada' }
})
</script>

<template>
  <v-card class="pa-5">
    <div class="d-flex align-start justify-space-between flex-wrap ga-2 mb-1">
      <div>
        <div class="card-title d-flex align-center ga-2">
          <v-icon color="primary">mdi-email-fast-outline</v-icon>E-mail de notas
          <v-chip v-if="state" :color="state.color" variant="tonal" :prepend-icon="state.icon">{{ state.text }}</v-chip>
        </div>
        <div class="text-body-2 muted mt-1">
          {{ forPlatform ? 'A caixa onde os fornecedores desta construtora mandam as NF-e.' : 'A caixa onde os fornecedores mandam as NF-e.' }}
          O sistema lê os e-mails novos a cada 2 minutos e importa os XMLs sozinho.
        </div>
      </div>
    </div>

    <v-skeleton-loader v-if="!loaded" type="list-item-two-line" />

    <!-- conectada -->
    <template v-else-if="inbox && !editing">
      <v-alert v-if="inbox.lastError" type="error" variant="tonal" density="compact" class="mt-4">
        {{ inbox.lastError }}
        <div class="text-caption mt-1">Desde {{ ago(inbox.lastErrorAt) }}. Corrija em "Alterar" para voltar a receber.</div>
      </v-alert>
      <div class="facts mt-4">
        <div><div class="text-caption muted">Caixa</div><div class="font-weight-medium text-break">{{ inbox.username }}</div></div>
        <div><div class="text-caption muted">Última leitura com sucesso</div><div class="font-weight-medium">{{ ago(inbox.lastSuccessAt) }}</div></div>
        <div><div class="text-caption muted">Notas recebidas por e-mail</div><div class="font-weight-medium">{{ inbox.documentsReceived }}</div></div>
      </div>
      <div class="d-flex ga-2 flex-wrap mt-4">
        <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="checking" :disabled="!inbox.enabled" @click="checkNow()">Ler agora</v-btn>
        <v-btn variant="text" prepend-icon="mdi-pencil-outline" @click="startEdit">Alterar</v-btn>
        <v-btn variant="text" :prepend-icon="inbox.enabled ? 'mdi-pause' : 'mdi-play'" @click="toggle">{{ inbox.enabled ? 'Pausar' : 'Retomar' }}</v-btn>
        <v-btn variant="text" color="error" prepend-icon="mdi-link-variant-off" @click="removeDialog = true">Desconectar</v-btn>
      </div>
    </template>

    <!-- vazia -->
    <template v-else-if="!editing">
      <div class="empty mt-4">
        <div class="text-body-2">
          Crie uma caixa só para notas (por exemplo <strong>notas@suaconstrutora.com.br</strong> ou um Gmail novo), peça aos fornecedores para mandarem a NF-e para ela e conecte aqui.
        </div>
        <v-btn color="primary" class="mt-3" prepend-icon="mdi-email-plus-outline" @click="startEdit">Conectar caixa de e-mail</v-btn>
      </div>
    </template>

    <!-- formulário -->
    <v-form v-else class="mt-4" @submit.prevent="save">
      <v-select id="mail-provider" :model-value="form.provider" :items="providerOptions" label="Onde está a caixa" class="mb-3" @update:model-value="pickProvider" />
      <v-alert v-if="currentProvider" type="info" variant="tonal" density="compact" class="mb-3">{{ currentProvider.help }}</v-alert>
      <v-row v-if="form.provider === 'outro'" dense class="mb-1">
        <v-col cols="12" sm="6"><v-text-field id="mail-host" v-model="form.host" label="Servidor IMAP" placeholder="imap.seudominio.com.br" /></v-col>
        <v-col cols="6" sm="3"><v-text-field id="mail-port" v-model.number="form.port" type="number" label="Porta" /></v-col>
        <v-col cols="6" sm="3" class="d-flex align-center"><v-checkbox id="mail-secure" v-model="form.secure" label="SSL" density="compact" hide-details /></v-col>
      </v-row>
      <v-text-field id="mail-username" v-model="form.username" label="E-mail da caixa" type="email" autocomplete="off" class="mb-3" />
      <v-text-field
        id="mail-password"
        v-model="form.password"
        :label="inbox?.hasPassword ? 'Senha (deixe em branco para manter a atual)' : form.provider === 'gmail' ? 'Senha de app (16 letras)' : 'Senha da caixa'"
        type="password"
        autocomplete="new-password"
        class="mb-3"
      />
      <v-expansion-panels v-if="form.provider === 'gmail'" variant="accordion" class="mb-3">
        <v-expansion-panel title="Como gerar a senha de app do Gmail">
          <v-expansion-panel-text>
            <ol class="text-body-2 pl-4">
              <li>Entre na conta Google da caixa de notas e abra <strong>myaccount.google.com/apppasswords</strong>.</li>
              <li>Se pedir, ative antes a <strong>Verificação em duas etapas</strong> (em Segurança).</li>
              <li>Dê um nome, por exemplo "OperaIA Obras", e clique em <strong>Criar</strong>.</li>
              <li>Copie a senha de 16 letras e cole no campo acima. Ela só serve para ler e-mails, não abre a conta.</li>
            </ol>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
      <v-alert v-if="formError" type="error" variant="tonal" density="compact" class="mb-3">{{ formError }}</v-alert>
      <div class="d-flex ga-2 flex-wrap">
        <v-btn type="submit" color="primary" :loading="saving" :disabled="!form.username || !form.host || (!form.password && !inbox?.hasPassword)">Testar e conectar</v-btn>
        <v-btn variant="text" @click="editing = false">Cancelar</v-btn>
      </div>
      <div class="text-caption muted mt-2">A senha é guardada criptografada e não aparece mais na tela.</div>
    </v-form>

    <v-dialog v-model="removeDialog" max-width="440">
      <v-card class="pa-5">
        <div class="card-title mb-2">Desconectar a caixa de e-mail?</div>
        <div class="text-body-2 mb-4">As notas já importadas continuam no sistema. Os e-mails novos deixam de ser lidos.</div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="removeDialog = false">Cancelar</v-btn>
          <v-btn color="error" @click="remove">Desconectar</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}
.empty {
  border: 1px dashed #c9d3cf;
  border-radius: 10px;
  padding: 16px;
  background: #fafcfb;
}
</style>
