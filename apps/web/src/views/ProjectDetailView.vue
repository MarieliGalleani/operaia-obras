<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AlertItem from '@/components/AlertItem.vue'
import DocumentReview from '@/components/DocumentReview.vue'
import KpiCard from '@/components/KpiCard.vue'
import ProjectThumb from '@/components/ProjectThumb.vue'
import StackBar from '@/components/StackBar.vue'
import { api } from '@/lib/api'
import { CATEGORIES, DOC_STATUS, PAYABLE_STATUS, brl, categoryColor, date, pct } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface Detail {
  id: string
  code: string
  name: string
  address: string | null
  status: string
  budgetTotal: number
  imageUrl: string | null
  financials: { budget: number; appropriated: number; paid: number; open: number; committedPct: number; byCategory: Record<string, { budget: number; appropriated: number }> }
  documents: { id: string; number: string | null; status: string; supplierName: string | null; issueDate: string | null; totalAmount: number | null; description: string | null }[]
  payables: { id: string; dueDate: string; amount: number; paidAmount: number; status: string; supplierName: string | null; installment: string; documentNumber: string | null }[]
  alerts: { id: string; severity: string; title: string; message: string; documentId: string | null; projectId: string | null }[]
}

const route = useRoute()
const router = useRouter()
const data = ref<Detail | null>(null)
const tab = ref('custos')
const openDoc = ref<string | null>(null)

async function load() {
  try {
    data.value = await api.get<Detail>(`/api/projects/${route.params.id}`)
  } catch (e) {
    toastError(e)
    router.replace({ name: 'projects' })
  }
}
onMounted(load)
watch(() => route.params.id, load)

const categories = computed(() => {
  const by = data.value?.financials.byCategory ?? {}
  return CATEGORIES.map((c) => ({ ...c, budget: by[c.value]?.budget ?? 0, appropriated: by[c.value]?.appropriated ?? 0 })).filter((c) => c.budget || c.appropriated)
})
const auth = useAuth()
const canEdit = computed(() => ['ADMIN', 'GESTOR_OBRA'].includes(auth.me?.user.role ?? ''))
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
async function onPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || !data.value) return
  if (file.size > 5 * 1024 * 1024) return toast('A foto pode ter no máximo 5 MB.', 'warning')
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await api.post<{ imageUrl: string }>(`/api/projects/${data.value.id}/image`, form)
    data.value.imageUrl = res.imageUrl
    toast('Foto da obra atualizada')
  } catch (err) {
    toastError(err)
  } finally {
    uploading.value = false
  }
}
async function removePhoto() {
  if (!data.value) return
  try {
    await api.request('DELETE', `/api/projects/${data.value.id}/image`)
    data.value.imageUrl = null
    toast('Foto removida')
  } catch (err) {
    toastError(err)
  }
}
const balance = computed(() => (data.value ? data.value.budgetTotal - data.value.financials.paid - data.value.financials.open : 0))
</script>

