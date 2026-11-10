<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ActionTiles from '@/components/ActionTiles.vue'
import AlertItem from '@/components/AlertItem.vue'
import BarList from '@/components/BarList.vue'
import BuildingArt from '@/components/BuildingArt.vue'
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
  <v-skeleton-loader v-if="loading && !data" type="card, card" />

  <template v-if="data">
    <div class="top-grid mb-4">
      <!-- destaque: título leve, obra em traço e o número do período num cartão de vidro -->
      <section class="hero">
        <div class="hero-copy">
          <h1 class="page-title">Suas obras <br />hoje</h1>
          <p class="hero-lede">Quanto cada obra já gastou, o que vence agora e o que precisa da sua decisão.</p>
          <div class="hero-tools">
            <PeriodPicker v-model="period" />
            <v-btn variant="outlined" prepend-icon="mdi-tray-arrow-down" :loading="exporting" @click="exportPeriod">Baixar planilha</v-btn>
          </div>
        </div>
        <BuildingArt class="hero-art" />
        <div class="hero-glass">
          <div class="hg-row"><span>Gasto no período</span><span class="hg-corner"><v-icon size="13">mdi-arrow-top-right</v-icon></span></div>
          <div class="hg-value money">{{ brl(data.kpis.appropriatedCost) }}</div>
          <div class="hg-row">
            <span v-if="change !== null" class="hg-delta"><v-icon size="13">{{ change >= 0 ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon>{{ pct(Math.abs(change)) }} {{ change >= 0 ? 'a mais' : 'a menos' }}</span>
            <span v-else class="hg-delta">sem período anterior</span>
            <div class="thumbs">
              <ProjectThumb v-for="p in data.projects.slice(0, 3)" :key="p.id" :name="p.name" :image-url="p.imageUrl" :size="26" class="thumb" />
              <i v-if="data.projects.length > 3" class="thumb-more">+{{ data.projects.length - 3 }}</i>
            </div>
          </div>
        </div>
      </section>

      <div class="side-cards">
        <section class="panel g-card">
          <div class="gc-head"><span class="gc-ic"><v-icon size="15">mdi-wallet-outline</v-icon></span>Orçamento comprometido<span class="open-corner ml-auto"><v-icon size="14">mdi-arrow-top-right</v-icon></span></div>
          <div class="gc-body">
            <div>
              <div class="gc-hint">{{ brl(data.kpis.budgetTotal) }} no total</div>
              <div class="big-num">{{ pct(data.kpis.budgetCommittedPct) }}</div>
            </div>
            <GaugeArc bare :value="data.kpis.budgetCommittedPct" :size="118" label="Orçamento comprometido" />
          </div>
        </section>
        <section class="panel g-card">
          <div class="gc-head"><span class="gc-ic"><v-icon size="15">mdi-cash-check</v-icon></span>Do gasto já foi pago<span class="open-corner ml-auto"><v-icon size="14">mdi-arrow-top-right</v-icon></span></div>
          <div class="gc-body">
            <div>
              <div class="gc-hint">{{ brl(data.kpis.openPayables) }} em aberto</div>
              <div class="big-num">{{ pct(paidShare) }}</div>
            </div>
            <GaugeArc bare :value="paidShare" tone="blue" :size="118" label="Do gasto já foi pago" />
          </div>
        </section>
        <section class="panel g-card">
          <div class="gc-head"><span class="gc-ic"><v-icon size="15">mdi-home-city-outline</v-icon></span>Obras em andamento<span class="open-corner ml-auto"><v-icon size="14">mdi-arrow-top-right</v-icon></span></div>
          <div class="gc-body">
            <div>
              <div class="gc-hint">{{ data.kpis.documentsPending }} nota(s) a conferir</div>
              <div class="big-num">{{ data.kpis.activeProjects }}</div>
            </div>
            <div class="mini-bars" aria-hidden="true">
              <span v-for="p in data.projects" :key="p.id" :style="{ height: Math.max(p.committedPct, 8) + '%' }" :class="stateOf(p.committedPct)" />
            </div>
          </div>
        </section>
      </div>
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
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.8fr);
  gap: 14px;
}
@media (max-width: 1000px) {
  .top-grid {
    grid-template-columns: 1fr;
  }
}
.hero {
  position: relative;
  min-width: 0;
  min-height: 430px;
  overflow: hidden;
  border-radius: 28px;
  border: var(--oo-glass-border);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.3));
  box-shadow: var(--oo-shadow);
}
.hero-copy {
  position: relative;
  z-index: 2;
  padding: 28px 30px;
  max-width: 400px;
}
.hero-copy .page-title {
  font-size: clamp(2.2rem, 3.4vw, 3rem);
  line-height: 1.02;
}
.hero-lede {
  margin-top: 10px;
  color: var(--oo-muted);
  font-size: var(--oo-fs-micro);
  line-height: 1.45;
  max-width: 30ch;
}
.hero-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.hero-art {
  position: absolute;
  right: -5%;
  bottom: -9%;
  width: 78%;
  max-width: 720px;
  pointer-events: none;
}
.hero-glass {
  position: absolute;
  right: 26%;
  top: 34%;
  z-index: 2;
  min-width: 230px;
  padding: 14px 16px 15px;
  border-radius: 20px;
  color: #fff;
  background: linear-gradient(135deg, rgba(52, 58, 56, 0.6), rgba(52, 58, 56, 0.4));
  border: 1px solid rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(18px) saturate(1.5);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 20px 44px -18px rgba(16, 24, 22, 0.55);
}
.hg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--oo-fs-micro);
}
.hg-corner {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
}
.hg-value {
  font-size: 1.85rem;
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin: 8px 0 10px;
}
.hg-delta {
  display: inline-flex;
  align-items: center;
  opacity: 0.85;
}
.thumbs {
  display: flex;
  align-items: center;
}
.thumbs .thumb,
.thumb-more {
  margin-left: -7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.9);
  overflow: hidden;
}
.thumb-more {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  background: rgba(255, 255, 255, 0.24);
  font-style: normal;
  font-size: 0.65rem;
  font-weight: 600;
}
@media (max-width: 700px) {
  .hero {
    min-height: 0;
  }
  .hero-art {
    display: none;
  }
  .hero-glass {
    position: static;
    margin: 0 20px 20px;
  }
}

/* cartões de medidor, como os "Details" da referência */
.side-cards {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.g-card {
  padding: 14px 16px 12px;
}
.gc-head {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: var(--oo-fs-body);
  font-weight: 500;
}
.gc-ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(17, 25, 23, 0.06);
  color: #46544f;
  flex: none;
}
.gc-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
}
.gc-hint {
  font-size: 0.78rem;
  color: var(--oo-muted);
  margin-bottom: 2px;
}
.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  height: 58px;
  margin-bottom: 6px;
}
.mini-bars span {
  width: 16px;
  border-radius: 999px 999px 3px 3px;
  background: linear-gradient(180deg, var(--oo-primary), rgba(13, 155, 108, 0.3));
}
.mini-bars span.attention {
  background: linear-gradient(180deg, var(--oo-orange), rgba(240, 135, 26, 0.3));
}
.mini-bars span.late {
  background: linear-gradient(180deg, var(--oo-red), rgba(217, 58, 76, 0.3));
}

/* faixa de providências */
.band-todo {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  background: var(--oo-glass);
  border: var(--oo-glass-border);
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
  background: var(--oo-glass);
  border: var(--oo-glass-border);
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
  font-size: var(--oo-fs-lead);
  font-weight: 600;
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
