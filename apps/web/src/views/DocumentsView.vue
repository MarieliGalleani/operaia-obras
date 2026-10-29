<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocumentFlow from '@/components/DocumentFlow.vue'
import DocumentReview from '@/components/DocumentReview.vue'
import UploadZone from '@/components/UploadZone.vue'
import { api } from '@/lib/api'
import { DOC_STATUS, SEVERITY, SOURCE, brl, categoryLabel, date } from '@/lib/format'
import { toastError } from '@/lib/toast'
import type { Issue } from '@/lib/types'
import { useProjects } from '@/stores/projects'

interface Row {
  id: string
  type: string
  status: string
  source: string
  number: string | null
  issueDate: string | null
  totalAmount: number | null
  description: string | null
  category: string | null
  supplierName: string | null
  suggestedProjectId: string | null
  projectNames: string | null
  issues: Issue[]
}

const route = useRoute()
const router = useRouter()
const projects = useProjects()
const tabs = [
  { value: 'revisar', title: 'Para conferir', status: 'RECEBIDO,EM_REVISAO' },
  { value: 'aprovadas', title: 'Aprovadas', status: 'APROVADO' },
  { value: 'rejeitadas', title: 'Rejeitadas/canceladas', status: 'REJEITADO,CANCELADO' },
  { value: 'todas', title: 'Todas', status: '' },
]
const tab = ref((route.query.tab as string) || 'revisar')
const q = ref((route.query.q as string) || '')
const rows = ref<Row[]>([])
const loading = ref(false)
const openId = ref<string | null>((route.query.doc as string) || null)

const headers = [
  { title: 'Nota', key: 'number', width: 130 },
  { title: 'Fornecedor', key: 'supplierName' },
  { title: 'Emissão', key: 'issueDate', width: 110 },
  { title: 'Obra', key: 'project' },
  { title: 'Categoria', key: 'category' },
  { title: 'Valor', key: 'totalAmount', align: 'end' as const },
  { title: 'Situação', key: 'status' },
]

async function load() {
  loading.value = true
  try {
    await projects.ensure()
    const status = tabs.find((t) => t.value === tab.value)?.status ?? ''
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (q.value.trim()) params.set('q', q.value.trim())
    rows.value = await api.get<Row[]>(`/api/documents?${params}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(tab, load)
watch(
  () => route.query,
  (qq) => {
    if (qq.q !== undefined) q.value = qq.q as string
    if (qq.tab) tab.value = qq.tab as string
    if (qq.doc) openId.value = qq.doc as string
    load()
  },
)

function openDoc(id: string) {
  openId.value = id
  router.replace({ query: { ...route.query, doc: id } })
}
function closeDoc() {
  openId.value = null
  const { doc: _d, ...rest } = route.query
  router.replace({ query: rest })
}
const worstIssue = (issues: Issue[]) => issues.find((i) => i.severity === 'CRITICO') ?? issues.find((i) => i.severity === 'ATENCAO')
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Notas Fiscais</div>
      <div class="page-subtitle">Toda nota passa por leitura, validação e vínculo com a obra antes de virar custo e título a pagar.</div>
    </div>
  </div>

  <v-card class="pa-5 mb-4">
    <DocumentFlow />
  </v-card>

  <v-row dense class="mb-2">
    <v-col cols="12">
      <v-card class="pa-5">
        <UploadZone @done="load(); tab = 'revisar'" @open="openDoc" />
      </v-card>
    </v-col>
  </v-row>

  <v-card>
    <div class="d-flex align-center flex-wrap ga-3 px-4 pt-3">
      <v-tabs v-model="tab" color="primary" density="comfortable">
        <v-tab v-for="t in tabs" :key="t.value" :value="t.value" class="text-none">{{ t.title }}</v-tab>
      </v-tabs>
      <v-spacer />
      <v-text-field v-model="q" placeholder="Número, fornecedor, item…" prepend-inner-icon="mdi-magnify" style="max-width: 300px" clearable @keyup.enter="load" @click:clear="q = ''; load()" />
    </div>
    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      items-per-page="25"
      class="clickable-rows"
      no-data-text="Nenhuma nota aqui."
      @click:row="(_: unknown, { item }: { item: Row }) => openDoc(item.id)"
    >
      <template #item.number="{ item }">
        <div class="font-weight-medium">{{ item.number ?? 's/ nº' }}</div>
        <div class="text-caption muted text-no-wrap">{{ item.type === 'NFE' ? 'NF-e' : 'Arquivo' }} · {{ SOURCE[item.source] }}</div>
      </template>
      <template #item.supplierName="{ item }">
        <div class="text-truncate" style="max-width: 240px">{{ item.supplierName ?? '—' }}</div>
        <div class="text-caption muted text-truncate" style="max-width: 240px">{{ item.description }}</div>
      </template>
      <template #item.issueDate="{ item }">{{ date(item.issueDate) }}</template>
      <template #item.project="{ item }">
        <span v-if="item.projectNames">{{ item.projectNames }}</span>
        <span v-else-if="item.suggestedProjectId" class="muted">{{ projects.nameOf(item.suggestedProjectId) }} (sugerida)</span>
        <span v-else class="text-warning">não identificada</span>
      </template>
      <template #item.category="{ item }">{{ categoryLabel(item.category) }}</template>
      <template #item.totalAmount="{ item }"><span class="money">{{ brl(item.totalAmount) }}</span></template>
      <template #item.status="{ item }">
        <v-chip :color="DOC_STATUS[item.status].color" variant="tonal">{{ DOC_STATUS[item.status].label }}</v-chip>
        <v-tooltip v-if="worstIssue(item.issues)" :text="worstIssue(item.issues)!.message" location="top">
          <template #activator="{ props }">
            <v-icon v-bind="props" size="18" class="ml-1" :color="SEVERITY[worstIssue(item.issues)!.severity].color">{{ SEVERITY[worstIssue(item.issues)!.severity].icon }}</v-icon>
          </template>
        </v-tooltip>
      </template>
    </v-data-table>
  </v-card>

  <DocumentReview :document-id="openId" @close="closeDoc" @changed="load" />
</template>
