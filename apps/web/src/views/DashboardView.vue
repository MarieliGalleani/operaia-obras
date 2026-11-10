<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AlertItem from '@/components/AlertItem.vue'
import BarList from '@/components/BarList.vue'
import PayableChip from '@/components/PayableChip.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import ProjectThumb from '@/components/ProjectThumb.vue'
import StackBar from '@/components/StackBar.vue'
import { api } from '@/lib/api'
import { brl, categoryLabel, date, pct } from '@/lib/format'
import { currentMonth } from '@/lib/period'
import { toast, toastError } from '@/lib/toast'

interface Dashboard {
  period: { from: string; to: string }
  kpis: {
    appropriatedCost: number
    appropriatedCostChangePct: number | null
    openPayables: number
    budgetTotal: number
    budgetCommittedPct: number
    activeProjects: number
    newProjectsThisPeriod: number
    openAlerts: number
    criticalAlerts: number
    documentsPending: number
  }
  projects: { id: string; code: string; name: string; imageUrl: string | null; budget: number; paid: number; open: number; committedPct: number }[]
  costsByCategory: { category: string; total: number }[]
  upcomingPayables: { id: string; dueDate: string; amount: number; paidAmount: number; status: string; supplierName: string; description: string; projectNames: string | null }[]
  alerts: { id: string; severity: string; title: string; message: string; documentId: string | null; projectId: string | null }[]
}

