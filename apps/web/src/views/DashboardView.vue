<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AlertItem from '@/components/AlertItem.vue'
import BarList from '@/components/BarList.vue'
import KpiCard from '@/components/KpiCard.vue'
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

const change = computed(() => {
  const c = data.value?.kpis.appropriatedCostChangePct
  if (c == null) return { text: 'sem período anterior para comparar', color: undefined }
  const dir = c >= 0 ? 'mais' : 'menos'
  return { text: `${pct(Math.abs(c))} ${dir} que no período anterior`, color: undefined }
})
const costItems = computed(() => (data.value?.costsByCategory ?? []).map((c) => ({ key: c.category, label: categoryLabel(c.category), amount: c.total })))
const lateCount = computed(() => (data.value?.upcomingPayables ?? []).filter((t) => new Date(t.dueDate) < new Date()).length)

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
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
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
    <!-- o que precisa da pessoa agora, antes de qualquer número -->
    <div v-if="data.kpis.documentsPending || lateCount" class="todo mb-5">
      <div class="todo-title"><v-icon color="#b26a00" class="mr-2">mdi-hand-pointing-right</v-icon>Para você resolver agora</div>
      <div class="todo-list">
        <div v-if="data.kpis.documentsPending" class="todo-item">
          <div>
            <div class="font-weight-bold" style="font-size: var(--oo-fs-lead)">{{ data.kpis.documentsPending }} nota(s) esperando você conferir</div>
            <div class="muted">Enquanto não confere, elas não entram no custo da obra.</div>
          </div>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-file-check-outline" :to="{ name: 'documents' }">Conferir notas</v-btn>
        </div>
        <div v-if="lateCount" class="todo-item">
          <div>
            <div class="font-weight-bold" style="font-size: var(--oo-fs-lead)">{{ lateCount }} conta(s) já passaram do vencimento</div>
            <div class="muted">Pague ou negocie para não pagar juros.</div>
          </div>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-cash-clock" to="/contas-a-pagar">Ver contas</v-btn>
        </div>
      </div>
    </div>

    <v-row dense class="mb-2">
      <v-col cols="12" md="6" lg="4">
        <KpiCard lead label="Quanto suas obras já gastaram no período" :value="brl(data.kpis.appropriatedCost)" :hint="change.text" :hint-color="change.color" />
      </v-col>
      <v-col cols="12" sm="6" lg="4">
        <KpiCard label="Ainda falta pagar" :value="brl(data.kpis.openPayables)" hint="contas lançadas que ainda não foram pagas" />
      </v-col>
      <v-col cols="12" sm="6" lg="4">
        <KpiCard label="Orçamento de todas as obras" :value="brl(data.kpis.budgetTotal)" :progress="data.kpis.budgetCommittedPct" hint="já comprometido do orçamento" />
      </v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" lg="7">
        <v-card class="pa-5 mb-2">
          <div class="d-flex justify-space-between align-center flex-wrap ga-2 mb-2">
            <div>
              <div class="card-title">Obras em andamento</div>
              <div class="muted" style="font-size: var(--oo-fs-micro)">{{ data.kpis.activeProjects }} obra(s). Toque em uma para abrir.</div>
            </div>
            <router-link class="link" to="/obras">Ver todas as obras</router-link>
          </div>
          <div v-for="p in data.projects" :key="p.id" class="project-row" @click="router.push({ name: 'project', params: { id: p.id } })">
            <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="64" />
            <div class="flex-grow-1" style="min-width: 0">
              <div class="d-flex justify-space-between align-start ga-3 flex-wrap mb-1">
                <div class="font-weight-bold" style="font-size: var(--oo-fs-lead)">{{ p.name }}</div>
                <span class="state" :class="p.committedPct >= 90 ? 'state-late' : p.committedPct >= 75 ? 'state-attention' : 'state-ok'">
                  <v-icon size="16">{{ p.committedPct >= 90 ? 'mdi-alert-circle' : p.committedPct >= 75 ? 'mdi-alert' : 'mdi-check-circle' }}</v-icon>
                  {{ pct(p.committedPct) }} do orçamento usado
                </span>
              </div>
              <StackBar legend :paid="p.paid" :open="p.open" :budget="p.budget" />
            </div>
          </div>
          <div v-if="!data.projects.length" class="muted">Nenhuma obra em andamento. <router-link class="link" to="/obras">Cadastrar a primeira obra</router-link></div>
        </v-card>
        <div class="mt-2"></div>
        <v-card class="pa-5">
          <div class="d-flex justify-space-between align-center flex-wrap ga-2 mb-3">
            <div>
              <div class="card-title">Contas para pagar</div>
              <div class="muted" style="font-size: var(--oo-fs-micro)">Nos próximos 30 dias.</div>
            </div>
            <router-link class="link" to="/contas-a-pagar">Ver todas as contas</router-link>
          </div>
          <div v-for="t in data.upcomingPayables" :key="t.id" class="bill">
            <div class="flex-grow-1" style="min-width: 0">
              <div class="font-weight-bold" style="font-size: var(--oo-fs-lead); line-height: 1.25">{{ t.supplierName }}</div>
              <div class="muted" style="font-size: var(--oo-fs-micro)">
                vence {{ date(t.dueDate) }}<template v-if="t.projectNames"> · {{ t.projectNames }}</template>
              </div>
            </div>
            <div class="text-right">
              <div class="money font-weight-bold" style="font-size: var(--oo-fs-lead)">{{ brl(t.amount - t.paidAmount) }}</div>
              <PayableChip :status="t.status" :due-date="t.dueDate" />
            </div>
          </div>
          <div v-if="!data.upcomingPayables.length" class="muted py-3">Nada a pagar nos próximos 30 dias.</div>
        </v-card>
      </v-col>
      <v-col cols="12" lg="5">
        <v-card class="pa-5">
          <div class="card-title">Para onde foi o dinheiro</div>
          <div class="muted mb-3" style="font-size: var(--oo-fs-micro)">Notas aprovadas no período, da maior para a menor.</div>
          <BarList :items="costItems" total-label="Total gasto no período" empty-text="Nenhuma nota aprovada neste período." />
        </v-card>
        <div class="mt-2"></div>
        <v-card class="pa-5">
          <div class="d-flex justify-space-between align-center flex-wrap ga-2 mb-1">
            <div class="card-title d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-magnify-scan</v-icon>O que o sistema encontrou
            </div>
            <router-link class="link" to="/inteligencia">Ver tudo</router-link>
          </div>
          <div class="muted mb-3" style="font-size: var(--oo-fs-micro)">
            Conferências automáticas nas notas e nas compras.<template v-if="data.kpis.criticalAlerts">&nbsp;{{ data.kpis.criticalAlerts }} precisa(m) de atenção.</template>
          </div>
          <div class="d-flex flex-column ga-2">
            <AlertItem v-for="a in data.alerts" :key="a.id" :alert="a" compact @open="openAlert(a)" />
            <div v-if="!data.alerts.length" class="state state-ok"><v-icon size="16">mdi-check-circle</v-icon>Nada pendente. Está tudo em ordem.</div>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </template>
</template>

<style scoped>
.todo {
  background: var(--oo-attention-bg);
  border: 1px solid #f0dcb4;
  border-radius: 14px;
  padding: 18px 20px;
}
.todo-title {
  display: flex;
  align-items: center;
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 12px;
}
.todo-list {
  display: grid;
  gap: 10px;
}
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  background: #fff;
  border-radius: 10px;
  padding: 14px 16px;
}
.project-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 14px 12px;
  margin: 0 -12px;
  border-radius: 10px;
  cursor: pointer;
}
.project-row + .project-row {
  border-top: 1px solid var(--oo-border);
}
.project-row:hover {
  background: #f6faf8;
}
.bill {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
}
.bill + .bill {
  border-top: 1px solid var(--oo-border);
}
</style>
