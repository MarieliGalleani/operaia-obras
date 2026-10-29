<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { ApiError, api } from '@/lib/api'
import {
  CATEGORIES,
  DOC_STATUS,
  PAYABLE_STATUS,
  SEVERITY,
  SOURCE,
  brl,
  categoryLabel,
  centsToInput,
  cnpj,
  date,
  parseBRL,
  type CostCategory,
} from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import type { DocumentDetail } from '@/lib/types'
import { useAuth } from '@/stores/auth'
import { useProjects } from '@/stores/projects'

const props = defineProps<{ documentId: string | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const auth = useAuth()
const projects = useProjects()
const { smAndDown } = useDisplay()

const open = computed({ get: () => !!props.documentId, set: (v) => !v && emit('close') })
const doc = ref<DocumentDetail | null>(null)
const loading = ref(false)
const saving = ref(false)

const allocRows = ref<{ projectId: string | null; category: CostCategory; amount: string }[]>([])
const instRows = ref<{ dueDate: string; amount: string }[]>([])
const notes = ref('')
const ack = ref(false)
const rejectDialog = ref(false)
const cancelDialog = ref(false)
const reason = ref('')
const manual = ref({ supplierCnpj: '', supplierName: '', number: '', issueDate: '', totalAmount: '', description: '' })
const showItems = ref(false)

const editable = computed(() => doc.value && ['RECEBIDO', 'EM_REVISAO'].includes(doc.value.status))
const isManual = computed(() => doc.value && doc.value.type !== 'NFE')
const total = computed(() => doc.value?.totalAmount ?? 0)
const critical = computed(() => doc.value?.issues.filter((i) => i.severity === 'CRITICO') ?? [])
const allocSum = computed(() => allocRows.value.reduce((a, r) => a + parseBRL(r.amount), 0))
const instSum = computed(() => instRows.value.reduce((a, r) => a + parseBRL(r.amount), 0))
const missingData = computed(() => !doc.value?.supplier || !doc.value?.totalAmount || !doc.value?.issueDate)
const canSubmit = computed(
  () =>
    editable.value &&
    !missingData.value &&
    allocRows.value.length > 0 &&
    allocRows.value.every((r) => r.projectId && parseBRL(r.amount) > 0) &&
    allocSum.value === total.value &&
    instRows.value.every((r) => r.dueDate && parseBRL(r.amount) > 0) &&
    instSum.value === total.value &&
    (!critical.value.length || ack.value),
)

function addDays(isoDate: string | null, days: number) {
  const d = isoDate ? new Date(isoDate) : new Date()
  return new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10)
}

function resetForm(d: DocumentDetail) {
  allocRows.value = [{ projectId: d.suggestedProjectId, category: d.category ?? 'MATERIAIS', amount: centsToInput(d.totalAmount ?? 0) }]
  instRows.value = d.installmentsFromXml.length
    ? d.installmentsFromXml.map((i) => ({ dueDate: i.dueDate, amount: centsToInput(i.amountCents) }))
    : [{ dueDate: addDays(d.issueDate, 30), amount: centsToInput(d.totalAmount ?? 0) }]
  notes.value = ''
  ack.value = false
  manual.value = {
    supplierCnpj: d.supplier?.cnpj ?? '',
    supplierName: d.supplier?.name ?? '',
    number: d.number ?? '',
    issueDate: d.issueDate ? d.issueDate.slice(0, 10) : '',
    totalAmount: d.totalAmount ? centsToInput(d.totalAmount) : '',
    description: d.description ?? '',
  }
}

async function load() {
  if (!props.documentId) return
  loading.value = true
  try {
    await projects.ensure()
    doc.value = await api.get<DocumentDetail>(`/api/documents/${props.documentId}`)
    resetForm(doc.value)
  } catch (e) {
    toastError(e)
    emit('close')
  } finally {
    loading.value = false
  }
}
watch(() => props.documentId, (id) => {
  doc.value = null
  if (id) load()
}, { immediate: true })

