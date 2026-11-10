<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ActionTiles from '@/components/ActionTiles.vue'
import AlertItem from '@/components/AlertItem.vue'
import BarList from '@/components/BarList.vue'
import GaugeArc from '@/components/GaugeArc.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import ProjectThumb from '@/components/ProjectThumb.vue'
import StackBar from '@/components/StackBar.vue'
import { api } from '@/lib/api'
import { brl, categoryLabel, dueLabel, dueState, pct } from '@/lib/format'
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
  alerts: { id: string; severity: string; type?: string | null; title: string; message: string; documentId: string | null; projectId: string | null }[]
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

const change = computed(() => data.value?.kpis.appropriatedCostChangePct ?? null)
const paidShare = computed(() => {
  const p = data.value?.projects ?? []
  const paid = p.reduce((a, b) => a + b.paid, 0)
  const open = p.reduce((a, b) => a + b.open, 0)
  return paid + open ? (paid / (paid + open)) * 100 : 0
})
const costItems = computed(() => (data.value?.costsByCategory ?? []).map((c) => ({ key: c.category, label: categoryLabel(c.category), amount: c.total })))
const lateCount = computed(() => (data.value?.upcomingPayables ?? []).filter((t) => new Date(t.dueDate) < new Date()).length)
const bills = computed(() => (data.value?.upcomingPayables ?? []).slice(0, 5))
const alerts = computed(() => (data.value?.alerts ?? []).slice(0, 4))
const stateOf = (p: number) => (p >= 90 ? 'late' : p >= 75 ? 'attention' : 'ok')
const ICON = { late: 'mdi-alert-circle', attention: 'mdi-alert', ok: 'mdi-check-circle' }

