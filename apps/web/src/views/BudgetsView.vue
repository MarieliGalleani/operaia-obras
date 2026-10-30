<script setup lang="ts">
/**
 * Orçamentos: previsto × realizado por categoria, em todas as obras.
 * Realizado = custo apropriado de notas aprovadas (pago + a pagar).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import ProjectThumb from '@/components/ProjectThumb.vue'
import { api } from '@/lib/api'
import { CATEGORIES, brl, centsToInput, parseBRL, pct, type CostCategory } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface Fin {
  budget: number
  appropriated: number
  paid: number
  open: number
  committedPct: number
  byCategory: Partial<Record<CostCategory, { budget: number; appropriated: number }>>
}
interface Project {
  id: string
  code: string
  name: string
  status: string
  budgetTotal: number
  imageUrl: string | null
  financials: Fin
}

const auth = useAuth()
const router = useRouter()
const canEdit = computed(() => ['ADMIN', 'GESTOR_OBRA'].includes(auth.me?.user.role ?? ''))
const rows = ref<Project[]>([])
const loading = ref(true)
const view = ref<'obra' | 'categoria'>('obra')
const onlyActive = ref(true)

async function load() {
  loading.value = true
  try {
    rows.value = await api.get<Project[]>('/api/projects')
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const visible = computed(() => rows.value.filter((p) => !onlyActive.value || p.status === 'ATIVA'))

/** valor curto para as células: 418 mil, 1,2 mi */
function short(cents: number) {
  const v = cents / 100
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`
  return Math.round(v).toLocaleString('pt-BR')
}
const cat = (p: Project, c: CostCategory) => p.financials.byCategory[c]

/** % usado de um orçamento; null quando não há previsto */
const usage = (spent: number, budget: number) => (budget > 0 ? (spent / budget) * 100 : null)
function tone(p: number | null, spent = 0) {
  if (p == null) return spent > 0 ? 'error' : 'grey'
  if (p >= 100) return 'error'
  if (p >= 90) return 'warning'
  return 'success'
}
const toneLabel = (p: number | null, spent = 0) =>
  p == null ? (spent > 0 ? 'sem previsto' : '—') : p >= 100 ? 'estourado' : p >= 90 ? 'no limite' : 'dentro'

/** categorias que aparecem em alguma obra visível */
const usedCats = computed(() =>
  CATEGORIES.filter((c) => visible.value.some((p) => p.financials.byCategory[c.value]?.budget || p.financials.byCategory[c.value]?.appropriated)),
)

const totals = computed(() => {
  const t = { budget: 0, spent: 0, over: 0, near: 0 }
  for (const p of visible.value) {
    t.budget += p.budgetTotal
    t.spent += p.financials.appropriated
    const u = usage(p.financials.appropriated, p.budgetTotal)
    if (u != null && u >= 100) t.over++
    else if (u != null && u >= 90) t.near++
  }
  return t
})

/** obra × categoria acima de 90% (ou gasto sem previsto) */
const hotspots = computed(() => {
  const out: { project: Project; category: CostCategory; use: number | null; spent: number }[] = []
  for (const p of visible.value)
    for (const c of CATEGORIES) {
      const v = p.financials.byCategory[c.value]
      if (!v) continue
      const u = usage(v.appropriated, v.budget)
      if ((u != null && u >= 90) || (u == null && v.appropriated > 0)) out.push({ project: p, category: c.value, use: u, spent: v.appropriated })
    }
  return out
})
const catOver = computed(() => hotspots.value.filter((h) => h.use == null || h.use >= 100).length)

const byCategory = computed(() =>
  usedCats.value
    .map((c) => {
      let budget = 0
      let spent = 0
      for (const p of visible.value) {
        budget += p.financials.byCategory[c.value]?.budget ?? 0
        spent += p.financials.byCategory[c.value]?.appropriated ?? 0
      }
      return { ...c, budget, spent, use: usage(spent, budget), hot: hotspots.value.filter((h) => h.category === c.value).sort((a, b) => (b.use ?? 999) - (a.use ?? 999)) }
    })
    .sort((a, b) => (b.use ?? 999) - (a.use ?? 999)),
)

// ------------------------------------------------------------ edição
const editing = ref<Project | null>(null)
const form = ref<{ total: string; cats: Record<string, string> }>({ total: '', cats: {} })
const saving = ref(false)
function openEdit(p: Project) {
  editing.value = p
  form.value = {
    total: centsToInput(p.budgetTotal),
    cats: Object.fromEntries(CATEGORIES.map((c) => [c.value, centsToInput(p.financials.byCategory[c.value]?.budget ?? 0)])),
  }
}
const formCatSum = computed(() => Object.values(form.value.cats).reduce((a, v) => a + parseBRL(v), 0))
const formTotal = computed(() => parseBRL(form.value.total))
async function save() {
  if (!editing.value) return
  saving.value = true
  try {
    await api.patch(`/api/projects/${editing.value.id}`, {
      budgetTotal: formTotal.value,
      budgets: CATEGORIES.map((c) => ({ category: c.value, amount: parseBRL(form.value.cats[c.value]) })).filter((b) => b.amount > 0),
    })
    toast('Orçamento atualizado')
    editing.value = null
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
      <div class="page-title">Orçamentos</div>
      <div class="page-subtitle">Previsto × realizado por categoria, em todas as obras. Realizado é o custo das notas aprovadas (pago + a pagar).</div>
    </div>
    <div class="d-flex ga-2 align-center flex-wrap">
      <v-switch v-model="onlyActive" color="primary" density="compact" hide-details inset label="Só obras em andamento" class="mr-2" />
      <v-btn-toggle v-model="view" mandatory density="comfortable" variant="outlined" color="primary" divided>
        <v-btn value="obra" prepend-icon="mdi-office-building-outline">Por obra</v-btn>
        <v-btn value="categoria" prepend-icon="mdi-shape-outline">Por categoria</v-btn>
      </v-btn-toggle>
    </div>
  </div>

  <v-row dense class="mb-2">
    <v-col cols="6" md="3"><KpiCard label="Orçamento previsto" :value="brl(totals.budget, { compact: true })" /></v-col>
    <v-col cols="6" md="3"><KpiCard label="Realizado" :value="brl(totals.spent, { compact: true })" :hint="`${pct(usage(totals.spent, totals.budget))} do previsto`" /></v-col>
    <v-col cols="6" md="3">
      <KpiCard label="Saldo" :value="brl(totals.budget - totals.spent, { compact: true })" :value-color="totals.budget - totals.spent < 0 ? 'error' : undefined" />
    </v-col>
    <v-col cols="6" md="3">
      <KpiCard
        label="Obras no limite"
        :value="String(totals.over + totals.near).padStart(2, '0')"
        :value-color="totals.over ? 'error' : totals.near ? 'warning' : undefined"
        :hint="[totals.over ? `${totals.over} estourada(s)` : '', `${totals.near} acima de 90%`, catOver ? `${catOver} categoria(s) estourada(s)` : ''].filter(Boolean).join(' · ')"
        :hint-color="totals.over || catOver ? 'error' : undefined"
      />
    </v-col>
  </v-row>

  <v-card v-if="loading" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></v-card>

  <!-- POR OBRA: matriz obra × categoria -->
  <v-card v-else-if="view === 'obra'" class="pa-0">
    <div class="matrix-wrap">
      <table class="matrix">
        <thead>
          <tr>
            <th class="sticky">Obra</th>
            <th class="total-col">Total da obra</th>
            <th v-for="c in usedCats" :key="c.value"><span class="legend-dot" :style="{ background: c.color }" />{{ c.title }}</th>
            <th v-if="canEdit" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in visible" :key="p.id">
            <td class="sticky">
              <button class="obra" type="button" @click="router.push(`/obras/${p.id}`)">
                <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="44" />
                <span class="text-left">
                  <span class="d-block font-weight-medium">{{ p.name }}</span>
                  <span class="d-block text-caption muted">{{ p.code }}</span>
                </span>
              </button>
            </td>
            <td class="total-col">
              <div class="cell-num money font-weight-bold">
                R$ {{ short(p.financials.appropriated) }}
                <span class="muted font-weight-regular">/ {{ short(p.budgetTotal) }}</span>
              </div>
              <v-progress-linear
                :model-value="Math.min(100, usage(p.financials.appropriated, p.budgetTotal) ?? 0)"
                :color="tone(usage(p.financials.appropriated, p.budgetTotal))"
                bg-color="grey-lighten-2"
                height="8"
                rounded
                class="my-1"
              />
              <v-chip size="x-small" variant="tonal" :color="tone(usage(p.financials.appropriated, p.budgetTotal))">
                {{ pct(usage(p.financials.appropriated, p.budgetTotal)) }} · {{ toneLabel(usage(p.financials.appropriated, p.budgetTotal)) }}
              </v-chip>
            </td>
            <td v-for="c in usedCats" :key="c.value">
              <template v-if="cat(p, c.value)">
                <div class="d-flex flex-column">
                  <b :class="`text-${tone(usage(cat(p, c.value)!.appropriated, cat(p, c.value)!.budget), cat(p, c.value)!.appropriated)}`">
                    {{ usage(cat(p, c.value)!.appropriated, cat(p, c.value)!.budget) != null ? pct(usage(cat(p, c.value)!.appropriated, cat(p, c.value)!.budget)) : 'sem previsto' }}
                  </b>
                  <span class="text-caption muted money">{{ short(cat(p, c.value)!.appropriated) }} / {{ short(cat(p, c.value)!.budget) }}</span>
                </div>
                <v-progress-linear
                  :model-value="Math.min(100, usage(cat(p, c.value)!.appropriated, cat(p, c.value)!.budget) ?? 100)"
                  :color="tone(usage(cat(p, c.value)!.appropriated, cat(p, c.value)!.budget), cat(p, c.value)!.appropriated)"
                  bg-color="grey-lighten-2"
                  height="6"
                  rounded
                  class="mt-1"
                />
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td v-if="canEdit" class="text-right">
              <v-btn icon="mdi-pencil-outline" size="small" variant="text" :aria-label="`Editar orçamento de ${p.name}`" @click="openEdit(p)" />
            </td>
          </tr>
          <tr v-if="!visible.length"><td :colspan="usedCats.length + 3" class="pa-8 text-center muted">Nenhuma obra.</td></tr>
        </tbody>
      </table>
    </div>
  </v-card>

  <!-- POR CATEGORIA: soma de todas as obras -->
  <v-card v-else class="pa-5">
    <div class="card-title mb-1">Todas as obras somadas</div>
    <div class="text-body-2 muted mb-5">Ordenado da categoria mais consumida para a menos consumida. Abaixo de cada uma, as obras em que ela já passou de 90%.</div>
    <div v-for="c in byCategory" :key="c.value" class="cat-row">
      <div class="d-flex align-center ga-2 cat-name"><span class="legend-dot" :style="{ background: c.color }" />{{ c.title }}</div>
      <div class="flex-grow-1">
        <v-progress-linear :model-value="Math.min(100, c.use ?? 100)" :color="tone(c.use, c.spent)" bg-color="grey-lighten-2" height="14" rounded />
      </div>
      <div class="cat-num money text-right">
        <b>{{ brl(c.spent, { compact: true }) }}</b> <span class="muted">/ {{ brl(c.budget, { compact: true }) }}</span>
      </div>
      <v-chip size="small" variant="tonal" :color="tone(c.use, c.spent)" class="cat-chip">{{ c.use != null ? pct(c.use) : 'sem previsto' }}</v-chip>
      <div v-if="c.hot.length" class="cat-hot">
        <v-icon size="16" color="warning" class="mr-1">mdi-alert-circle-outline</v-icon>
        <span v-for="(h, i) in c.hot" :key="h.project.id">
          <a href="#" :class="`text-${tone(h.use, h.spent)}`" @click.prevent="router.push(`/obras/${h.project.id}`)">{{ h.project.name }} {{ h.use != null ? pct(h.use) : 'sem previsto' }}</a><span v-if="i < c.hot.length - 1" class="muted"> · </span>
        </span>
      </div>
    </div>
    <div v-if="!byCategory.length" class="muted pa-4 text-center">Nenhum orçamento por categoria cadastrado.</div>
  </v-card>

  <div class="text-caption muted mt-3">
    <span class="mr-4"><span class="legend-dot" style="background: rgb(var(--v-theme-success))" />Dentro (abaixo de 90%)</span>
    <span class="mr-4"><span class="legend-dot" style="background: rgb(var(--v-theme-warning))" />No limite (90% a 99%)</span>
    <span><span class="legend-dot" style="background: rgb(var(--v-theme-error))" />Estourado (100% ou mais)</span>
  </div>

  <v-dialog :model-value="!!editing" max-width="520" @update:model-value="editing = null">
    <v-card v-if="editing" class="pa-5">
      <div class="card-title mb-1">Orçamento · {{ editing.name }}</div>
      <div class="text-caption muted mb-4">Valores previstos por categoria. O realizado vem das notas aprovadas.</div>
      <v-text-field v-model="form.total" label="Orçamento total (R$)" prefix="R$" class="mb-2" />
      <v-row dense>
        <v-col v-for="c in CATEGORIES" :key="c.value" cols="6">
          <v-text-field v-model="form.cats[c.value]" :label="c.title" prefix="R$" density="compact">
            <template #prepend-inner><span class="legend-dot" :style="{ background: c.color }" /></template>
          </v-text-field>
        </v-col>
      </v-row>
      <v-alert
        :type="formCatSum === formTotal ? 'success' : formCatSum > formTotal ? 'warning' : 'info'"
        variant="tonal"
        density="compact"
        class="mt-2"
      >
        Categorias somam {{ brl(formCatSum) }} de {{ brl(formTotal) }}.
        <template v-if="formCatSum < formTotal"> {{ brl(formTotal - formCatSum) }} sem categoria.</template>
        <template v-else-if="formCatSum > formTotal"> Passa do total em {{ brl(formCatSum - formTotal) }}.</template>
      </v-alert>
      <div class="d-flex justify-end ga-2 mt-5">
        <v-btn variant="text" @click="editing = null">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="formTotal <= 0" @click="save">Salvar orçamento</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.matrix-wrap {
  overflow-x: auto;
}
.matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.matrix th {
  text-align: left;
  font-weight: 600;
  color: var(--oo-muted);
  padding: 14px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  white-space: nowrap;
}
.matrix td {
  padding: 12px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  vertical-align: middle;
  min-width: 118px;
}
.matrix .sticky {
  position: sticky;
  left: 0;
  background: rgb(var(--v-theme-surface));
  z-index: 1;
  min-width: 200px;
}
.matrix .total-col {
  background: rgba(14, 107, 83, 0.04);
  min-width: 160px;
}
.obra {
  display: flex;
  align-items: center;
  gap: 12px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.obra:hover .font-weight-medium {
  text-decoration: underline;
}
.cell-num {
  white-space: nowrap;
}
.cat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.cat-hot {
  flex-basis: 100%;
  padding-left: 156px;
  font-size: 0.8rem;
  margin-top: -4px;
}
.cat-hot a {
  text-decoration: none;
  font-weight: 600;
}
.cat-name {
  width: 140px;
  flex-shrink: 0;
}
.cat-num {
  width: 190px;
  flex-shrink: 0;
  white-space: nowrap;
}
.cat-chip {
  width: 110px;
  justify-content: center;
}
@media (max-width: 700px) {
  .cat-hot {
    padding-left: 0;
  }
  .cat-num {
    width: auto;
  }
}
</style>
