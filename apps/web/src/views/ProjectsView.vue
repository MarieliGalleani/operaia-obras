<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ProjectThumb from '@/components/ProjectThumb.vue'
import StackBar from '@/components/StackBar.vue'
import { api } from '@/lib/api'
import { CATEGORIES, brl, parseBRL, pct, type CostCategory } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'
import { useProjects } from '@/stores/projects'

interface ProjectRow {
  id: string
  code: string
  name: string
  address: string | null
  status: string
  budgetTotal: number
  imageUrl: string | null
  financials: { paid: number; open: number; appropriated: number; committedPct: number }
}

const router = useRouter()
const auth = useAuth()
const store = useProjects()
const rows = ref<ProjectRow[]>([])
const loading = ref(true)
const filter = ref('ATIVA')
const dialog = ref(false)
const saving = ref(false)
const form = ref({ code: '', name: '', address: '', budget: '', startDate: '', budgets: {} as Record<CostCategory, string> })

async function load() {
  loading.value = true
  try {
    rows.value = await api.get<ProjectRow[]>('/api/projects')
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const visible = computed(() => rows.value.filter((r) => !filter.value || r.status === filter.value))
const catSum = computed(() => Object.values(form.value.budgets).reduce((a, v) => a + parseBRL(v), 0))

function newProject() {
  const next = String(rows.value.length + 1).padStart(3, '0')
  form.value = { code: `OBR-${next}`, name: '', address: '', budget: '', startDate: '', budgets: {} as Record<CostCategory, string> }
  dialog.value = true
}
async function save() {
  saving.value = true
  try {
    const budgets = Object.entries(form.value.budgets)
      .filter(([, v]) => parseBRL(v) > 0)
      .map(([category, v]) => ({ category, amount: parseBRL(v) }))
    const p = await api.post<{ id: string }>('/api/projects', {
      code: form.value.code,
      name: form.value.name,
      address: form.value.address || null,
      startDate: form.value.startDate || null,
      budgetTotal: parseBRL(form.value.budget),
      budgets,
    })
    toast('Obra cadastrada')
    dialog.value = false
    await store.ensure(true)
    router.push({ name: 'project', params: { id: p.id } })
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
      <div class="page-title">Obras</div>
      <div class="page-subtitle">Orçamento, custo apropriado e compromissos de cada obra.</div>
    </div>
    <div class="d-flex ga-2 align-center">
      <v-btn-toggle v-model="filter" color="primary" variant="outlined" density="comfortable" divided>
        <v-btn value="ATIVA">Ativas</v-btn>
        <v-btn value="CONCLUIDA">Concluídas</v-btn>
        <v-btn value="">Todas</v-btn>
      </v-btn-toggle>
      <v-btn v-if="auth.me?.user.role !== 'FINANCEIRO'" color="primary" prepend-icon="mdi-plus" @click="newProject">Nova obra</v-btn>
    </div>
  </div>

  <v-row v-if="loading"><v-col v-for="i in 3" :key="i" cols="12" md="6" lg="4"><v-skeleton-loader type="card" /></v-col></v-row>
  <v-row v-else dense>
    <v-col v-for="p in visible" :key="p.id" cols="12" md="6" lg="4">
      <v-card class="pa-4 h-100 project-card" @click="router.push({ name: 'project', params: { id: p.id } })">
        <div class="d-flex ga-3 mb-4">
          <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="76" />
          <div style="min-width: 0">
            <div class="text-caption muted">{{ p.code }}</div>
            <div class="font-weight-bold">{{ p.name }}</div>
            <div class="text-caption muted text-truncate">{{ p.address }}</div>
          </div>
        </div>
        <div class="d-flex justify-space-between text-body-2 mb-1">
          <span :class="p.financials.committedPct >= 90 ? 'text-error font-weight-bold' : 'font-weight-medium'">{{ pct(p.financials.committedPct) }} comprometido</span>
          <span class="money muted">{{ brl(p.budgetTotal, { compact: true }) }}</span>
        </div>
        <StackBar :paid="p.financials.paid" :open="p.financials.open" :budget="p.budgetTotal" />
        <div class="d-flex justify-space-between text-caption mt-3">
          <div><div class="muted">Pago</div><div class="money font-weight-medium">{{ brl(p.financials.paid, { compact: true }) }}</div></div>
          <div><div class="muted">A pagar</div><div class="money font-weight-medium">{{ brl(p.financials.open, { compact: true }) }}</div></div>
          <div class="text-right"><div class="muted">Saldo</div><div class="money font-weight-medium">{{ brl(p.budgetTotal - p.financials.paid - p.financials.open, { compact: true }) }}</div></div>
        </div>
      </v-card>
    </v-col>
    <v-col v-if="!visible.length" cols="12"><v-card class="pa-8 text-center muted">Nenhuma obra neste filtro.</v-card></v-col>
  </v-row>

  <v-dialog v-model="dialog" max-width="640" scrollable>
    <v-card>
      <v-card-title class="pa-5 card-title">Nova obra</v-card-title>
      <v-card-text class="px-5">
        <v-row dense>
          <v-col cols="4"><v-text-field v-model="form.code" label="Código" hint="Use na nota: 'Obra: OBR-005'" persistent-hint /></v-col>
          <v-col cols="8"><v-text-field v-model="form.name" label="Nome da obra" /></v-col>
          <v-col cols="12"><v-text-field v-model="form.address" label="Endereço" /></v-col>
          <v-col cols="6"><v-text-field v-model="form.budget" label="Orçamento total (R$)" /></v-col>
          <v-col cols="6"><v-text-field v-model="form.startDate" type="date" label="Início" /></v-col>
        </v-row>
        <div class="text-body-2 font-weight-bold mt-5 mb-2">Orçamento por categoria (opcional)</div>
        <v-row dense>
          <v-col v-for="c in CATEGORIES" :key="c.value" cols="6" sm="4">
            <v-text-field v-model="form.budgets[c.value]" :label="c.title" />
          </v-col>
        </v-row>
        <div v-if="catSum" class="text-caption mt-2" :class="catSum === parseBRL(form.budget) ? 'text-success' : 'text-warning'">
          Categorias somam {{ brl(catSum) }} de {{ brl(parseBRL(form.budget)) }}
        </div>
      </v-card-text>
      <v-card-actions class="pa-5">
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.name || !form.code || !parseBRL(form.budget)" @click="save">Cadastrar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.project-card {
  cursor: pointer;
  transition: border-color 0.15s;
}
.project-card:hover {
  border-color: var(--oo-bright) !important;
}
</style>
