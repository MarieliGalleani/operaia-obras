<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import PayableChip from '@/components/PayableChip.vue'
import { api } from '@/lib/api'
import { brl, centsToInput, date, parseBRL, ymd } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'
import { useProjects } from '@/stores/projects'

interface Row {
  id: string
  documentId: string
  installment: string
  dueDate: string
  amount: number
  paidAmount: number
  status: string
  supplierName: string | null
  documentNumber: string | null
  description: string | null
  projectNames: string | null
}

const router = useRouter()
const auth = useAuth()
const projects = useProjects()
const status = ref('ABERTO,PARCIAL')
const projectId = ref<string | null>(null)
const rows = ref<Row[]>([])
const loading = ref(false)
const payDialog = ref(false)
const paying = ref<Row | null>(null)
const payForm = ref({ amount: '', paidAt: ymd(new Date()), method: 'PIX' })
const saving = ref(false)

interface Payment {
  id: string
  amount: number
  paidAt: string
  method: string | null
  createdByName: string | null
  createdAt: string
  reversedAt: string | null
  reverseReason: string | null
  reversedByName: string | null
}
const histDialog = ref(false)
const histRow = ref<Row | null>(null)
const history = ref<Payment[]>([])
const histLoading = ref(false)
const reversing = ref<Payment | null>(null)
const reverseReason = ref('')
const reverseSaving = ref(false)

async function openHistory(r: Row) {
  histRow.value = r
  history.value = []
  reversing.value = null
  histDialog.value = true
  histLoading.value = true
  try {
    history.value = await api.get<Payment[]>(`/api/payables/${r.id}/payments`)
  } catch (e) {
    toastError(e)
  } finally {
    histLoading.value = false
  }
}
function askReverse(p: Payment) {
  reversing.value = p
  reverseReason.value = ''
}
async function reverse() {
  if (!histRow.value || !reversing.value) return
  reverseSaving.value = true
  try {
    const upd = await api.post<Row>(`/api/payables/${histRow.value.id}/payments/${reversing.value.id}/reverse`, { reason: reverseReason.value })
    toast(`Pagamento de ${brl(reversing.value.amount)} estornado. O título voltou a ter ${brl(upd.amount - upd.paidAmount)} em aberto.`)
    histRow.value = { ...histRow.value, paidAmount: upd.paidAmount, status: upd.status }
    reversing.value = null
    history.value = await api.get<Payment[]>(`/api/payables/${histRow.value.id}/payments`)
    load()
  } catch (e) {
    toastError(e)
  } finally {
    reverseSaving.value = false
  }
}

