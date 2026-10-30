<script setup lang="ts">
/**
 * Relatórios de custo: por obra, por fornecedor e por mês.
 * Base: notas aprovadas, pela data de emissão. Planilha (CSV) e impressão/PDF pelo navegador.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import { api } from '@/lib/api'
import { CATEGORIES, brl, categoryColor, categoryLabel, cnpj, pct, ymd, type CostCategory } from '@/lib/format'
import { toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

type ByCat = Partial<Record<CostCategory, number>>
interface Report {
  from: string | null
  to: string | null
  total: number
  documents: number
  byCategory: ByCat
  byProject: { projectId: string; code: string; name: string; budget: number; total: number; documents: number; byCategory: ByCat }[]
  bySupplier: { supplierId: string | null; name: string; cnpj: string | null; total: number; documents: number; mainCategory: CostCategory | null }[]
  byMonth: { month: string; total: number; documents: number; byCategory: ByCat }[]
}

const auth = useAuth()
const router = useRouter()
const now = new Date()
const period = ref({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) })
const tab = ref<'obras' | 'fornecedores' | 'meses'>('obras')
const data = ref<Report | null>(null)
const loading = ref(false)
const showAllSuppliers = ref(false)

async function load() {
  loading.value = true
  try {
    data.value = await api.get<Report>(`/api/reports?from=${period.value.from}&to=${period.value.to}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(period, load)

const cats = computed(() => CATEGORIES.filter((c) => data.value?.byCategory[c.value]))
const share = (v: number) => (data.value?.total ? (v / data.value.total) * 100 : 0)
const months = computed(() => data.value?.byMonth.length ?? 0)
const maxMonth = computed(() => Math.max(1, ...(data.value?.byMonth.map((m) => m.total) ?? [1])))
const suppliers = computed(() => (showAllSuppliers.value ? data.value?.bySupplier : data.value?.bySupplier.slice(0, 10)) ?? [])

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const fmtDate = (d: string) => d.split('-').reverse().join('/')
const periodLabel = computed(() => `${fmtDate(period.value.from)} a ${fmtDate(period.value.to)}`)

/** variação do último mês contra o anterior */
const lastChange = computed(() => {
  const m = data.value?.byMonth ?? []
  if (m.length < 2 || !m[m.length - 2].total) return null
  return ((m[m.length - 1].total - m[m.length - 2].total) / m[m.length - 2].total) * 100
})

const TABS = [
  { value: 'obras', title: 'Por obra', icon: 'mdi-office-building-outline' },
  { value: 'fornecedores', title: 'Por fornecedor', icon: 'mdi-truck-outline' },
  { value: 'meses', title: 'Por mês', icon: 'mdi-calendar-month-outline' },
] as const

