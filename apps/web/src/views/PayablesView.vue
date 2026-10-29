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

  <v-row dense class="mb-2">
    <v-col cols="12" sm="4"><KpiCard label="Vencido" :value="brl(summary.overdue)" :value-color="summary.overdue ? 'error' : undefined" /></v-col>
    <v-col cols="12" sm="4"><KpiCard label="Próximos 7 dias" :value="brl(summary.next7)" /></v-col>
    <v-col cols="12" sm="4"><KpiCard label="Total em aberto (filtro)" :value="brl(summary.total)" /></v-col>
  </v-row>

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
        <v-tooltip v-if="['ABERTO', 'PARCIAL'].includes(item.status) && auth.canApprove" text="Registrar pagamento" location="left">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-cash-check" size="small" variant="tonal" color="primary" aria-label="Registrar pagamento" @click="openPay(item)" />
          </template>
        </v-tooltip>
      </template>
    </v-data-table>
  </v-card>

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