const SHORTCUTS = [
  { key: 'notas', label: 'Conferir notas', hint: 'Aprovar o que chegou', icon: 'mdi-file-check-outline', tone: 'primary' as const },
  { key: 'compras', label: 'Nova compra', hint: 'Pedido para um fornecedor', icon: 'mdi-cart-outline', tone: 'primary' as const },
  { key: 'contas', label: 'Pagar contas', hint: 'Títulos em aberto', icon: 'mdi-cash-clock', tone: 'attention' as const },
  { key: 'obras', label: 'Ver obras', hint: 'Custo e avanço de cada uma', icon: 'mdi-home-city-outline', tone: 'primary' as const },
  { key: 'relatorios', label: 'Relatórios', hint: 'Fechamento e planilhas', icon: 'mdi-chart-box-outline', tone: 'primary' as const },
]
const SHORTCUT_TO: Record<string, string> = { notas: '/notas-fiscais', compras: '/compras', contas: '/contas-a-pagar', obras: '/obras', relatorios: '/relatorios' }

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
      <v-btn variant="tonal" prepend-icon="mdi-tray-arrow-down" :loading="exporting" @click="exportPeriod">Baixar planilha</v-btn>
    </div>
  </div>

  <v-skeleton-loader v-if="loading && !data" type="card, card" />

  <template v-if="data">
    <!-- destaque: o número da tela, com as obras que o compõem -->
    <div class="top-grid mb-3">
      <section class="hero">
        <div class="hero-top">
          <span class="hero-kicker">Gasto no período</span>
          <span v-if="change !== null" class="delta" :class="change >= 0 ? 'delta-up' : 'delta-down'">
            <v-icon size="13">{{ change >= 0 ? 'mdi-trending-up' : 'mdi-trending-down' }}</v-icon>{{ pct(Math.abs(change)) }}
          </span>
        </div>
        <div class="hero-value money">{{ brl(data.kpis.appropriatedCost) }}</div>
        <div class="hero-sub">
          {{ change === null ? 'sem período anterior para comparar' : `${change >= 0 ? 'a mais' : 'a menos'} que no período anterior` }}
        </div>
        <div class="hero-foot">
          <div class="thumbs">
            <ProjectThumb v-for="p in data.projects.slice(0, 4)" :key="p.id" :name="p.name" :image-url="p.imageUrl" :size="34" class="thumb" />
          </div>
          <span>{{ data.kpis.activeProjects }} obras em andamento</span>
        </div>
      </section>

      <section class="panel gauges">
        <GaugeArc :value="data.kpis.budgetCommittedPct" label="Orçamento comprometido" :hint="brl(data.kpis.budgetTotal) + ' no total'" />
        <GaugeArc :value="paidShare" tone="blue" label="Do gasto já foi pago" :hint="brl(data.kpis.openPayables) + ' em aberto'" />
      </section>
    </div>

    <!-- o que precisa da pessoa agora -->
    <div v-if="data.kpis.documentsPending || lateCount" class="band-todo mb-5">
      <div class="band-todo-label"><v-icon size="19" class="mr-2">mdi-hand-pointing-right</v-icon>Resolver agora</div>
      <div class="band-todo-items">
        <div v-if="data.kpis.documentsPending" class="todo-item">
          <div class="todo-text">
            <b>{{ data.kpis.documentsPending }} nota(s) esperando conferência</b>
            <span>Enquanto não confere, não entram no custo da obra.</span>
          </div>
          <v-btn color="primary" variant="flat" :to="{ name: 'documents' }">Conferir</v-btn>
        </div>
        <div v-if="lateCount" class="todo-item">
          <div class="todo-text">
            <b>{{ lateCount }} conta(s) passaram do vencimento</b>
            <span>Pague ou negocie para não pagar juros.</span>
          </div>
          <v-btn color="primary" variant="flat" to="/contas-a-pagar">Ver contas</v-btn>
        </div>
      </div>
    </div>

    <div class="sec-head">
      <h2 class="sec-title">Obras em andamento</h2>
      <router-link class="link" to="/obras">Ver todas</router-link>
    </div>
    <div class="obras-grid mb-5">
      <article v-for="p in data.projects" :key="p.id" class="obra" @click="router.push({ name: 'project', params: { id: p.id } })">
        <header class="obra-head">
          <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="44" />
          <div style="min-width: 0">
            <div class="obra-name">{{ p.name }}</div>
            <div class="muted" style="font-size: var(--oo-fs-micro)">{{ p.code }}</div>
          </div>
          <span class="open-corner"><v-icon size="16">mdi-arrow-top-right</v-icon></span>
        </header>
        <div class="state obra-state" :class="`state-${stateOf(p.committedPct)}`">
          <v-icon size="15">{{ ICON[stateOf(p.committedPct)] }}</v-icon>{{ pct(p.committedPct) }} do orçamento usado
        </div>
        <StackBar legend columns :paid="p.paid" :open="p.open" :budget="p.budget" />
      </article>
    </div>

    <div class="sec-head"><h2 class="sec-title">Ações rápidas</h2></div>
    <div class="mb-5" style="margin-top: 10px">
      <ActionTiles :actions="SHORTCUTS" @run="(k) => router.push(SHORTCUT_TO[k])" />
    </div>

    <div class="foot-grid">
      <div class="foot-stack">
        <section class="panel">
        <div class="sec-head">
          <h2 class="sec-title">Contas para pagar</h2>
          <router-link class="link" to="/contas-a-pagar">Ver todas</router-link>
        </div>
        <div class="muted mb-3" style="font-size: var(--oo-fs-micro)">Nos próximos 30 dias.</div>
        <div v-for="t in bills" :key="t.id" class="bill">
          <div style="min-width: 0">
            <div class="bill-name">{{ t.supplierName }}</div>
            <div class="bill-due">
              <span class="state" :class="`state-${dueState(t.dueDate)}`">{{ dueLabel(t.dueDate) }}</span>
              <span v-if="t.projectNames" class="muted">{{ t.projectNames }}</span>
            </div>
          </div>
          <div class="money font-weight-bold">{{ brl(t.amount - t.paidAmount) }}</div>
        </div>
        <div v-if="!bills.length" class="state state-ok mt-2"><v-icon size="16">mdi-check-circle</v-icon>Nada a pagar nos próximos 30 dias</div>
        </section>
        <section class="panel">
          <div class="sec-head"><h2 class="sec-title">Para onde foi o dinheiro</h2></div>
          <div class="muted mb-3" style="font-size: var(--oo-fs-micro)">Notas aprovadas no período, da maior para a menor.</div>
          <BarList :items="costItems" total-label="Total gasto no período" empty-text="Nenhuma nota aprovada neste período." />
        </section>

      </div>

      <div class="foot-stack">
        <section class="panel">
          <div class="sec-head">
            <h2 class="sec-title">O que o sistema encontrou</h2>
            <router-link class="link" to="/inteligencia">Ver tudo</router-link>
          </div>
          <div class="muted mb-3" style="font-size: var(--oo-fs-micro)">
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
.top-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1.05fr) minmax(300px, 1fr);
  gap: 14px;
}
@media (max-width: 900px) {
  .top-grid {
    grid-template-columns: 1fr;
  }
}