async function downloadCsv() {
  try {
    await api.download(`/api/exports/relatorio-${tab.value}.csv?from=${period.value.from}&to=${period.value.to}`, `relatorio-${tab.value}.csv`)
  } catch (e) {
    toastError(e)
  }
}
const printReport = () => window.print()
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Relatórios</div>
      <div class="page-subtitle">Custo das notas aprovadas, pela data de emissão. Baixe em planilha ou imprima/salve em PDF.</div>
    </div>
    <div class="d-flex ga-2 align-center flex-wrap no-print">
      <PeriodPicker v-model="period" extended />
      <v-btn variant="outlined" prepend-icon="mdi-microsoft-excel" @click="downloadCsv">Baixar planilha</v-btn>
      <v-btn color="primary" prepend-icon="mdi-printer-outline" @click="printReport">Imprimir / PDF</v-btn>
    </div>
  </div>

  <!-- cabeçalho que só aparece no papel -->
  <div class="print-only mb-4">
    <div class="text-h6 font-weight-bold">{{ auth.me?.company.name }} · Relatório de custos {{ TABS.find((t) => t.value === tab)?.title.toLowerCase() }}</div>
    <div class="text-body-2">Período: {{ periodLabel }} · Gerado em {{ new Date().toLocaleString('pt-BR') }} · OperaIA Obras</div>
  </div>

  <v-row dense class="mb-2">
    <v-col cols="6" md="3"><KpiCard label="Custo no período" :value="brl(data?.total, { compact: true })" :hint="periodLabel" /></v-col>
    <v-col cols="6" md="3"><KpiCard label="Notas aprovadas" :value="String(data?.documents ?? 0)" :hint="`${data?.byProject.length ?? 0} obra(s) · ${data?.bySupplier.length ?? 0} fornecedor(es)`" /></v-col>
    <v-col cols="6" md="3">
      <KpiCard
        label="Média por mês"
        :value="brl(months ? (data?.total ?? 0) / months : 0, { compact: true })"
        :hint="lastChange == null ? `${months} mês(es) com notas` : `último mês ${lastChange > 0 ? '+' : ''}${pct(lastChange)} vs anterior`"
        :hint-color="lastChange != null && lastChange > 0 ? 'warning' : lastChange != null ? 'success' : undefined"
      />
    </v-col>
    <v-col cols="6" md="3">
      <KpiCard label="Maior fornecedor" :value="data?.bySupplier[0]?.name ?? '—'" :hint="data?.bySupplier[0] ? `${pct(share(data.bySupplier[0].total))} do custo` : undefined" />
    </v-col>
  </v-row>

  <v-card class="pa-0">
    <v-tabs v-model="tab" color="primary" class="no-print px-2">
      <v-tab v-for="t in TABS" :key="t.value" :value="t.value" :prepend-icon="t.icon">{{ t.title }}</v-tab>
    </v-tabs>
    <v-divider class="no-print" />

    <div v-if="loading && !data" class="pa-10 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="!data?.total" class="pa-10 text-center muted">Nenhuma nota aprovada neste período.</div>

    <!-- POR OBRA -->
    <v-table v-else-if="tab === 'obras'" class="report">
      <thead>
        <tr>
          <th>Obra</th>
          <th class="text-right">Notas</th>
          <th style="width: 34%">Composição por categoria</th>
          <th class="text-right">Total no período</th>
          <th class="text-right">% do total</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in data.byProject" :key="p.projectId" class="clickable" @click="router.push(`/obras/${p.projectId}`)">
          <td>
            <div class="font-weight-medium">{{ p.name }}</div>
            <div class="text-caption muted">{{ p.code }}</div>
          </td>
          <td class="text-right">{{ p.documents }}</td>
          <td>
            <div class="stack">
              <span
                v-for="c in cats"
                :key="c.value"
                :style="{ width: `${((p.byCategory[c.value] ?? 0) / p.total) * 100}%`, background: c.color }"
                :title="`${c.title}: ${brl(p.byCategory[c.value] ?? 0)}`"
              />
            </div>
          </td>
          <td class="text-right money font-weight-bold">{{ brl(p.total) }}</td>
          <td class="text-right">{{ pct(share(p.total)) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="font-weight-bold">Total</td>
          <td class="text-right font-weight-bold">{{ data.documents }}</td>
          <td>
            <span v-for="c in cats" :key="c.value" class="legend mr-3"><span class="legend-dot" :style="{ background: c.color }" />{{ c.title }} {{ pct(share(data.byCategory[c.value] ?? 0)) }}</span>
          </td>
          <td class="text-right money font-weight-bold">{{ brl(data.total) }}</td>
          <td class="text-right font-weight-bold">100%</td>
        </tr>
      </tfoot>
    </v-table>

    <!-- POR FORNECEDOR -->
    <template v-else-if="tab === 'fornecedores'">
      <v-table class="report">
        <thead>
          <tr>
            <th style="width: 48px">#</th>
            <th>Fornecedor</th>
            <th>Categoria principal</th>
            <th class="text-right">Notas</th>
            <th style="width: 26%">Participação</th>
            <th class="text-right">Total no período</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in suppliers" :key="s.supplierId ?? i">
            <td class="muted">{{ i + 1 }}</td>
            <td>
              <div class="font-weight-medium">{{ s.name }}</div>
              <div class="text-caption muted">{{ s.cnpj ? cnpj(s.cnpj) : '—' }}</div>
            </td>
            <td><span v-if="s.mainCategory"><span class="legend-dot" :style="{ background: categoryColor(s.mainCategory) }" />{{ categoryLabel(s.mainCategory) }}</span></td>
            <td class="text-right">{{ s.documents }}</td>
            <td>
              <div class="d-flex align-center ga-2">
                <div class="share"><span :style="{ width: `${(s.total / data.bySupplier[0].total) * 100}%` }" /></div>
                <span class="text-caption" style="min-width: 44px">{{ pct(share(s.total)) }}</span>
              </div>
            </td>
            <td class="text-right money font-weight-bold">{{ brl(s.total) }}</td>
          </tr>
        </tbody>
      </v-table>
      <div v-if="data.bySupplier.length > 10" class="pa-3 text-center no-print">
        <v-btn variant="text" @click="showAllSuppliers = !showAllSuppliers">
          {{ showAllSuppliers ? 'Mostrar só os 10 maiores' : `Ver todos os ${data.bySupplier.length} fornecedores` }}
        </v-btn>
      </div>
    </template>

    <!-- POR MÊS -->
    <div v-else class="pa-5">
      <div class="chart" role="img" :aria-label="`Custo por mês: ${data.byMonth.map((m) => `${monthLabel(m.month)} ${brl(m.total, { compact: true })}`).join(', ')}`">
        <div v-for="m in data.byMonth" :key="m.month" class="col">
          <div class="col-value money">{{ brl(m.total, { compact: true }) }}</div>
          <div class="bar" :style="{ height: `${(m.total / maxMonth) * 100}%` }">
            <span
              v-for="c in cats"
              :key="c.value"
              :style="{ height: `${((m.byCategory[c.value] ?? 0) / m.total) * 100}%`, background: c.color }"
              :title="`${c.title}: ${brl(m.byCategory[c.value] ?? 0)}`"
            />
          </div>
          <div class="col-label">{{ monthLabel(m.month) }}</div>
        </div>
      </div>
      <div class="text-caption muted mt-3 mb-4">
        <span v-for="c in cats" :key="c.value" class="legend mr-3"><span class="legend-dot" :style="{ background: c.color }" />{{ c.title }}</span>
      </div>
      <v-table class="report" density="comfortable">
        <thead>
          <tr>
            <th>Mês</th>
            <th class="text-right">Notas</th>
            <th v-for="c in cats" :key="c.value" class="text-right">{{ c.title }}</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in data.byMonth" :key="m.month">
            <td class="font-weight-medium">{{ monthLabel(m.month) }}</td>
            <td class="text-right">{{ m.documents }}</td>
            <td v-for="c in cats" :key="c.value" class="text-right money">{{ brl(m.byCategory[c.value] ?? 0, { compact: true }) }}</td>
            <td class="text-right money font-weight-bold">{{ brl(m.total, { compact: true }) }}</td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </v-card>
</template>

<style scoped>
.report :deep(td),
.report :deep(th) {
  white-space: nowrap;
}
.report tfoot td {
  border-top: 2px solid rgba(0, 0, 0, 0.12);
  white-space: normal !important;
}
.clickable {
  cursor: pointer;
}
.stack {
  display: flex;
  height: 12px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--oo-track);
}
.share {
  flex: 1;
  height: 10px;
  border-radius: 5px;
  background: var(--oo-track);
  overflow: hidden;
}
.share span {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-primary));
  border-radius: 5px;
}
.legend {
  display: inline-flex;
  align-items: center;
  font-size: 0.78rem;
  white-space: nowrap;
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  height: 260px;
  padding-top: 24px;
}
.col {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  min-width: 0;
}
.bar {
  width: 100%;
  max-width: 88px;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 6px 6px 0 0;
  overflow: hidden;
}
.bar span {
  display: block;
  width: 100%;
}
.col-value {
  font-size: 0.78rem;
  font-weight: 600;
  margin-bottom: 4px;
}
.col-label {
  font-size: 0.8rem;
  color: var(--oo-muted);
  margin-top: 6px;
}
</style>