const headers = [
  { title: 'Vencimento', key: 'dueDate', width: 120 },
  { title: 'Fornecedor', key: 'supplierName' },
  { title: 'Obra', key: 'projectNames' },
  { title: 'NF / parcela', key: 'documentNumber' },
  { title: 'Valor', key: 'amount', align: 'end' as const },
  { title: 'Em aberto', key: 'remaining', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]

async function load() {
  loading.value = true
  try {
    await projects.ensure()
    const p = new URLSearchParams({ status: status.value })
    if (projectId.value) p.set('projectId', projectId.value)
    rows.value = await api.get<Row[]>(`/api/payables?${p}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([status, projectId], load)

const today = new Date(new Date().toDateString())
const summary = computed(() => {
  const open = rows.value.filter((r) => ['ABERTO', 'PARCIAL'].includes(r.status))
  const rem = (r: Row) => r.amount - r.paidAmount
  const in7 = new Date(today.getTime() + 7 * 86400000)
  return {
    overdue: open.filter((r) => new Date(r.dueDate) < today).reduce((a, r) => a + rem(r), 0),
    next7: open.filter((r) => new Date(r.dueDate) >= today && new Date(r.dueDate) <= in7).reduce((a, r) => a + rem(r), 0),
    total: open.reduce((a, r) => a + rem(r), 0),
  }
})

async function exportCsv() {
  try {
    const p = new URLSearchParams({ status: status.value })
    if (projectId.value) p.set('projectId', projectId.value)
    await api.download(`/api/exports/payables.csv?${p}`, 'contas-a-pagar.csv')
  } catch (e) {
    toastError(e)
  }
}

function openPay(r: Row) {
  paying.value = r
  payForm.value = { amount: centsToInput(r.amount - r.paidAmount), paidAt: ymd(new Date()), method: 'PIX' }
  payDialog.value = true
}
async function pay() {
  if (!paying.value) return
  saving.value = true
  try {
    await api.post(`/api/payables/${paying.value.id}/payments`, { amount: parseBRL(payForm.value.amount), paidAt: payForm.value.paidAt, method: payForm.value.method })
    toast('Pagamento registrado')
    payDialog.value = false
    load()
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Contas a Pagar</div>
      <div class="page-subtitle">Títulos gerados a partir das notas aprovadas. O sistema registra o pagamento; ele não movimenta dinheiro.</div>
    </div>
  </div>

  <div class="panel mb-4">
    <v-row dense>
      <v-col cols="12" sm="4"><KpiCard label="Vencido" :value="brl(summary.overdue)" :value-color="summary.overdue ? 'error' : undefined" icon="mdi-alert-circle-outline" /></v-col>
      <v-col cols="12" sm="4"><KpiCard label="Próximos 7 dias" :value="brl(summary.next7)" icon="mdi-calendar-week" /></v-col>
      <v-col cols="12" sm="4"><KpiCard label="Total em aberto" :value="brl(summary.total)" icon="mdi-cash-clock" /></v-col>
    </v-row>
  </div>

  <v-card>
    <div class="d-flex align-center flex-wrap ga-3 pa-4">
      <v-btn-toggle v-model="status" mandatory color="primary" variant="outlined" density="comfortable" divided>
        <v-btn value="ABERTO,PARCIAL">Em aberto</v-btn>
        <v-btn value="PAGO">Pagos</v-btn>
        <v-btn value="ABERTO,PARCIAL,PAGO,CANCELADO">Todos</v-btn>
      </v-btn-toggle>
      <v-spacer />
      <v-select v-model="projectId" :items="projects.list" item-title="name" item-value="id" label="Obra" clearable style="max-width: 280px" />
      <v-btn variant="outlined" prepend-icon="mdi-file-delimited-outline" @click="exportCsv">Exportar</v-btn>
    </div>
    <v-data-table :headers="headers" :items="rows" :loading="loading" items-per-page="50" no-data-text="Nenhum título.">
      <template #item.dueDate="{ item }">
        <span :class="['ABERTO', 'PARCIAL'].includes(item.status) && new Date(item.dueDate) < today ? 'text-error font-weight-bold' : ''">{{ date(item.dueDate) }}</span>
      </template>
      <template #item.supplierName="{ item }">
        <div class="text-truncate" style="max-width: 210px">{{ item.supplierName }}</div>
        <div class="text-caption muted text-truncate" style="max-width: 210px">{{ item.description }}</div>
      </template>
      <template #item.projectNames="{ item }"><span class="text-truncate d-inline-block" style="max-width: 150px">{{ item.projectNames ?? '—' }}</span></template>
      <template #item.documentNumber="{ item }">
        <a class="link" @click="router.push({ name: 'documents', query: { doc: item.documentId, tab: 'todas' } })">{{ item.documentNumber ?? 's/ nº' }}</a>
        <span class="muted"> · {{ item.installment }}</span>
      </template>
      <template #item.amount="{ item }"><span class="money">{{ brl(item.amount) }}</span></template>
      <template #item.remaining="{ item }"><span class="money font-weight-medium">{{ brl(item.amount - item.paidAmount) }}</span></template>
      <template #item.status="{ item }"><PayableChip :status="item.status" :due-date="item.dueDate" /></template>
      <template #item.actions="{ item }">
        <v-tooltip v-if="item.paidAmount > 0" text="Pagamentos e estorno" location="left">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-history" size="small" variant="text" class="mr-1" aria-label="Pagamentos e estorno" @click="openHistory(item)" />
          </template>
        </v-tooltip>
        <v-tooltip v-if="['ABERTO', 'PARCIAL'].includes(item.status) && auth.canDo('pagamentos')" text="Registrar pagamento" location="left">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-cash-check" size="small" variant="tonal" color="primary" aria-label="Registrar pagamento" @click="openPay(item)" />
          </template>
        </v-tooltip>
      </template>
    </v-data-table>
  </v-card>

  <v-dialog v-model="histDialog" max-width="560" scrollable>
    <v-card v-if="histRow">
      <v-card-title class="pa-5 pb-1 card-title">Pagamentos do título</v-card-title>
      <div class="px-5 text-body-2 muted">{{ histRow.supplierName }} · NF {{ histRow.documentNumber ?? 's/ nº' }} · {{ histRow.installment }}</div>
      <div class="px-5 mt-3 d-flex ga-6 text-body-2">
        <div><div class="muted text-caption">Valor</div><div class="money font-weight-medium">{{ brl(histRow.amount) }}</div></div>
        <div><div class="muted text-caption">Pago</div><div class="money font-weight-medium">{{ brl(histRow.paidAmount) }}</div></div>
        <div><div class="muted text-caption">Em aberto</div><div class="money font-weight-medium">{{ brl(histRow.amount - histRow.paidAmount) }}</div></div>
      </div>
      <v-card-text class="px-5">
        <v-progress-linear v-if="histLoading" indeterminate color="primary" />
        <div v-for="p in history" :key="p.id" class="pay-row py-3" :class="{ reversed: p.reversedAt }">
          <div class="d-flex align-center ga-3">
            <v-icon :icon="p.reversedAt ? 'mdi-undo-variant' : 'mdi-cash-check'" :color="p.reversedAt ? 'grey' : 'success'" />
            <div class="flex-grow-1">
              <div class="font-weight-medium"><span class="money amount">{{ brl(p.amount) }}</span> · {{ date(p.paidAt) }}{{ p.method ? ` · ${p.method}` : '' }}</div>
              <div class="text-caption muted">Registrado por {{ p.createdByName ?? '—' }} em {{ date(p.createdAt) }}</div>
              <div v-if="p.reversedAt" class="text-caption text-error">Estornado por {{ p.reversedByName ?? '—' }} em {{ date(p.reversedAt) }}: {{ p.reverseReason }}</div>
            </div>
            <v-btn
              v-if="!p.reversedAt && auth.canDo('pagamentos') && reversing?.id !== p.id && histRow.status !== 'CANCELADO'"
              size="small"
              variant="outlined"
              color="error"
              prepend-icon="mdi-undo-variant"
              @click="askReverse(p)"
            >Estornar</v-btn>
          </div>
          <div v-if="reversing?.id === p.id" class="reverse-box mt-3 pa-3">
            <div class="text-body-2 mb-2">O título volta a ter <b class="money">{{ brl(histRow.amount - histRow.paidAmount + p.amount) }}</b> em aberto. O pagamento fica no histórico como estornado.</div>
            <v-text-field v-model="reverseReason" label="Motivo do estorno" placeholder="Ex.: valor digitado errado, pago no título errado" autofocus hide-details class="mb-3" />
            <div class="d-flex justify-end ga-2">
              <v-btn variant="text" size="small" @click="reversing = null">Voltar</v-btn>
              <v-btn color="error" size="small" variant="flat" :loading="reverseSaving" :disabled="reverseReason.trim().length < 3" @click="reverse">Confirmar estorno</v-btn>
            </div>
          </div>
        </div>
        <div v-if="!histLoading && !history.length" class="muted text-body-2 py-4">Nenhum pagamento registrado.</div>
      </v-card-text>
      <v-card-actions class="pa-5 pt-0">
        <v-spacer />
        <v-btn variant="text" @click="histDialog = false">Fechar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="payDialog" max-width="440">
    <v-card v-if="paying" class="pa-5">
      <div class="card-title">Registrar pagamento</div>
      <div class="text-body-2 muted mb-4">{{ paying.supplierName }} · NF {{ paying.documentNumber }} · {{ paying.installment }} · em aberto {{ brl(paying.amount - paying.paidAmount) }}</div>
      <v-text-field v-model="payForm.amount" label="Valor pago (R$)" class="mb-3" />
      <v-text-field v-model="payForm.paidAt" type="date" label="Data do pagamento" class="mb-3" />
      <v-select v-model="payForm.method" :items="['PIX', 'Boleto', 'TED', 'Cartão', 'Dinheiro', 'Outro']" label="Forma" />
      <div class="d-flex justify-end ga-2 mt-5">
        <v-btn variant="text" @click="payDialog = false">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="pay">Confirmar</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pay-row + .pay-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.pay-row.reversed .amount {
  text-decoration: line-through;
  opacity: 0.6;
}
.reverse-box {
  background: rgba(var(--v-theme-error), 0.05);
  border: 1px solid rgba(var(--v-theme-error), 0.25);
  border-radius: 10px;
}
</style>