/* destaque com fundo em degradê, como nas referências */
.hero {
  min-width: 0;
  position: relative;
  overflow: hidden;
  border-radius: var(--oo-r-card);
  padding: 22px 24px 20px;
  color: #fff;
  background: linear-gradient(135deg, #0b7f59 0%, #0d9b6c 52%, #19b982 100%);
  box-shadow: 0 14px 34px -16px rgba(13, 155, 108, 0.75);
}
.hero::after {
  content: '';
  position: absolute;
  right: -70px;
  top: -90px;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
}
.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: relative;
}
.hero-kicker {
  font-size: var(--oo-fs-micro);
  font-weight: 600;
  opacity: 0.85;
}
.hero .delta {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.hero-value {
  font-size: clamp(1.9rem, 3.2vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1.08;
  margin-top: 8px;
  position: relative;
}
.hero-sub {
  font-size: var(--oo-fs-micro);
  opacity: 0.86;
  margin-top: 2px;
}
.hero-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  font-size: var(--oo-fs-micro);
  opacity: 0.92;
  position: relative;
}
.thumbs {
  display: flex;
  margin-right: 12px;
}
.thumbs .thumb {
  margin-right: -8px;
  border-radius: 11px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95);
}

.gauges {
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 16px;
  flex-wrap: wrap;
}

/* faixa de providências */
.band-todo {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  background: var(--oo-surface);
  border-radius: var(--oo-r-card);
  box-shadow: var(--oo-shadow);
  overflow: hidden;
}
.band-todo-label {
  display: flex;
  align-items: center;
  padding: 14px 20px;
  font-weight: 700;
  color: var(--oo-attention);
  background: var(--oo-orange-soft);
  white-space: nowrap;
}
.band-todo-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
  flex: 1;
}
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 20px;
}
.todo-item + .todo-item {
  border-left: 1px solid var(--oo-line);
}
.todo-text b {
  display: block;
  font-size: var(--oo-fs-body);
  line-height: 1.25;
}
.todo-text span {
  color: var(--oo-muted);
  font-size: var(--oo-fs-micro);
}

.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.obras-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(252px, 1fr));
  gap: 14px;
  margin-top: 12px;
}
.obra {
  min-width: 0;
  background: var(--oo-surface);
  border-radius: var(--oo-r-card);
  box-shadow: var(--oo-shadow);
  padding: 16px 16px 18px;
  cursor: pointer;
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}
.obra:hover {
  box-shadow: var(--oo-shadow-lift);
  transform: translateY(-2px);
}
.obra-head {
  display: flex;
  align-items: center;
  gap: 11px;
}
.obra-name {
  font-size: var(--oo-fs-body);
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.obra-state {
  margin: 13px 0 10px;
}

.foot-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(300px, 1.15fr);
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
.bill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 0;
}
.bill + .bill {
  border-top: 1px solid var(--oo-line);
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
.bill-due {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
  font-size: var(--oo-fs-micro);
}
.bill-due .state {
  font-size: 0.6875rem;
  padding: 2px 9px;
}
</style>