function addAllocation() {
  const remaining = Math.max(total.value - allocSum.value, 0)
  allocRows.value.push({ projectId: null, category: allocRows.value[0]?.category ?? 'MATERIAIS', amount: centsToInput(remaining) })
}
function splitEvenly() {
  const n = allocRows.value.length
  const base = Math.floor(total.value / n)
  allocRows.value.forEach((r, i) => (r.amount = centsToInput(i === n - 1 ? total.value - base * (n - 1) : base)))
}
function addInstallment() {
  const last = instRows.value[instRows.value.length - 1]
  instRows.value.push({ dueDate: addDays(last?.dueDate ?? doc.value?.issueDate ?? null, 30), amount: centsToInput(Math.max(total.value - instSum.value, 0)) })
}

async function saveManual() {
  if (!doc.value) return
  saving.value = true
  try {
    const m = manual.value
    doc.value = await api.patch<DocumentDetail>(`/api/documents/${doc.value.id}`, {
      ...(m.supplierCnpj && { supplierCnpj: m.supplierCnpj, supplierName: m.supplierName || undefined }),
      number: m.number || undefined,
      issueDate: m.issueDate || undefined,
      totalAmount: m.totalAmount ? parseBRL(m.totalAmount) : undefined,
      description: m.description || undefined,
    })
    resetForm(doc.value)
    toast('Dados salvos')
    emit('changed')
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

async function saveSuggestion() {
  // guarda a obra/categoria escolhida mesmo sem aprovar (útil para quem só confere)
  if (!doc.value || !allocRows.value[0]?.projectId) return
  try {
    await api.patch(`/api/documents/${doc.value.id}`, { suggestedProjectId: allocRows.value[0].projectId, category: allocRows.value[0].category })
    toast('Obra vinculada. A nota segue aguardando aprovação.')
    emit('changed')
  } catch (e) {
    toastError(e)
  }
}

async function approve() {
  if (!doc.value) return
  saving.value = true
  try {
    doc.value = await api.post<DocumentDetail>(`/api/documents/${doc.value.id}/approve`, {
      allocations: allocRows.value.map((r) => ({ projectId: r.projectId, category: r.category, amount: parseBRL(r.amount) })),
      installments: instRows.value.map((r) => ({ dueDate: r.dueDate, amount: parseBRL(r.amount) })),
      notes: notes.value || undefined,
      acknowledgeCritical: ack.value || undefined,
    })
    toast('Nota aprovada: custo apropriado e títulos lançados.')
    emit('changed')
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

async function reject() {
  if (!doc.value) return
  try {
    doc.value = await api.post<DocumentDetail>(`/api/documents/${doc.value.id}/reject`, { reason: reason.value })
    rejectDialog.value = false
    reason.value = ''
    toast('Nota rejeitada', 'info')
    emit('changed')
  } catch (e) {
    toastError(e)
  }
}

async function cancel() {
  if (!doc.value) return
  try {
    doc.value = await api.post<DocumentDetail>(`/api/documents/${doc.value.id}/cancel`, { reason: reason.value })
    cancelDialog.value = false
    reason.value = ''
    toast('Nota cancelada: apropriação e títulos estornados.', 'info')
    emit('changed')
  } catch (e) {
    toastError(e instanceof ApiError && e.code === 'POSSUI_PAGAMENTO' ? new Error(e.message) : e)
  }
}

async function openFile() {
  if (!doc.value) return
  try {
    await api.openFile(`/api/documents/${doc.value.id}/file`)
  } catch (e) {
    toastError(e)
  }
}
</script>

<template>
  <v-dialog v-model="open" :fullscreen="smAndDown" max-width="1180" scrollable>
    <v-card v-if="!doc" class="pa-10 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></v-card>
    <v-card v-else>
      <v-card-title class="d-flex align-center ga-3 py-4 px-6">
        <div>
          <div class="text-h6 font-weight-bold">
            {{ doc.type === 'NFE' ? 'NF-e' : 'Documento' }} {{ doc.number ? `nº ${doc.number}` : '' }}
            <v-chip :color="DOC_STATUS[doc.status].color" variant="tonal" class="ml-2">{{ DOC_STATUS[doc.status].label }}</v-chip>
          </div>
          <div class="text-caption muted">Recebida via {{ SOURCE[doc.source] }} em {{ date(doc.createdAt) }} · {{ doc.fileName }}</div>
        </div>
        <v-spacer />
        <v-btn v-if="doc.hasFile" variant="text" prepend-icon="mdi-file-eye-outline" @click="openFile">Arquivo original</v-btn>
        <v-btn icon="mdi-close" variant="text" @click="emit('close')" />
      </v-card-title>
      <v-divider />

      <v-card-text class="pa-6">
        <v-row>
          <!-- Coluna: o que foi lido -->
          <v-col cols="12" md="6">
            <v-card class="pa-4 mb-4">
              <div class="card-title mb-3">Dados extraídos</div>
              <template v-if="isManual && editable">
                <v-alert type="info" variant="tonal" density="compact" class="mb-3">Documento sem XML: preencha os dados abaixo.</v-alert>
                <v-row dense>
                  <v-col cols="6"><v-text-field v-model="manual.supplierCnpj" label="CNPJ do fornecedor" /></v-col>
                  <v-col cols="6"><v-text-field v-model="manual.supplierName" label="Nome (se novo)" /></v-col>
                  <v-col cols="4"><v-text-field v-model="manual.number" label="Número" /></v-col>
                  <v-col cols="4"><v-text-field v-model="manual.issueDate" type="date" label="Emissão" /></v-col>
                  <v-col cols="4"><v-text-field v-model="manual.totalAmount" label="Valor (R$)" /></v-col>
                  <v-col cols="12"><v-text-field v-model="manual.description" label="Descrição" /></v-col>
                </v-row>
                <v-btn class="mt-3" color="primary" variant="tonal" :loading="saving" @click="saveManual">Salvar dados</v-btn>
              </template>
              <dl v-else class="facts">
                <dt>Fornecedor</dt>
                <dd>
                  {{ doc.supplier?.name ?? doc.issuer?.name ?? '—' }}
                  <v-chip v-if="doc.supplier?.status === 'PENDENTE'" color="warning" variant="tonal" class="ml-1">não homologado</v-chip>
                  <v-chip v-if="doc.supplier?.status === 'BLOQUEADO'" color="error" variant="tonal" class="ml-1">bloqueado</v-chip>
                </dd>
                <dt>CNPJ</dt>
                <dd>{{ cnpj(doc.supplier?.cnpj ?? doc.issuer?.cnpj) }}</dd>
                <dt>Nº da nota</dt>
                <dd>{{ doc.number ?? '—' }}{{ doc.series ? ` · série ${doc.series}` : '' }}</dd>
                <dt>Emissão</dt>
                <dd>{{ date(doc.issueDate) }}</dd>
                <dt>Valor</dt>
                <dd class="font-weight-bold money">{{ brl(doc.totalAmount) }}</dd>
                <dt>Descrição</dt>
                <dd>{{ doc.description ?? '—' }}</dd>
                <dt v-if="doc.extraInfo">Info. complementar</dt>
                <dd v-if="doc.extraInfo" class="text-caption">{{ doc.extraInfo }}</dd>
                <dt>Obra sugerida</dt>
                <dd>
                  {{ doc.suggestedProjectId ? projects.nameOf(doc.suggestedProjectId) : 'não identificada' }}
                  <div v-if="doc.suggestionReason" class="text-caption muted">{{ doc.suggestionReason }}</div>
                </dd>
                <dt v-if="doc.accessKey">Chave</dt>
                <dd v-if="doc.accessKey" class="text-caption" style="word-break: break-all">{{ doc.accessKey }}</dd>
              </dl>
            </v-card>

            <v-card v-if="doc.issues.length" class="pa-4 mb-4">
              <div class="card-title mb-3">Validação</div>
              <div v-for="i in doc.issues" :key="i.code" class="d-flex ga-2 mb-2 text-body-2">
                <v-icon size="18" :color="SEVERITY[i.severity].color">{{ SEVERITY[i.severity].icon }}</v-icon>
                <span>{{ i.message }}</span>
              </div>
            </v-card>
            <v-card v-else-if="doc.type === 'NFE'" class="pa-4 mb-4 d-flex align-center ga-3">
              <v-icon color="success" size="28">mdi-check-circle</v-icon>
              <div class="text-body-2">Dados extraídos e validados sem pendências.</div>
            </v-card>

            <v-card v-if="doc.items.length" class="pa-4">
              <div class="d-flex align-center justify-space-between">
                <div class="card-title">Itens ({{ doc.items.length }})</div>
                <v-btn variant="text" size="small" @click="showItems = !showItems">{{ showItems ? 'ocultar' : 'mostrar' }}</v-btn>
              </div>
              <v-table v-if="showItems" density="compact" class="mt-2">
                <thead>
                  <tr><th>Descrição</th><th class="text-right">Qtd</th><th class="text-right">Unit.</th><th class="text-right">Total</th></tr>
                </thead>
                <tbody>
                  <tr v-for="it in doc.items" :key="it.id">
                    <td>{{ it.description }}</td>
                    <td class="text-right money">{{ Number(it.quantity).toLocaleString('pt-BR') }} {{ it.unit }}</td>
                    <td class="text-right money">{{ Number(it.unitPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }}</td>
                    <td class="text-right money">{{ brl(it.total) }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </v-col>

          <!-- Coluna: decisão -->
          <v-col cols="12" md="6">
            <template v-if="editable">
              <v-card class="pa-4 mb-4">
                <div class="d-flex align-center justify-space-between mb-3">
                  <div class="card-title">Vínculo com a obra</div>
                  <div>
                    <v-btn v-if="allocRows.length > 1" size="small" variant="text" @click="splitEvenly">dividir igualmente</v-btn>
                    <v-btn size="small" variant="tonal" prepend-icon="mdi-call-split" @click="addAllocation">Ratear</v-btn>
                  </div>
                </div>
                <div v-for="(r, i) in allocRows" :key="i" class="alloc-row mb-2">
                  <v-select v-model="r.projectId" :items="projects.active" item-title="name" item-value="id" label="Obra" />
                  <v-select v-model="r.category" :items="CATEGORIES" label="Categoria" />
                  <v-text-field v-model="r.amount" label="Valor (R$)" class="amount" />
                  <v-btn v-if="allocRows.length > 1" icon="mdi-close" variant="text" size="small" @click="allocRows.splice(i, 1)" />
                </div>
                <div class="text-caption mt-1" :class="allocSum === total ? 'text-success' : 'text-error'">
                  Apropriado {{ brl(allocSum) }} de {{ brl(total) }}
                  <span v-if="allocSum !== total"> · diferença {{ brl(total - allocSum) }}</span>
                </div>
                <v-btn v-if="allocRows.length === 1 && allocRows[0].projectId !== doc.suggestedProjectId" size="small" variant="text" class="mt-1 px-0" @click="saveSuggestion">
                  Só vincular a obra (sem aprovar)
                </v-btn>
              </v-card>

              <v-card class="pa-4 mb-4">
                <div class="d-flex align-center justify-space-between mb-3">
                  <div class="card-title">Títulos a pagar</div>
                  <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addInstallment">Parcela</v-btn>
                </div>
                <div v-for="(r, i) in instRows" :key="i" class="inst-row mb-2">
                  <span class="text-caption muted" style="width: 34px">{{ i + 1 }}/{{ instRows.length }}</span>
                  <v-text-field v-model="r.dueDate" type="date" label="Vencimento" />
                  <v-text-field v-model="r.amount" label="Valor (R$)" class="amount" />
                  <v-btn v-if="instRows.length > 1" icon="mdi-close" variant="text" size="small" @click="instRows.splice(i, 1)" />
                </div>
                <div class="text-caption" :class="instSum === total ? 'text-success' : 'text-error'">
                  Parcelas somam {{ brl(instSum) }} de {{ brl(total) }}
                </div>
                <div v-if="doc.installmentsFromXml.length" class="text-caption muted mt-1">Vencimentos lidos das duplicatas do XML.</div>
              </v-card>

              <v-textarea v-model="notes" label="Observação (opcional)" rows="2" class="mb-3" />
              <v-alert v-if="critical.length" type="error" variant="tonal" density="compact" class="mb-3">
                <v-checkbox v-model="ack" density="compact" hide-details color="error">
                  <template #label><span class="text-body-2">Conferi as pendências críticas e quero aprovar mesmo assim.</span></template>
                </v-checkbox>
              </v-alert>
              <v-alert v-if="missingData" type="warning" variant="tonal" density="compact" class="mb-3">Preencha fornecedor, data e valor antes de aprovar.</v-alert>

              <div class="d-flex ga-2 flex-wrap">
                <v-btn color="primary" size="large" :disabled="!canSubmit || !auth.canApprove" :loading="saving" prepend-icon="mdi-check" @click="approve">
                  Aprovar e lançar
                </v-btn>
                <v-btn variant="outlined" color="error" size="large" :disabled="!auth.canApprove" @click="rejectDialog = true">Rejeitar</v-btn>
              </div>
              <div v-if="!auth.canApprove" class="text-caption muted mt-2">Seu perfil pode conferir, mas a aprovação é do financeiro.</div>
            </template>

            <template v-else>
              <v-card v-if="doc.allocations.length" class="pa-4 mb-4">
                <div class="card-title mb-3">Apropriação</div>
                <div v-for="a in doc.allocations" :key="a.id" class="d-flex justify-space-between text-body-2 mb-1">
                  <router-link class="link" :to="{ name: 'project', params: { id: a.projectId } }">{{ a.projectName }}</router-link>
                  <span class="muted">{{ categoryLabel(a.category) }}</span>
                  <span class="money font-weight-medium">{{ brl(a.amount) }}</span>
                </div>
              </v-card>
              <v-card v-if="doc.payables.length" class="pa-4 mb-4">
                <div class="card-title mb-3">Títulos</div>
                <v-table density="compact">
                  <tbody>
                    <tr v-for="p in doc.payables" :key="p.id">
                      <td>{{ p.installment }}</td>
                      <td>{{ date(p.dueDate) }}</td>
                      <td class="text-right money">{{ brl(p.amount) }}</td>
                      <td class="text-right"><v-chip :color="PAYABLE_STATUS[p.status].color" variant="tonal">{{ PAYABLE_STATUS[p.status].label }}</v-chip></td>
                    </tr>
                  </tbody>
                </v-table>
              </v-card>
              <v-alert v-if="doc.reviewNotes" variant="tonal" density="compact" class="mb-4" icon="mdi-note-text-outline">{{ doc.reviewNotes }}</v-alert>
              <v-btn v-if="doc.status === 'APROVADO' && auth.canApprove" variant="outlined" color="error" @click="cancelDialog = true">Cancelar nota</v-btn>
            </template>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-dialog v-model="rejectDialog" max-width="460">
      <v-card class="pa-5">
        <div class="card-title mb-3">Rejeitar nota</div>
        <v-textarea v-model="reason" label="Motivo" rows="3" autofocus />
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="rejectDialog = false">Voltar</v-btn>
          <v-btn color="error" :disabled="reason.trim().length < 3" @click="reject">Rejeitar</v-btn>
        </div>
      </v-card>
    </v-dialog>
    <v-dialog v-model="cancelDialog" max-width="460">
      <v-card class="pa-5">
        <div class="card-title mb-1">Cancelar nota aprovada</div>
        <div class="text-body-2 muted mb-3">Remove a apropriação nas obras e cancela os títulos em aberto. Não é possível se já houver pagamento.</div>
        <v-textarea v-model="reason" label="Motivo" rows="3" autofocus />
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="cancelDialog = false">Voltar</v-btn>
          <v-btn color="error" :disabled="reason.trim().length < 3" @click="cancel">Cancelar nota</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: 130px 1fr;
  row-gap: 8px;
  font-size: 0.88rem;
}
.facts dt {
  color: var(--oo-muted);
}
.alloc-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 130px auto;
  gap: 8px;
  align-items: center;
}
.inst-row {
  display: grid;
  grid-template-columns: auto 1fr 130px auto;
  gap: 8px;
  align-items: center;
}
@media (max-width: 600px) {
  .alloc-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