<template>
  <div v-if="!data" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
  <template v-else>
    <div class="d-flex align-center ga-4 mb-6 flex-wrap">
      <v-btn icon="mdi-arrow-left" variant="text" to="/obras" />
      <div class="photo-wrap">
        <ProjectThumb :name="data.name" :image-url="data.imageUrl" :size="120" />
        <v-menu v-if="canEdit">
          <template #activator="{ props }">
            <v-btn v-bind="props" class="photo-btn" size="x-small" icon="mdi-camera-outline" color="surface" :loading="uploading" aria-label="Foto da obra" />
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-image-plus-outline" :title="data.imageUrl ? 'Trocar foto' : 'Adicionar foto'" @click="fileInput?.click()" />
            <v-list-item v-if="data.imageUrl" prepend-icon="mdi-delete-outline" title="Remover foto" @click="removePhoto" />
          </v-list>
        </v-menu>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onPhoto" />
      </div>
      <div>
        <div class="text-caption muted">{{ data.code }} · {{ data.status === 'ATIVA' ? 'Em andamento' : data.status }}</div>
        <div class="page-title">{{ data.name }}</div>
        <div class="page-subtitle">{{ data.address }}</div>
      </div>
    </div>

    <v-row dense class="mb-2">
      <v-col cols="6" md="3"><KpiCard label="Orçamento" :value="brl(data.budgetTotal, { compact: true })" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="Pago" :value="brl(data.financials.paid, { compact: true })" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="A pagar" :value="brl(data.financials.open, { compact: true })" /></v-col>
      <v-col cols="6" md="3">
        <KpiCard label="Saldo do orçamento" :value="brl(balance, { compact: true })" :value-color="balance < 0 ? 'error' : undefined" :hint="`${pct(data.financials.committedPct)} comprometido`" :hint-color="data.financials.committedPct >= 90 ? 'error' : undefined" />
      </v-col>
    </v-row>

    <v-card class="pa-5 mb-4">
      <StackBar :paid="data.financials.paid" :open="data.financials.open" :budget="data.budgetTotal" style="height: 12px" />
      <div class="text-caption muted mt-2">
        <span class="mr-4"><span class="legend-dot" style="background: var(--oo-bright)" />Pago</span>
        <span class="mr-4"><span class="legend-dot" style="background: var(--oo-accent)" />A pagar</span>
        <span><span class="legend-dot" style="background: var(--oo-track)" />Saldo</span>
      </div>
    </v-card>

    <div v-if="data.alerts.length" class="d-flex flex-column ga-2 mb-4">
      <AlertItem v-for="a in data.alerts" :key="a.id" :alert="a" @open="a.documentId && (openDoc = a.documentId)" />
    </div>

    <v-card>
      <v-tabs v-model="tab" color="primary" class="px-4">
        <v-tab value="custos" class="text-none">Orçado × apropriado</v-tab>
        <v-tab value="notas" class="text-none">Notas ({{ data.documents.length }})</v-tab>
        <v-tab value="titulos" class="text-none">Títulos ({{ data.payables.length }})</v-tab>
      </v-tabs>
      <v-divider />
      <div v-if="tab === 'custos'" class="pa-5">
        <div v-for="c in categories" :key="c.value" class="mb-4">
          <div class="d-flex justify-space-between text-body-2 mb-1">
            <span><span class="legend-dot" :style="{ background: c.color }" />{{ c.title }}</span>
            <span class="money">
              <strong :class="c.budget && c.appropriated > c.budget ? 'text-error' : ''">{{ brl(c.appropriated) }}</strong>
              <span class="muted"> / {{ c.budget ? brl(c.budget) : 'sem orçamento' }}</span>
            </span>
          </div>
          <v-progress-linear
            :model-value="c.budget ? Math.min((c.appropriated / c.budget) * 100, 100) : 0"
            :color="c.budget && c.appropriated > c.budget ? 'error' : categoryColor(c.value)"
            bg-color="#E9EDEB"
            bg-opacity="1"
            height="8"
            rounded
          />
        </div>
        <div v-if="!categories.length" class="muted">Sem orçamento por categoria nem custos apropriados.</div>
      </div>
      <v-table v-else-if="tab === 'notas'" density="comfortable" class="clickable-rows">
        <thead><tr><th>Nota</th><th>Fornecedor</th><th>Emissão</th><th class="text-right">Valor da nota</th><th>Situação</th></tr></thead>
        <tbody>
          <tr v-for="d in data.documents" :key="d.id" @click="openDoc = d.id">
            <td>{{ d.number }}</td>
            <td><div>{{ d.supplierName }}</div><div class="text-caption muted">{{ d.description }}</div></td>
            <td>{{ date(d.issueDate) }}</td>
            <td class="text-right money">{{ brl(d.totalAmount) }}</td>
            <td><v-chip :color="DOC_STATUS[d.status].color" variant="tonal">{{ DOC_STATUS[d.status].label }}</v-chip></td>
          </tr>
        </tbody>
      </v-table>
      <v-table v-else density="comfortable">
        <thead><tr><th>Vencimento</th><th>Fornecedor</th><th>NF · parcela</th><th class="text-right">Valor do título</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="p in data.payables" :key="p.id">
            <td>{{ date(p.dueDate) }}</td>
            <td>{{ p.supplierName }}</td>
            <td>{{ p.documentNumber }} · {{ p.installment }}</td>
            <td class="text-right money">{{ brl(p.amount) }}</td>
            <td><v-chip :color="PAYABLE_STATUS[p.status].color" variant="tonal">{{ PAYABLE_STATUS[p.status].label }}</v-chip></td>
          </tr>
        </tbody>
      </v-table>
      <div v-if="tab !== 'custos'" class="text-caption muted pa-4">Valores das notas e títulos são totais; se a nota foi rateada, só parte dela pertence a esta obra.</div>
    </v-card>

    <DocumentReview :document-id="openDoc" @close="openDoc = null" @changed="load" />
  </template>
</template>

<style scoped>
.photo-wrap {
  position: relative;
}
.photo-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
}
</style>
