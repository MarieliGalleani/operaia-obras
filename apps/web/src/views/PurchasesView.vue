<script setup lang="ts">
/**
 * Compras: pedido antes da nota e conferência pedido × nota.
 * A nota que chega com o número do pedido é vinculada sozinha; sem número, a conferência sugere o pedido.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import { api } from '@/lib/api'
import { CATEGORIES, DOC_STATUS, brl, categoryLabel, date, ymd, type CostCategory } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'
import { useProjects } from '@/stores/projects'

interface OrderRow {
  id: string
  code: string
  number: number
  status: string
  projectId: string
  projectName: string
  projectCode: string
  supplierId: string
  supplierName: string
  category: CostCategory
  expectedDate: string | null
  total: number
  invoicedTotal: number
  documentsCount: number
  pendingDocuments: number
  itemsCount: number
  divergent: boolean
  late: boolean
  lastDeliveryDate: string | null
  createdAt: string
  createdByName: string | null
}
interface OrderItem {
  id: string
  description: string
  unit: string | null
  orderedQty: number
  orderedPrice: number
  total: number
  receivedQty: number
  inReviewQty: number
  lastInvoicedPrice: number | null
  priceAbove: boolean
  situation: 'PENDENTE' | 'PARCIAL' | 'ENTREGUE' | 'ACIMA'
  onSiteQty: number
}
interface MaterialRequest {
  id: string
  projectId: string
  projectName: string
  projectCode: string
  items: { description: string; unit: string | null; quantity: number }[]
  neededBy: string | null
  urgent: boolean
  notes: string | null
  createdAt: string
  createdByName: string | null
}
interface OrderDetail extends Omit<OrderRow, 'projectName' | 'projectCode' | 'supplierName'> {
  project: { id: string; code: string; name: string }
  supplier: { id: string; name: string; legalName: string; cnpj: string; status: string }
  paymentTerms: string | null
  notes: string | null
  approvedByName: string | null
  approvedAt: string | null
  cancelReason: string | null
  items: OrderItem[]
  extras: { description: string; unit: string | null; quantity: number; unitPrice: number; documentNumber: string | null }[]
  documents: { id: string; number: string | null; issueDate: string | null; totalAmount: number | null; status: string; issues: { code: string; message: string }[] }[]
  deliveries: { issueDate: string; delayDays: number | null }[]
  history: { action: string; createdAt: string; userName: string | null }[]
  receipts: { id: string; items: { description: string; unit: string | null; quantity: number }[]; problem: boolean; notes: string | null; receivedAt: string; receivedByName: string | null; photos: string[] }[]
  request: { id: string; createdByName: string | null; createdAt: string } | null
}
interface SupplierLite {
  id: string
  name: string
  tradeName: string | null
  status: string
  defaultCategory: CostCategory | null
}
interface Material {
  description: string
  unit: string | null
  lastPrice: number
  perMeasurement: boolean
}

const ORDER_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  RASCUNHO: { label: 'Rascunho', color: 'grey', icon: 'mdi-pencil-outline' },
  APROVADO: { label: 'Aguardando entrega', color: 'info', icon: 'mdi-truck-outline' },
  PARCIAL: { label: 'Entrega parcial', color: 'warning', icon: 'mdi-truck-delivery-outline' },
  ATENDIDO: { label: 'Atendido', color: 'success', icon: 'mdi-check-circle-outline' },
  CANCELADO: { label: 'Cancelado', color: 'grey', icon: 'mdi-close-circle-outline' },
}
const SITUATION: Record<string, { label: string; color: string }> = {
  PENDENTE: { label: 'Falta chegar', color: 'grey' },
  PARCIAL: { label: 'Parcial', color: 'warning' },
  ENTREGUE: { label: 'Entregue', color: 'success' },
  ACIMA: { label: 'Acima do pedido', color: 'error' },
}

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const projects = useProjects()
const canApprove = computed(() => auth.canDo('aprovar_pedidos'))

const rows = ref<OrderRow[]>([])
const loading = ref(true)
const filter = ref<string>('abertos')

const requests = ref<MaterialRequest[]>([])
async function load() {
  loading.value = true
  try {
    ;[rows.value, requests.value] = await Promise.all([api.get<OrderRow[]>('/api/purchase-orders'), api.get<MaterialRequest[]>('/api/material-requests?status=ABERTA')])
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  load()
  projects.ensure().catch(() => {})
  if (route.query.pedido) openDetail(String(route.query.pedido))
})

const isOpen = (o: OrderRow) => o.status === 'APROVADO' || o.status === 'PARCIAL'
const FILTERS = computed(() => [
  { value: 'abertos', label: 'Em aberto', count: rows.value.filter(isOpen).length },
  { value: 'atrasados', label: 'Atrasados', count: rows.value.filter((o) => o.late).length, color: 'error' },
  { value: 'divergentes', label: 'Com divergência', count: rows.value.filter((o) => o.divergent).length, color: 'warning' },
  { value: 'RASCUNHO', label: 'Rascunhos', count: rows.value.filter((o) => o.status === 'RASCUNHO').length },
  { value: 'ATENDIDO', label: 'Atendidos', count: rows.value.filter((o) => o.status === 'ATENDIDO').length },
  { value: 'todos', label: 'Todos', count: rows.value.length },
])
const visible = computed(() =>
  rows.value.filter((o) =>
    filter.value === 'todos'
      ? true
      : filter.value === 'abertos'
        ? isOpen(o)
        : filter.value === 'atrasados'
          ? o.late
          : filter.value === 'divergentes'
            ? o.divergent
            : o.status === filter.value,
  ),
)
const kpis = computed(() => {
  const open = rows.value.filter(isOpen)
  return {
    open: open.length,
    toReceive: open.reduce((a, o) => a + Math.max(0, o.total - o.invoicedTotal), 0),
    late: rows.value.filter((o) => o.late).length,
    divergent: rows.value.filter((o) => o.divergent).length,
    drafts: rows.value.filter((o) => o.status === 'RASCUNHO').length,
  }
})
const receivedPct = (o: { total: number; invoicedTotal: number }) => (o.total ? Math.min(100, (o.invoicedTotal / o.total) * 100) : 0)
const daysFromToday = (iso: string) => Math.round((new Date(ymd(new Date(iso)) + 'T00:00:00').getTime() - new Date(ymd(new Date()) + 'T00:00:00').getTime()) / 86400000)
function dueLabel(o: { expectedDate: string | null; status: string; late: boolean }) {
  if (!o.expectedDate) return ''
  if (o.status === 'ATENDIDO' || o.status === 'CANCELADO' || o.status === 'RASCUNHO') return ''
  const d = daysFromToday(o.expectedDate)
  if (o.late) return `${-d} dia${-d === 1 ? '' : 's'} de atraso`
  return d === 0 ? 'hoje' : `em ${d} dia${d === 1 ? '' : 's'}`
}
const qty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const unitPrice = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// ------------------------------------------------------------ detalhe
const detail = ref<OrderDetail | null>(null)
const detailOpen = ref(false)
const busy = ref(false)
async function openDetail(id: string) {
  detailOpen.value = true
  detail.value = null
  try {
    detail.value = await api.get<OrderDetail>(`/api/purchase-orders/${id}`)
  } catch (e) {
    toastError(e)
    detailOpen.value = false
  }
}
watch(detailOpen, (v) => {
  if (!v && route.query.pedido) router.replace({ query: {} })
})
async function approve() {
  if (!detail.value) return
  busy.value = true
  try {
    detail.value = await api.post<OrderDetail>(`/api/purchase-orders/${detail.value.id}/approve`, {})
    toast(`Pedido ${detail.value.code} aprovado. Peça ao fornecedor para informar "${detail.value.code}" na nota.`)
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
const cancelDialog = ref(false)
const cancelReason = ref('')
async function cancel() {
  if (!detail.value) return
  busy.value = true
  try {
    detail.value = await api.post<OrderDetail>(`/api/purchase-orders/${detail.value.id}/cancel`, { reason: cancelReason.value })
    cancelDialog.value = false
    toast('Pedido cancelado')
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
const HISTORY: Record<string, string> = { created: 'Pedido criado', updated: 'Pedido editado', approved: 'Pedido aprovado', cancelled: 'Pedido cancelado', received_on_site: 'Entrega conferida na obra' }
const delivery = computed(() => {
  const d = detail.value?.deliveries ?? []
  if (!d.length) return null
  const last = d[d.length - 1]
  return last
})

// ------------------------------------------------------------ novo / editar
interface FormItem {
  description: string
  unit: string
  quantity: string
  unitPrice: string
  hint?: string
}
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const fromRequest = ref<MaterialRequest | null>(null)
const form = ref({ projectId: null as string | null, supplierId: null as string | null, category: 'MATERIAIS' as CostCategory, expectedDate: '', paymentTerms: '', notes: '' })
const items = ref<FormItem[]>([])
const suppliers = ref<SupplierLite[]>([])
const materials = ref<Material[]>([])
const saving = ref(false)

const num = (s: string) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const lineTotal = (i: FormItem) => Math.round(num(i.quantity) * num(i.unitPrice) * 100)
const formTotal = computed(() => items.value.reduce((a, i) => a + lineTotal(i), 0))
const formValid = computed(
  () => !!form.value.projectId && !!form.value.supplierId && items.value.length > 0 && items.value.every((i) => i.description.trim().length >= 2 && num(i.quantity) > 0 && num(i.unitPrice) >= 0),
)

async function ensureSuppliers() {
  if (!suppliers.value.length) suppliers.value = (await api.get<SupplierLite[]>('/api/suppliers?')).filter((s) => s.status !== 'BLOQUEADO')
}
const blankItem = (): FormItem => ({ description: '', unit: '', quantity: '', unitPrice: '' })
async function openNew(req?: MaterialRequest) {
  editingId.value = null
  fromRequest.value = req ?? null
  form.value = { projectId: null, supplierId: null, category: 'MATERIAIS', expectedDate: ymd(new Date(Date.now() + 7 * 86400000)), paymentTerms: '28 dias', notes: '' }
  items.value = req ? req.items.map((i) => ({ description: i.description, unit: i.unit ?? '', quantity: String(i.quantity).replace('.', ','), unitPrice: '' })) : [blankItem()]
  if (req) {
    form.value.projectId = req.projectId
    if (req.neededBy) form.value.expectedDate = ymd(new Date(req.neededBy))
    form.value.notes = req.notes ?? ''
  }
  materials.value = []
  formOpen.value = true
  try {
    await Promise.all([ensureSuppliers(), projects.ensure()])
  } catch (e) {
    toastError(e)
  }
}
async function openEdit() {
  const d = detail.value
  if (!d) return
  editingId.value = d.id
  fromRequest.value = null
  form.value = {
    projectId: d.project.id,
    supplierId: d.supplier.id,
    category: d.category,
    expectedDate: d.expectedDate ? ymd(new Date(d.expectedDate)) : '',
    paymentTerms: d.paymentTerms ?? '',
    notes: d.notes ?? '',
  }
  items.value = d.items.map((i) => ({ description: i.description, unit: i.unit ?? '', quantity: String(i.orderedQty).replace('.', ','), unitPrice: i.orderedPrice.toFixed(2).replace('.', ',') }))
  detailOpen.value = false
  formOpen.value = true
  await ensureSuppliers().catch(toastError)
}
// materiais que este fornecedor já vendeu: sugere descrição, unidade e último preço
watch(
  () => form.value.supplierId,
  async (id) => {
    materials.value = []
    if (!id) return
    const s = suppliers.value.find((x) => x.id === id)
    if (s?.defaultCategory && !editingId.value) form.value.category = s.defaultCategory
    try {
      const r = await api.get<{ materials: Material[] }>(`/api/suppliers/${id}/prices`)
      materials.value = r.materials.filter((m) => !m.perMeasurement)
    } catch {
      /* sem histórico */
    }
  },
)
function pickMaterial(i: FormItem, value: string | Material | null) {
  const m = typeof value === 'string' ? materials.value.find((x) => x.description === value) : value
  if (!m) {
    i.description = (value as string) ?? ''
    i.hint = undefined
    return
  }
  i.description = m.description
  i.unit = m.unit ?? ''
  if (!i.unitPrice) i.unitPrice = m.lastPrice.toFixed(2).replace('.', ',')
  i.hint = `Último preço deste fornecedor: ${unitPrice(m.lastPrice)}/${m.unit ?? 'un'}`
}
async function save(andApprove: boolean) {
  saving.value = true
  const body = {
    projectId: form.value.projectId,
    supplierId: form.value.supplierId,
    category: form.value.category,
    expectedDate: form.value.expectedDate || null,
    paymentTerms: form.value.paymentTerms || null,
    notes: form.value.notes || null,
    items: items.value.map((i) => ({ description: i.description, unit: i.unit || null, quantity: num(i.quantity), unitPrice: num(i.unitPrice) })),
    ...(fromRequest.value && !editingId.value && { requestId: fromRequest.value.id }),
  }
  try {
    let saved = editingId.value
      ? await api.patch<OrderDetail>(`/api/purchase-orders/${editingId.value}`, body)
      : await api.post<OrderDetail>('/api/purchase-orders', body)
    if (andApprove) saved = await api.post<OrderDetail>(`/api/purchase-orders/${saved.id}/approve`, {})
    toast(andApprove ? `Pedido ${saved.code} aprovado. Peça ao fornecedor para informar "${saved.code}" na nota.` : `Pedido ${saved.code} salvo como rascunho`)
    formOpen.value = false
    await load()
    openDetail(saved.id)
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
// recusar pedido de material da obra
const declining = ref<MaterialRequest | null>(null)
const declineReason = ref('')
async function decline() {
  if (!declining.value) return
  busy.value = true
  try {
    await api.post(`/api/material-requests/${declining.value.id}/decline`, { reason: declineReason.value })
    declining.value = null
    toast('Pedido de material recusado; o mestre vê o motivo no app de obra', 'info')
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const supplierItems = computed(() => suppliers.value.map((s) => ({ value: s.id, title: s.tradeName ?? s.name, subtitle: s.status === 'HOMOLOGADO' ? 'Homologado' : 'Pendente de homologação' })))
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Compras</div>
      <div class="page-subtitle">Pedido antes da nota. Quando a nota chega, o sistema confere preço, quantidade e prazo de entrega contra o pedido.</div>
    </div>
    <v-btn color="primary" prepend-icon="mdi-plus" @click="openNew()">Novo pedido</v-btn>
  </div>

  <v-row dense class="mb-2">
    <v-col cols="6" md="3"><KpiCard label="Pedidos em aberto" :value="String(kpis.open).padStart(2, '0')" :hint="`${brl(kpis.toReceive, { compact: true })} a receber`" icon="mdi-truck-outline" /></v-col>
    <v-col cols="6" md="3">
      <KpiCard label="Entregas atrasadas" :value="String(kpis.late).padStart(2, '0')" :value-color="kpis.late ? 'error' : undefined" hint="passaram da data prometida" icon="mdi-clock-alert-outline" />
    </v-col>
    <v-col cols="6" md="3">
      <KpiCard label="Notas com divergência" :value="String(kpis.divergent).padStart(2, '0')" :value-color="kpis.divergent ? 'warning' : undefined" hint="preço ou quantidade fora do pedido" icon="mdi-scale-unbalanced" />
    </v-col>
    <v-col cols="6" md="3"><KpiCard label="Rascunhos" :value="String(kpis.drafts).padStart(2, '0')" hint="aguardando aprovação" icon="mdi-pencil-outline" /></v-col>
  </v-row>

  <v-card v-if="requests.length" class="pa-4 mb-4 req-card">
    <div class="d-flex align-center ga-2 mb-2">
      <v-icon color="primary">mdi-hard-hat</v-icon>
      <div class="card-title" style="font-size: 1rem">Pedidos de material da obra</div>
      <v-chip size="small" color="primary" variant="flat">{{ requests.length }}</v-chip>
      <v-spacer />
      <span class="text-caption muted">feitos pelo mestre no app de obra</span>
    </div>
    <div v-for="r in requests" :key="r.id" class="req-row">
      <div class="flex-grow-1" style="min-width: 0">
        <div class="d-flex align-center ga-2 flex-wrap">
          <b>{{ r.projectName }}</b>
          <v-chip v-if="r.urgent" size="x-small" color="error" variant="flat">urgente</v-chip>
          <span class="text-caption muted">{{ r.createdByName }} · {{ when(r.createdAt) }}<template v-if="r.neededBy"> · precisa até {{ date(r.neededBy) }}</template></span>
        </div>
        <div class="text-body-2">
          <span v-for="(i, k) in r.items" :key="k">{{ qty(i.quantity) }} {{ i.unit }} {{ i.description.toLowerCase() }}<span v-if="k < r.items.length - 1"> · </span></span>
        </div>
        <div v-if="r.notes" class="text-caption muted">{{ r.notes }}</div>
      </div>
      <div class="d-flex ga-2 flex-shrink-0">
        <v-btn size="small" color="primary" variant="flat" prepend-icon="mdi-cart-plus" @click="openNew(r)">Fazer pedido</v-btn>
        <v-btn v-if="canApprove" size="small" variant="text" @click="(declining = r), (declineReason = '')">Recusar</v-btn>
      </div>
    </div>
  </v-card>

  <div class="d-flex flex-wrap ga-2 mb-3">
    <v-chip
      v-for="f in FILTERS"
      :key="f.value"
      :color="filter === f.value ? 'primary' : f.count && f.color ? f.color : undefined"
      :variant="filter === f.value ? 'flat' : 'tonal'"
      size="small"
      @click="filter = f.value"
    >
      {{ f.label }} <b class="ml-1">{{ f.count }}</b>
    </v-chip>
  </div>

  <v-card class="pa-0">
    <div v-if="loading" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else class="table-wrap">
      <table class="po-table">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Obra</th>
            <th>Fornecedor</th>
            <th>Entrega prometida</th>
            <th class="text-right">Valor</th>
            <th style="min-width: 150px">Recebido</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in visible" :key="o.id" class="clickable" @click="openDetail(o.id)">
            <td>
              <div class="font-weight-bold">{{ o.code }}</div>
              <div class="text-caption muted">{{ date(o.createdAt) }} · {{ o.itemsCount }} {{ o.itemsCount === 1 ? 'item' : 'itens' }}</div>
            </td>
            <td>
              <div>{{ o.projectName }}</div>
              <div class="text-caption muted">{{ o.projectCode }}</div>
            </td>
            <td>
              <div>{{ o.supplierName }}</div>
              <div class="text-caption muted">{{ categoryLabel(o.category) }}</div>
            </td>
            <td>
              <div>{{ date(o.expectedDate) }}</div>
              <div v-if="dueLabel(o)" class="text-caption" :class="o.late ? 'text-error font-weight-bold' : 'muted'">
                <v-icon v-if="o.late" size="14" class="mr-1">mdi-clock-alert-outline</v-icon>{{ dueLabel(o) }}
              </div>
            </td>
            <td class="text-right money font-weight-medium">{{ brl(o.total) }}</td>
            <td>
              <v-progress-linear :model-value="receivedPct(o)" :color="o.status === 'ATENDIDO' ? 'success' : 'primary'" bg-color="grey-lighten-2" height="6" rounded />
              <div class="text-caption muted mt-1">
                {{ brl(o.invoicedTotal, { compact: true }) }} em {{ o.documentsCount - o.pendingDocuments }} nota(s)
                <span v-if="o.pendingDocuments" class="text-warning"> · {{ o.pendingDocuments }} em conferência</span>
              </div>
            </td>
            <td>
              <v-chip size="small" variant="tonal" :color="ORDER_STATUS[o.status].color" :prepend-icon="ORDER_STATUS[o.status].icon">{{ ORDER_STATUS[o.status].label }}</v-chip>
              <v-chip v-if="o.divergent" size="x-small" color="warning" variant="flat" class="ml-1" prepend-icon="mdi-scale-unbalanced">divergência</v-chip>
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td colspan="7" class="pa-8 text-center muted">
              <template v-if="!rows.length">Nenhum pedido ainda. Crie o primeiro: a nota que chegar com o número dele é conferida sozinha.</template>
              <template v-else>Nenhum pedido neste filtro.</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </v-card>
  <div class="text-caption muted mt-3">
    <v-icon size="14" class="mr-1">mdi-information-outline</v-icon>Nota sem pedido também pode ser aprovada; ela aparece com o aviso "sem pedido". Peça ao fornecedor para informar o número do pedido
    (ex.: PC-0012) no campo "pedido" da nota.
  </div>

  <!-- DETALHE -->
  <v-dialog v-model="detailOpen" max-width="1080" scrollable>
    <v-card>
      <div v-if="!detail" class="pa-10 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
      <template v-else>
        <div class="pa-5 pb-3 d-flex align-start justify-space-between flex-wrap ga-3">
          <div>
            <div class="d-flex align-center ga-2 flex-wrap">
              <span class="card-title">Pedido {{ detail.code }}</span>
              <v-chip size="small" variant="tonal" :color="ORDER_STATUS[detail.status].color" :prepend-icon="ORDER_STATUS[detail.status].icon">{{ ORDER_STATUS[detail.status].label }}</v-chip>
              <v-chip v-if="detail.late" size="small" color="error" variant="flat" prepend-icon="mdi-clock-alert-outline">{{ dueLabel(detail) }}</v-chip>
            </div>
            <div class="text-body-2 muted mt-1">{{ detail.supplier.name }} → {{ detail.project.name }}</div>
          </div>
          <div class="d-flex ga-2 flex-wrap">
            <template v-if="detail.status === 'RASCUNHO'">
              <v-btn variant="outlined" prepend-icon="mdi-pencil-outline" @click="openEdit">Editar</v-btn>
              <v-btn v-if="canApprove" color="primary" prepend-icon="mdi-check" :loading="busy" @click="approve">Aprovar pedido</v-btn>
            </template>
            <v-btn
              v-if="canApprove && !['CANCELADO', 'ATENDIDO'].includes(detail.status)"
              variant="text"
              color="error"
              :disabled="busy"
              @click="(cancelReason = ''), (cancelDialog = true)"
            >
              Cancelar pedido
            </v-btn>
            <v-btn icon="mdi-close" variant="text" aria-label="Fechar" @click="detailOpen = false" />
          </div>
        </div>
        <v-divider />
        <v-card-text class="pa-5">
          <div class="facts mb-5">
            <div>
              <div class="fact-label">Obra</div>
              <a href="#" class="fact-value link" @click.prevent="router.push(`/obras/${detail.project.id}`)">{{ detail.project.name }}</a>
            </div>
            <div>
              <div class="fact-label">Fornecedor</div>
              <div class="fact-value">{{ detail.supplier.name }}</div>
            </div>
            <div>
              <div class="fact-label">Entrega prometida</div>
              <div class="fact-value">{{ date(detail.expectedDate) }}</div>
              <div v-if="delivery" class="text-caption" :class="(delivery.delayDays ?? 0) > 0 ? 'text-error' : 'text-success'">
                {{ detail.status === 'ATENDIDO' ? 'Entregue' : 'Última entrega' }} em {{ date(delivery.issueDate) }}
                · {{ (delivery.delayDays ?? 0) > 0 ? `${delivery.delayDays} dia(s) de atraso` : 'no prazo' }}
              </div>
            </div>
            <div>
              <div class="fact-label">Pagamento</div>
              <div class="fact-value">{{ detail.paymentTerms || '—' }}</div>
            </div>
            <div>
              <div class="fact-label">Valor do pedido</div>
              <div class="fact-value money">{{ brl(detail.total) }}</div>
            </div>
            <div>
              <div class="fact-label">Aprovado por</div>
              <div class="fact-value">{{ detail.approvedByName ?? '—' }}</div>
              <div v-if="detail.approvedAt" class="text-caption muted">{{ date(detail.approvedAt) }}</div>
            </div>
          </div>

          <v-alert v-if="detail.status === 'CANCELADO'" type="info" variant="tonal" density="compact" class="mb-4">Cancelado: {{ detail.cancelReason }}</v-alert>

          <div class="card-title mb-2" style="font-size: 1rem">Conferência pedido × notas</div>
          <div class="table-wrap mb-2">
            <table class="po-table conf">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="text-right">Pedido</th>
                  <th class="text-right">Preço combinado</th>
                  <th class="text-right">Na nota</th>
                  <th class="text-right">Na obra</th>
                  <th class="text-right">Preço na nota</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in detail.items" :key="i.id">
                  <td>
                    <div class="font-weight-medium">{{ i.description }}</div>
                    <div class="text-caption muted">{{ brl(i.total) }}</div>
                  </td>
                  <td class="text-right money">{{ qty(i.orderedQty) }} {{ i.unit }}</td>
                  <td class="text-right money">{{ unitPrice(i.orderedPrice) }}</td>
                  <td class="text-right money">
                    {{ qty(i.receivedQty) }} {{ i.unit }}
                    <div v-if="i.inReviewQty" class="text-caption text-warning">+ {{ qty(i.inReviewQty) }} em conferência</div>
                  </td>
                  <td class="text-right money" :class="i.onSiteQty && i.onSiteQty < i.receivedQty + i.inReviewQty ? 'text-error font-weight-bold' : ''">
                    {{ i.onSiteQty ? `${qty(i.onSiteQty)} ${i.unit ?? ''}` : '—' }}
                    <div v-if="i.onSiteQty && i.onSiteQty < i.receivedQty + i.inReviewQty" class="text-caption">nota cobra {{ qty(i.receivedQty + i.inReviewQty - i.onSiteQty) }} a mais</div>
                  </td>
                  <td class="text-right money" :class="i.priceAbove ? 'text-error font-weight-bold' : ''">
                    {{ unitPrice(i.lastInvoicedPrice) }}
                    <div v-if="i.priceAbove && i.lastInvoicedPrice" class="text-caption">+{{ (((i.lastInvoicedPrice - i.orderedPrice) / i.orderedPrice) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }}%</div>
                  </td>
                  <td>
                    <v-chip size="x-small" variant="tonal" :color="SITUATION[i.situation].color">{{ SITUATION[i.situation].label }}</v-chip>
                    <v-chip v-if="i.priceAbove" size="x-small" variant="flat" color="error" class="ml-1">preço acima</v-chip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <v-alert v-if="detail.extras.length" type="warning" variant="tonal" density="compact" class="mb-4">
            Vieram na nota sem estar no pedido:
            <span v-for="(x, k) in detail.extras" :key="k">
              <b>{{ x.description }}</b> ({{ qty(x.quantity) }} {{ x.unit }}, NF {{ x.documentNumber }})<span v-if="k < detail.extras.length - 1">; </span>
            </span>
          </v-alert>

          <v-row>
            <v-col cols="12" md="7">
              <div class="card-title mb-2" style="font-size: 1rem">Notas deste pedido</div>
              <div v-if="!detail.documents.length" class="text-body-2 muted">
                Nenhuma nota ainda.
                <template v-if="detail.status !== 'RASCUNHO'">Quando chegar uma nota de {{ detail.supplier.name }} com "{{ detail.code }}", ela aparece aqui.</template>
              </div>
              <div v-for="d in detail.documents" :key="d.id" class="doc-row" @click="router.push({ path: '/notas', query: { doc: d.id, tab: 'todas' } })">
                <v-icon size="20" class="mr-2" color="primary">mdi-file-document-outline</v-icon>
                <div class="flex-grow-1">
                  <div class="font-weight-medium">NF {{ d.number ?? '—' }} · {{ date(d.issueDate) }}</div>
                  <div v-for="(iss, k) in d.issues.filter((x) => x.code.startsWith('PEDIDO_'))" :key="k" class="text-caption text-warning">{{ iss.message }}</div>
                </div>
                <span class="money mr-3 text-no-wrap">{{ brl(d.totalAmount) }}</span>
                <v-chip size="x-small" variant="tonal" class="flex-shrink-0" :color="DOC_STATUS[d.status]?.color">{{ DOC_STATUS[d.status]?.label ?? d.status }}</v-chip>
              </div>
            </v-col>
            <v-col cols="12" md="5">
              <template v-if="detail.receipts.length">
                <div class="card-title mb-2" style="font-size: 1rem">Recebido na obra</div>
                <div v-for="r in detail.receipts" :key="r.id" class="text-body-2 mb-2">
                  <v-icon size="16" :color="r.problem ? 'warning' : 'success'">{{ r.problem ? 'mdi-truck-alert-outline' : 'mdi-check-circle-outline' }}</v-icon>
                  {{ when(r.receivedAt) }} · {{ r.receivedByName }}:
                  <span v-for="(i, k) in r.items" :key="k">{{ qty(i.quantity) }} {{ i.unit }}<span v-if="k < r.items.length - 1">, </span></span>
                  <div v-if="r.notes" class="text-caption" :class="r.problem ? 'text-warning' : 'muted'">{{ r.notes }}</div>
                  <div v-if="r.photos.length" class="d-flex ga-1 mt-1"><img v-for="u in r.photos" :key="u" :src="u" class="rc-photo" alt="Foto da entrega" /></div>
                </div>
              </template>
              <div v-if="detail.request" class="text-body-2 mb-3">
                <v-icon size="16" color="primary">mdi-hard-hat</v-icon> Veio do pedido de material de {{ detail.request.createdByName }} em {{ date(detail.request.createdAt) }}
              </div>
              <div class="card-title mb-2" style="font-size: 1rem">Histórico</div>
              <div v-for="(h, k) in detail.history" :key="k" class="text-body-2 mb-1">
                <span class="muted">{{ date(h.createdAt) }}</span> · {{ HISTORY[h.action] ?? h.action }}<span v-if="h.userName"> por {{ h.userName }}</span>
              </div>
              <div v-if="detail.notes" class="text-body-2 mt-3"><span class="muted">Observações:</span> {{ detail.notes }}</div>
            </v-col>
          </v-row>
        </v-card-text>
      </template>
    </v-card>
  </v-dialog>

  <v-dialog v-model="cancelDialog" max-width="440">
    <v-card class="pa-5">
      <div class="card-title mb-2">Cancelar pedido {{ detail?.code }}?</div>
      <div class="text-body-2 muted mb-3">Notas em conferência vinculadas a ele ficam sem pedido. Pedido com nota já aprovada não pode ser cancelado.</div>
      <v-text-field v-model="cancelReason" label="Motivo" autofocus />
      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" @click="cancelDialog = false">Voltar</v-btn>
        <v-btn color="error" :disabled="cancelReason.trim().length < 3" :loading="busy" @click="cancel">Cancelar pedido</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <v-dialog :model-value="!!declining" max-width="460" @update:model-value="declining = null">
    <v-card class="pa-5">
      <div class="card-title mb-2">Recusar pedido de material?</div>
      <div class="text-body-2 muted mb-3">O mestre vê o motivo no app de obra.</div>
      <v-textarea v-model="declineReason" label="Motivo" rows="2" auto-grow autofocus />
      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" @click="declining = null">Voltar</v-btn>
        <v-btn color="error" :disabled="declineReason.trim().length < 3" :loading="busy" @click="decline">Recusar</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <!-- NOVO / EDITAR -->
  <v-dialog v-model="formOpen" max-width="920" scrollable>
    <v-card>
      <div class="pa-5 pb-2 d-flex align-center justify-space-between">
        <div>
          <div class="card-title">{{ editingId ? 'Editar pedido' : 'Novo pedido de compra' }}</div>
          <div v-if="fromRequest" class="text-caption muted">A partir do pedido de material de {{ fromRequest.createdByName }} ({{ fromRequest.projectName }}). Escolha o fornecedor e os preços.</div>
        </div>
        <v-btn icon="mdi-close" variant="text" aria-label="Fechar" @click="formOpen = false" />
      </div>
      <v-card-text class="pa-5 pt-2">
        <v-row dense>
          <v-col cols="12" md="6">
            <v-autocomplete v-model="form.projectId" :items="projects.active" item-value="id" item-title="name" label="Obra" prepend-inner-icon="mdi-office-building-outline" />
          </v-col>
          <v-col cols="12" md="6">
            <v-autocomplete v-model="form.supplierId" :items="supplierItems" label="Fornecedor" prepend-inner-icon="mdi-store-outline">
              <template #item="{ props: p, item }">
                <v-list-item v-bind="p" :subtitle="item.raw.subtitle" />
              </template>
            </v-autocomplete>
          </v-col>
          <v-col cols="12" sm="4">
            <v-select v-model="form.category" :items="CATEGORIES" item-value="value" item-title="title" label="Categoria" />
          </v-col>
          <v-col cols="6" sm="4"><v-text-field v-model="form.expectedDate" type="date" label="Entrega prometida" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model="form.paymentTerms" label="Condição de pagamento" placeholder="28 dias" /></v-col>
        </v-row>

        <div class="d-flex align-center justify-space-between mt-2 mb-2">
          <div class="font-weight-bold">Itens</div>
          <div v-if="materials.length" class="text-caption muted"><v-icon size="14">mdi-lightbulb-on-outline</v-icon> Comece a digitar: aparecem os materiais que este fornecedor já vendeu, com o último preço.</div>
        </div>
        <div v-for="(i, k) in items" :key="k" class="item-row">
          <v-combobox
            :model-value="i.description"
            :items="materials.map((m) => m.description)"
            label="Descrição"
            density="compact"
            variant="outlined"
            class="desc"
            :hint="i.hint"
            persistent-hint
            @update:model-value="(v: string | null) => pickMaterial(i, v)"
          />
          <v-text-field v-model="i.unit" label="Un." density="compact" class="unit" />
          <v-text-field v-model="i.quantity" label="Qtd." density="compact" class="qty" inputmode="decimal" />
          <v-text-field v-model="i.unitPrice" label="Preço unit." prefix="R$" density="compact" class="price" inputmode="decimal" />
          <div class="line-total money">{{ brl(lineTotal(i)) }}</div>
          <v-btn icon="mdi-delete-outline" size="small" variant="text" :disabled="items.length === 1" aria-label="Remover item" @click="items.splice(k, 1)" />
        </div>
        <div class="d-flex align-center justify-space-between mt-1">
          <v-btn variant="text" prepend-icon="mdi-plus" size="small" @click="items.push(blankItem())">Adicionar item</v-btn>
          <div class="text-body-1">Total <b class="money ml-2">{{ brl(formTotal) }}</b></div>
        </div>
        <v-textarea v-model="form.notes" label="Observações para o fornecedor (opcional)" rows="2" auto-grow class="mt-3" />
      </v-card-text>
      <v-divider />
      <div class="pa-4 d-flex justify-end ga-2 flex-wrap">
        <v-btn variant="text" @click="formOpen = false">Cancelar</v-btn>
        <v-btn variant="outlined" :loading="saving" :disabled="!formValid" @click="save(false)">Salvar rascunho</v-btn>
        <v-btn v-if="canApprove" color="primary" :loading="saving" :disabled="!formValid" prepend-icon="mdi-check" @click="save(true)">Salvar e aprovar</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.req-card {
  border-left: 4px solid rgb(var(--v-theme-primary));
}
.req-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
@media (max-width: 700px) {
  .req-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
.rc-photo {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
}
.table-wrap {
  overflow-x: auto;
}
.po-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.po-table th {
  text-align: left;
  font-weight: 600;
  color: var(--oo-muted);
  padding: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  white-space: nowrap;
}
.po-table td {
  padding: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  vertical-align: middle;
}
.po-table th.text-right {
  text-align: right;
}
.clickable {
  cursor: pointer;
}
.clickable:hover {
  background: rgba(14, 107, 83, 0.04);
}
.conf td {
  padding: 10px 12px;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}
.fact-label {
  font-size: 0.75rem;
  color: var(--oo-muted);
  margin-bottom: 2px;
}
.fact-value {
  font-weight: 600;
}
.link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.doc-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}
.doc-row:hover {
  background: rgba(14, 107, 83, 0.04);
}
.item-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}
.item-row .desc {
  flex: 1 1 260px;
}
.item-row .unit {
  flex: 0 0 72px;
}
.item-row .qty {
  flex: 0 0 96px;
}
.item-row .price {
  flex: 0 0 130px;
}
.line-total {
  flex: 0 0 110px;
  text-align: right;
  padding-top: 10px;
  font-weight: 600;
}
@media (max-width: 700px) {
  .item-row {
    flex-wrap: wrap;
    padding-bottom: 8px;
    border-bottom: 1px dashed rgba(0, 0, 0, 0.1);
  }
  .item-row .desc {
    flex-basis: 100%;
  }
}
</style>
