<script setup lang="ts">
/**
 * Obra (construtora): contrato com o proprietário, acesso dele ao portal e prévia da medição.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import MeasurementPreview from '@/components/MeasurementPreview.vue'
import { api } from '@/lib/api'
import { DEMO } from '@/lib/demo'
import { date } from '@/lib/format'
import { shiftMonth, type Measurement } from '@/lib/measurement'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

const props = defineProps<{ projectId: string; canEdit: boolean }>()
const router = useRouter()
const auth = useAuth()

const m = ref<Measurement | null>(null)
const defaults = ref<{ adminFeeBps: number; measurementDay: number | null } | null>(null)
const owners = ref<Array<{ id: string; name: string; email: string; active: boolean; lastLoginAt: string | null }>>([])
const loadingM = ref(false)

const form = ref({ contractType: 'EMPREITADA', adminFee: '', measurementDay: null as number | null, ownerPaysSuppliers: false, ownerName: '', ownerEmail: '' })
const saving = ref(false)
const DAYS = [{ title: 'Padrão da construtora', value: null as number | null }, ...Array.from({ length: 28 }, (_, i) => ({ title: `Todo dia ${i + 1}`, value: i + 1 as number | null }))]
const defaultsText = computed(() =>
  defaults.value
    ? `${(defaults.value.adminFeeBps / 100).toLocaleString('pt-BR')}% · ${defaults.value.measurementDay ? `fecha todo dia ${defaults.value.measurementDay}` : 'fecha no último dia do mês'}`
    : '',
)

async function loadMeasurement(month?: string) {
  loadingM.value = true
  try {
    m.value = await api.get<Measurement>(`/api/projects/${props.projectId}/measurement${month ? `?month=${month}` : ''}`)
  } catch (e) {
    toastError(e)
  } finally {
    loadingM.value = false
  }
}
async function load() {
  await loadMeasurement()
  try {
    defaults.value = await api.get('/api/company/contract-defaults')
    owners.value = await api.get(`/api/projects/${props.projectId}/owners`)
  } catch {
    /* demo/sem permissão: segue sem */
  }
  const c = m.value?.contract
  if (c) {
    form.value = {
      contractType: c.type,
      adminFee: c.adminFeeFromDefault || c.type !== 'ADMINISTRACAO' ? '' : (c.adminFeeBps / 100).toLocaleString('pt-BR'),
      measurementDay: c.measurementDayFromDefault ? null : c.measurementDay,
      ownerPaysSuppliers: c.ownerPaysSuppliers,
      ownerName: c.ownerName ?? '',
      ownerEmail: c.ownerEmail ?? '',
    }
  }
}
async function save() {
  saving.value = true
  try {
    const f = form.value
    const fee = f.adminFee.trim() ? Math.round(Number(f.adminFee.replace(',', '.')) * 100) : null
    await api.patch(`/api/projects/${props.projectId}`, {
      contractType: f.contractType,
      adminFeeBps: fee,
      measurementDay: f.measurementDay,
      ownerPaysSuppliers: f.ownerPaysSuppliers,
      ownerName: f.ownerName || null,
      ownerEmail: f.ownerEmail || null,
    })
    toast('Contrato salvo')
    await loadMeasurement(m.value?.period.month)
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

// ---- acesso do proprietário
const inviteDialog = ref(false)
const invite = ref({ name: '', email: '' })
const inviting = ref(false)
const created = ref<{ email: string; password: string } | null>(null)
function openInvite() {
  invite.value = { name: form.value.ownerName, email: form.value.ownerEmail }
  created.value = null
  inviteDialog.value = true
}
async function sendInvite() {
  inviting.value = true
  try {
    const res = await api.post<{ user: { email: string }; password: string | null }>(`/api/projects/${props.projectId}/owners`, invite.value)
    owners.value = await api.get(`/api/projects/${props.projectId}/owners`)
    if (res.password) created.value = { email: res.user.email, password: res.password }
    else {
      inviteDialog.value = false
      toast('Obra liberada para quem já tinha acesso ao portal')
    }
  } catch (e) {
    toastError(e)
  } finally {
    inviting.value = false
  }
}
async function removeOwner(id: string) {
  try {
    await api.request('DELETE', `/api/projects/${props.projectId}/owners/${id}`)
    owners.value = owners.value.filter((o) => o.id !== id)
    toast('Acesso à obra retirado')
  } catch (e) {
    toastError(e)
  }
}
// "ver como": o administrador confere o portal exatamente como o proprietário vê (só leitura)
const viewing = ref<string | null>(null)
async function viewAsOwner(id: string) {
  viewing.value = id
  try {
    await auth.startViewAs(id)
    router.push({ name: 'owner-project', params: { id: props.projectId } })
  } catch (e) {
    toastError(e)
  } finally {
    viewing.value = null
  }
}
const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copiado'))
const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : ''

onMounted(load)
</script>

<template>
  <div class="pa-4">
    <v-row>
      <v-col cols="12" lg="4">
        <div class="card-title mb-1">Contrato com o proprietário</div>
        <div class="text-caption muted mb-3">Padrão da construtora: {{ defaultsText }}</div>
        <v-btn-toggle v-model="form.contractType" mandatory color="primary" variant="outlined" density="comfortable" divided class="mb-4" :disabled="!canEdit">
          <v-btn value="EMPREITADA">Empreitada</v-btn>
          <v-btn value="ADMINISTRACAO">Administração</v-btn>
        </v-btn-toggle>
        <template v-if="form.contractType === 'ADMINISTRACAO'">
          <v-text-field
            v-model="form.adminFee"
            label="Taxa de administração (%)"
            :placeholder="defaults ? `${(defaults.adminFeeBps / 100).toLocaleString('pt-BR')} (padrão)` : ''"
            hint="Vazio usa o padrão. Incide sobre material e mão de obra."
            persistent-hint
            class="mb-3"
            :disabled="!canEdit"
          />
          <v-select
            v-model="form.measurementDay"
            :items="DAYS"
            label="Fechamento da medição"
            hint="Padrão: o da construtora. Escolha um dia só se esta obra fechar diferente."
            persistent-hint
            class="mb-3"
            :disabled="!canEdit"
          />
          <v-switch v-model="form.ownerPaysSuppliers" color="primary" label="Proprietário paga os fornecedores direto" hide-details class="mb-1" :disabled="!canEdit" />
          <div class="text-caption muted mb-3">Ligado: o proprietário paga as compras aos fornecedores e a construtora recebe só a taxa.</div>
        </template>
        <v-text-field v-model="form.ownerName" label="Proprietário" class="mb-2" :disabled="!canEdit" />
        <v-text-field v-model="form.ownerEmail" label="E-mail do proprietário" type="email" :disabled="!canEdit" />
        <v-btn v-if="canEdit" color="primary" variant="tonal" :loading="saving" class="mt-2" @click="save">Salvar contrato</v-btn>

        <v-divider class="my-5" />
        <div class="d-flex align-center justify-space-between mb-2">
          <div class="card-title">Portal do proprietário</div>
          <v-btn v-if="auth.isAdmin && !DEMO" size="small" color="primary" prepend-icon="mdi-account-key-outline" @click="openInvite">Liberar acesso</v-btn>
        </div>
        <div class="text-caption muted mb-3">O proprietário entra com login próprio e vê só esta obra: notas, medição, fotos e etapas. Não vê nada da construtora.</div>
        <div v-for="o in owners" :key="o.id" class="d-flex align-center ga-2 py-2 owner-row">
          <v-avatar size="30" color="secondary" class="text-caption">{{ o.name.slice(0, 1) }}</v-avatar>
          <div class="flex-grow-1" style="min-width: 0">
            <div class="text-body-2 font-weight-medium text-truncate">{{ o.name }}</div>
            <div class="text-caption muted text-truncate">{{ o.email }} · {{ o.lastLoginAt ? `último acesso ${date(o.lastLoginAt)}` : 'ainda não entrou' }}</div>
          </div>
          <v-btn v-if="auth.isAdmin && !DEMO && o.active" size="small" variant="text" icon="mdi-eye-outline" :aria-label="`Ver como ${o.name} vê`" :loading="viewing === o.id" @click="viewAsOwner(o.id)" />
          <v-btn v-if="auth.isAdmin && !DEMO" size="small" variant="text" icon="mdi-account-remove-outline" :aria-label="`Tirar acesso de ${o.name}`" @click="removeOwner(o.id)" />
        </div>
        <div v-if="!owners.length" class="text-body-2 muted">Nenhum proprietário com acesso.</div>
        <v-btn v-if="DEMO && owners.length" class="mt-3" size="small" variant="tonal" color="primary" prepend-icon="mdi-eye-outline" :to="{ name: 'owner-project', params: { id: projectId } }">
          Ver o portal como o proprietário vê
        </v-btn>
      </v-col>

      <v-col cols="12" lg="8">
        <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-3">
          <div class="d-flex align-center">
            <v-btn icon="mdi-chevron-left" variant="text" size="small" aria-label="Medição anterior" @click="loadMeasurement(shiftMonth(m!.period.month, -1))" />
            <v-btn icon="mdi-chevron-right" variant="text" size="small" aria-label="Próxima medição" @click="loadMeasurement(shiftMonth(m!.period.month, 1))" />
            <v-progress-circular v-if="loadingM" indeterminate size="16" width="2" class="ml-2" />
          </div>
          <v-btn
            variant="outlined"
            size="small"
            prepend-icon="mdi-printer-outline"
            :disabled="!m"
            @click="router.push({ name: 'measurement-print', params: { id: projectId }, query: { month: m?.period.month } })"
          >
            Imprimir ou salvar PDF
          </v-btn>
        </div>
        <MeasurementPreview v-if="m" :m="m" />
      </v-col>
    </v-row>

    <v-dialog v-model="inviteDialog" max-width="460">
      <v-card class="pa-5">
        <template v-if="!created">
          <div class="card-title mb-1">Liberar o portal do proprietário</div>
          <div class="text-body-2 muted mb-4">Cria o login com senha provisória. Ele vê só esta obra.</div>
          <v-text-field v-model="invite.name" label="Nome" class="mb-3" />
          <v-text-field v-model="invite.email" label="E-mail" type="email" />
          <div class="d-flex justify-end ga-2 mt-4">
            <v-btn variant="text" @click="inviteDialog = false">Cancelar</v-btn>
            <v-btn color="primary" :loading="inviting" :disabled="invite.name.length < 2 || !invite.email.includes('@')" @click="sendInvite">Liberar</v-btn>
          </div>
        </template>
        <template v-else>
          <div class="card-title mb-1">Acesso criado</div>
          <div class="text-body-2 muted mb-4">Mande estes dados ao proprietário. A senha aparece só agora; ele pode trocá-la depois de entrar.</div>
          <div class="cred"><span class="muted">Endereço</span><b>{{ portalUrl }}</b></div>
          <div class="cred"><span class="muted">E-mail</span><b>{{ created.email }}</b></div>
          <div class="cred"><span class="muted">Senha provisória</span><b class="mono">{{ created.password }}</b></div>
          <div class="d-flex justify-end ga-2 mt-4">
            <v-btn variant="text" prepend-icon="mdi-content-copy" @click="copy(`${portalUrl}\nE-mail: ${created.email}\nSenha provisória: ${created.password}`)">Copiar</v-btn>
            <v-btn color="primary" @click="inviteDialog = false">Pronto</v-btn>
          </div>
        </template>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.owner-row {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.cred {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  font-size: 0.9rem;
}
.mono {
  font-family: ui-monospace, monospace;
}
</style>
