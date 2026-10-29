<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AlertItem from '@/components/AlertItem.vue'
import { api } from '@/lib/api'
import { SEVERITY, date } from '@/lib/format'
import { toastError } from '@/lib/toast'

interface Alert {
  id: string
  type: string
  severity: string
  status: string
  title: string
  message: string
  projectId: string | null
  documentId: string | null
  projectName: string | null
  supplierName: string | null
  createdAt: string
}

const router = useRouter()
const status = ref('ABERTO')
const rows = ref<Alert[]>([])
const loading = ref(false)

const TYPE_LABEL: Record<string, string> = {
  ORCAMENTO: 'Orçamento',
  DUPLICIDADE: 'Duplicidade',
  PRECO: 'Preço',
  DADOS: 'Dados',
  DESTINATARIO: 'Destinatário',
  OBRA_NAO_IDENTIFICADA: 'Obra não identificada',
  VENCIMENTO: 'Vencimento',
  ECONOMIA: 'Economia',
}

async function load() {
  loading.value = true
  try {
    rows.value = await api.get<Alert[]>(`/api/alerts?status=${status.value}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(status, load)

const groups = computed(() =>
  ['CRITICO', 'ATENCAO', 'OPORTUNIDADE', 'INFO']
    .map((sev) => ({ sev, items: rows.value.filter((r) => r.severity === sev) }))
    .filter((g) => g.items.length),
)

async function act(a: Alert, action: 'resolve' | 'ignore' | 'reopen') {
  try {
    await api.post(`/api/alerts/${a.id}/${action}`)
    rows.value = rows.value.filter((r) => r.id !== a.id)
  } catch (e) {
    toastError(e)
  }
}
function open(a: Alert) {
  if (a.documentId) router.push({ name: 'documents', query: { doc: a.documentId, tab: 'todas' } })
  else if (a.projectId) router.push({ name: 'project', params: { id: a.projectId } })
}
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Inteligência</div>
      <div class="page-subtitle">
        Alertas gerados por regras explicáveis: orçamento, duplicidade, preço, vencimentos e dados da nota. Cada alerta diz por que apareceu.
      </div>
    </div>
    <v-btn-toggle v-model="status" mandatory color="primary" variant="outlined" density="comfortable" divided>
      <v-btn value="ABERTO">Abertos</v-btn>
      <v-btn value="RESOLVIDO,IGNORADO">Encerrados</v-btn>
    </v-btn-toggle>
  </div>

  <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
  <div v-for="g in groups" :key="g.sev" class="mb-6">
    <div class="d-flex align-center mb-2">
      <v-icon :color="SEVERITY[g.sev].color" class="mr-2">{{ SEVERITY[g.sev].icon }}</v-icon>
      <span class="card-title">{{ SEVERITY[g.sev].label }}</span>
      <v-chip class="ml-2" variant="tonal">{{ g.items.length }}</v-chip>
    </div>
    <div class="d-flex flex-column ga-2">
      <AlertItem v-for="a in g.items" :key="a.id" :alert="a" @open="open(a)">
        <div class="d-flex flex-column align-end ga-1" @click.stop>
          <div class="text-caption muted text-no-wrap">{{ TYPE_LABEL[a.type] }} · {{ date(a.createdAt) }}</div>
          <div v-if="status === 'ABERTO'" class="d-flex ga-1">
            <v-btn size="x-small" variant="tonal" color="primary" @click="act(a, 'resolve')">Resolver</v-btn>
            <v-btn size="x-small" variant="text" @click="act(a, 'ignore')">Ignorar</v-btn>
          </div>
          <v-btn v-else size="x-small" variant="text" @click="act(a, 'reopen')">Reabrir</v-btn>
        </div>
      </AlertItem>
    </div>
  </div>
  <v-card v-if="!loading && !groups.length" class="pa-8 text-center muted">Nenhum alerta {{ status === 'ABERTO' ? 'aberto' : 'encerrado' }}.</v-card>
</template>