const router = useRouter()
const period = ref(currentMonth())
const data = ref<Dashboard | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    data.value = await api.get<Dashboard>(`/api/dashboard?from=${period.value.from}&to=${period.value.to}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(period, load)

const changeText = computed(() => {
  const c = data.value?.kpis.appropriatedCostChangePct
  if (c == null) return 'sem período anterior para comparar'
  return `${pct(Math.abs(c))} ${c >= 0 ? 'a mais' : 'a menos'} que no período anterior`
})
const costItems = computed(() => (data.value?.costsByCategory ?? []).map((c) => ({ key: c.category, label: categoryLabel(c.category), amount: c.total })))
const lateCount = computed(() => (data.value?.upcomingPayables ?? []).filter((t) => new Date(t.dueDate) < new Date()).length)
const bills = computed(() => (data.value?.upcomingPayables ?? []).slice(0, 6))
const alerts = computed(() => (data.value?.alerts ?? []).slice(0, 5))
const stateOf = (p: number) => (p >= 90 ? 'late' : p >= 75 ? 'attention' : 'ok')
const ICON = { late: 'mdi-alert-circle', attention: 'mdi-alert', ok: 'mdi-check-circle' }

const exporting = ref(false)
async function exportPeriod() {
  exporting.value = true
  try {
    await api.download(`/api/exports/lancamentos.csv?from=${period.value.from}&to=${period.value.to}`, 'lancamentos.csv')
    toast('Planilha baixada')
  } catch (e) {
    toastError(e)
  } finally {
    exporting.value = false
  }
}
function openAlert(a: Dashboard['alerts'][number]) {
  if (a.documentId) router.push({ name: 'documents', query: { doc: a.documentId } })
  else if (a.projectId) router.push({ name: 'project', params: { id: a.projectId } })
  else router.push({ name: 'alerts' })
}
</script>

<template>
  <div class="d-flex align-center justify-space-between flex-wrap ga-4 mb-5">
    <div>
      <div class="page-title">Suas obras hoje</div>
      <div class="page-subtitle">Quanto cada obra já gastou, o que vence agora e o que precisa da sua decisão.</div>
    </div>
    <div class="d-flex ga-2 align-center flex-wrap">
      <PeriodPicker v-model="period" />
      <v-btn variant="outlined" prepend-icon="mdi-table-arrow-down" :loading="exporting" @click="exportPeriod">Baixar planilha</v-btn>
    </div>
  </div>

  <v-skeleton-loader v-if="loading && !data" type="card, card" />

  <template v-if="data">
    <!-- faixa de providências: ocupa a largura toda, itens lado a lado -->
    <div v-if="data.kpis.documentsPending || lateCount" class="band-todo mb-4">
      <div class="band-todo-label"><v-icon size="20" class="mr-2">mdi-hand-pointing-right</v-icon>Resolver agora</div>
      <div class="band-todo-items">
        <div v-if="data.kpis.documentsPending" class="todo-item">
          <div class="todo-text">
            <b>{{ data.kpis.documentsPending }} nota(s) esperando conferência</b>
            <span>Enquanto não confere, não entram no custo da obra.</span>
          </div>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-file-check-outline" :to="{ name: 'documents' }">Conferir</v-btn>
        </div>
        <div v-if="lateCount" class="todo-item">
          <div class="todo-text">
            <b>{{ lateCount }} conta(s) passaram do vencimento</b>
            <span>Pague ou negocie para não pagar juros.</span>
          </div>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-cash-clock" to="/contas-a-pagar">Ver contas</v-btn>
        </div>
      </div>
    </div>

    <!-- faixa única com os três números, sem cartões soltos -->
    <div class="band-money mb-5">
      <div class="cell">
        <div class="cell-label">Suas obras já gastaram</div>
        <div class="cell-value money">{{ brl(data.kpis.appropriatedCost) }}</div>
        <div class="cell-foot">{{ changeText }}</div>
      </div>
      <div class="cell">
        <div class="cell-label">Ainda falta pagar</div>
        <div class="cell-value money">{{ brl(data.kpis.openPayables) }}</div>
        <div class="cell-foot">contas lançadas e ainda não pagas</div>
      </div>
      <div class="cell">
        <div class="cell-label">Orçamento de todas as obras</div>
        <div class="cell-value money">{{ brl(data.kpis.budgetTotal) }}</div>
        <div class="cell-meter">
          <v-progress-linear :model-value="data.kpis.budgetCommittedPct" color="primary" bg-color="#E9EDEB" bg-opacity="1" height="12" rounded />
          <span class="money font-weight-bold">{{ Math.round(data.kpis.budgetCommittedPct) }}%</span>
        </div>
        <div class="cell-foot">já comprometido</div>
      </div>
    </div>

    <!-- as obras são o assunto da tela: ocupam a largura toda, em mosaico -->
    <div class="sec-head">
      <h2 class="sec-title">Obras em andamento <span class="sec-count">{{ data.kpis.activeProjects }}</span></h2>
      <router-link class="link" to="/obras">Ver todas as obras</router-link>
    </div>
    <div class="obras-grid mb-5">
      <article v-for="p in data.projects" :key="p.id" class="obra" @click="router.push({ name: 'project', params: { id: p.id } })">
        <header class="obra-head">
          <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="52" />
          <div style="min-width: 0">
            <div class="obra-name">{{ p.name }}</div>
            <div class="muted" style="font-size: var(--oo-fs-micro)">{{ p.code }}</div>
          </div>
        </header>
        <div class="state obra-state" :class="`state-${stateOf(p.committedPct)}`">
          <v-icon size="16">{{ ICON[stateOf(p.committedPct)] }}</v-icon>{{ pct(p.committedPct) }} do orçamento usado
        </div>
        <StackBar legend columns :paid="p.paid" :open="p.open" :budget="p.budget" />
      </article>
      <div v-if="!data.projects.length" class="muted">Nenhuma obra em andamento. <router-link class="link" to="/obras">Cadastrar a primeira obra</router-link></div>
    </div>

    <!-- rodapé em três colunas que terminam juntas -->
    <div class="foot-grid">
      <section class="panel">
        <div class="sec-head">
          <h2 class="sec-title">Contas para pagar</h2>
          <router-link class="link" to="/contas-a-pagar">Ver todas</router-link>
        </div>
        <div class="muted mb-2" style="font-size: var(--oo-fs-micro)">Nos próximos 30 dias.</div>
        <div v-for="t in bills" :key="t.id" class="bill">
          <div style="min-width: 0">
            <div class="bill-name">{{ t.supplierName }}</div>
            <div class="muted" style="font-size: var(--oo-fs-micro)">
              vence {{ date(t.dueDate) }}<template v-if="t.projectNames"> · {{ t.projectNames }}</template>
            </div>
          </div>
          <div class="text-right">
            <div class="money font-weight-bold">{{ brl(t.amount - t.paidAmount) }}</div>
            <PayableChip :status="t.status" :due-date="t.dueDate" />
          </div>
        </div>
        <div v-if="!bills.length" class="state state-ok mt-2"><v-icon size="16">mdi-check-circle</v-icon>Nada a pagar nos próximos 30 dias</div>
      </section>

      <div class="foot-stack">
      <section class="panel">
        <div class="sec-head"><h2 class="sec-title">Para onde foi o dinheiro</h2></div>
        <div class="muted mb-2" style="font-size: var(--oo-fs-micro)">Notas aprovadas no período, da maior para a menor.</div>
        <BarList :items="costItems" total-label="Total gasto no período" empty-text="Nenhuma nota aprovada neste período." />
      </section>

      <section class="panel">
        <div class="sec-head">
          <h2 class="sec-title">O que o sistema encontrou</h2>
          <router-link class="link" to="/inteligencia">Ver tudo</router-link>
        </div>
        <div class="muted mb-2" style="font-size: var(--oo-fs-micro)">
          Conferências automáticas nas notas e nas compras.<template v-if="data.kpis.criticalAlerts">&nbsp;{{ data.kpis.criticalAlerts }} precisa(m) de atenção.</template>
        </div>
        <div class="d-flex flex-column ga-2">
          <AlertItem v-for="a in alerts" :key="a.id" :alert="a" compact @open="openAlert(a)" />
          <div v-if="!alerts.length" class="state state-ok"><v-icon size="16">mdi-check-circle</v-icon>Nada pendente. Está tudo em ordem.</div>
        </div>
      </section>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* ---- faixa de providências */
.band-todo {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  background: var(--oo-attention-bg);
  border: 1px solid #f0dcb4;
  border-radius: 12px;
  overflow: hidden;
}
.band-todo-label {
  display: flex;
  align-items: center;
  padding: 12px 18px;
  font-weight: 700;
  color: #7d4a00;
  background: #fbe8c4;
  white-space: nowrap;
}
.band-todo-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  flex: 1;
}
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 18px;
}
.todo-item + .todo-item {
  border-left: 1px solid #f0dcb4;
}
.todo-text b {
  display: block;
  font-size: var(--oo-fs-lead);
  line-height: 1.25;
}
.todo-text span {
  color: #7d4a00;
  font-size: var(--oo-fs-micro);
}

/* ---- faixa dos números: um painel só, dividido */
.band-money {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  background: #fff;
  border: 1px solid var(--oo-border);
  border-radius: 14px;
  overflow: hidden;
}
.cell {
  min-width: 0;
  padding: 14px 18px;
}
.cell + .cell {
  border-left: 1px solid var(--oo-border);
}
.cell:first-child {
  background: var(--oo-ok-bg);
  box-shadow: inset 5px 0 0 var(--oo-primary);
}
.cell-label {
  color: var(--oo-muted);
  font-size: var(--oo-fs-body);
  font-weight: 500;
}
.cell-value {
  font-size: clamp(1.35rem, 1.7vw, 1.6rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin-top: 2px;
}
.cell-foot {
  color: var(--oo-muted);
  font-size: var(--oo-fs-micro);
  margin-top: 6px;
}
.cell-meter {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

/* ---- títulos de seção */
.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}
.sec-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.sec-count {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--oo-track);
  color: var(--oo-muted);
  font-size: var(--oo-fs-micro);
  font-weight: 600;
  vertical-align: 2px;
}

/* ---- mosaico das obras: enche a largura, sem buraco */
.obras-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(252px, 1fr));
  gap: 14px;
  margin-top: 12px;
}
.obra {
  min-width: 0;
  background: #fff;
  border: 1px solid var(--oo-border);
  border-radius: 14px;
  padding: 14px 14px 15px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.obra:hover {
  border-color: var(--oo-bright);
}
.obra-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.obra-name {
  font-size: var(--oo-fs-lead);
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.obra-state {
  margin: 11px 0 9px;
}

/* ---- rodapé em três painéis iguais */
.foot-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 1.15fr);
  gap: 14px;
  align-items: start;
}
.foot-stack {
  display: grid;
  gap: 14px;
  min-width: 0;
}
@media (max-width: 960px) {
  .foot-grid {
    grid-template-columns: 1fr;
  }
}
.panel {
  min-width: 0;
  background: #fff;
  border: 1px solid var(--oo-border);
  border-radius: 14px;
  padding: 15px 18px 17px;
}
.bill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 8px 0;
}
.bill + .bill {
  border-top: 1px solid var(--oo-border);
}
.bill-name {
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
