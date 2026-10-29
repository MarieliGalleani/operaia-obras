<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AlertItem from '@/components/AlertItem.vue'
import DonutChart from '@/components/DonutChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import PayableChip from '@/components/PayableChip.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import ProjectThumb from '@/components/ProjectThumb.vue'
import StackBar from '@/components/StackBar.vue'
import { api } from '@/lib/api'
import { brl, date, pct } from '@/lib/format'
import { currentMonth } from '@/lib/period'
import { toastError } from '@/lib/toast'

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
  if (c == null) return { text: 'sem base de comparação', color: undefined }
  return { text: `${c >= 0 ? '↑' : '↓'} ${pct(Math.abs(c))} vs período anterior`, color: c > 0 ? 'error' : 'success' }
})

function openAlert(a: Dashboard['alerts'][number]) {
  if (a.documentId) router.push({ name: 'documents', query: { doc: a.documentId } })
  else if (a.projectId) router.push({ name: 'project', params: { id: a.projectId } })
  else router.push({ name: 'alerts' })
}
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Visão Geral</div>
      <div class="page-subtitle">Acompanhe custos, compromissos e alertas das suas obras.</div>
    </div>
    <PeriodPicker v-model="period" />
  </div>

  <v-skeleton-loader v-if="loading && !data" type="card, card" />

  <template v-if="data">
    <v-alert
      v-if="data.kpis.documentsPending"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
      icon="mdi-inbox-arrow-down-outline"
    >
      <span>
        <strong>{{ data.kpis.documentsPending }}</strong> nota(s) aguardando conferência.
        <router-link class="link ml-1" :to="{ name: 'documents' }">Revisar agora →</router-link>
      </span>
    </v-alert>

    <v-row dense class="mb-2">
      <v-col cols="12" sm="6" lg>
        <KpiCard label="Custo apropriado" :value="brl(data.kpis.appropriatedCost, { compact: true })" :hint="change.text" :hint-color="change.color" />
      </v-col>
      <v-col cols="12" sm="6" lg>
        <KpiCard label="Comprometido (a pagar)" :value="brl(data.kpis.openPayables, { compact: true })" hint="títulos em aberto" />
      </v-col>
      <v-col cols="12" sm="6" lg>
        <KpiCard label="Orçamento total" :value="brl(data.kpis.budgetTotal, { compact: true })" :progress="data.kpis.budgetCommittedPct" />
      </v-col>
      <v-col cols="6" sm="3" lg>
        <KpiCard
          label="Obras ativas"
          :value="String(data.kpis.activeProjects).padStart(2, '0')"
          :hint="data.kpis.newProjectsThisPeriod ? `+${data.kpis.newProjectsThisPeriod} novas no período` : undefined"
          hint-color="success"
        />
      </v-col>
      <v-col cols="6" sm="3" lg>
        <KpiCard
          label="Alertas"
          icon="mdi-alert"
          :value="String(data.kpis.openAlerts).padStart(2, '0')"
          :value-color="data.kpis.criticalAlerts ? 'error' : undefined"
          :hint="`${data.kpis.criticalAlerts} crítico(s)`"
          :hint-color="data.kpis.criticalAlerts ? 'error' : undefined"
        />
      </v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" lg="7">
        <v-card class="pa-5 h-100">
          <div class="d-flex justify-space-between align-center mb-3">
            <div class="card-title">Obras</div>
            <router-link class="link text-body-2" to="/obras">Ver todas →</router-link>
          </div>
          <div
            v-for="p in data.projects"
            :key="p.id"
            class="project-row"
            @click="router.push({ name: 'project', params: { id: p.id } })"
          >
            <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="64" />
            <div class="flex-grow-1" style="min-width: 0">
              <div class="d-flex justify-space-between align-start ga-2 flex-wrap">
                <div>
                  <div class="font-weight-medium text-body-2">{{ p.name }}</div>
                  <div class="text-caption" :class="p.committedPct >= 90 ? 'text-error' : 'muted'">{{ pct(p.committedPct) }} comprometido</div>
                </div>
                <div class="text-body-2 money">
                  <strong>{{ brl(p.paid + p.open, { compact: true }) }}</strong>
                  <span class="muted"> / {{ brl(p.budget, { compact: true }) }}</span>
                </div>
              </div>
              <StackBar class="mt-2" :paid="p.paid" :open="p.open" :budget="p.budget" />
            </div>
          </div>
          <div v-if="!data.projects.length" class="muted text-body-2">Nenhuma obra ativa. <router-link class="link" to="/obras">Cadastrar obra</router-link></div>
          <div class="text-caption muted mt-3">
            <span class="mr-4"><span class="legend-dot" style="background: var(--oo-bright)" />Pago</span>
            <span class="mr-4"><span class="legend-dot" style="background: var(--oo-accent)" />Comprometido (a pagar)</span>
            <span><span class="legend-dot" style="background: var(--oo-track)" />Saldo do orçamento</span>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" lg="5">
        <v-card class="pa-5 h-100">
          <div class="card-title mb-4">Custos por categoria</div>
          <DonutChart :data="data.costsByCategory" />
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card class="pa-5 h-100">
          <div class="d-flex justify-space-between align-center mb-2">
            <div class="card-title">Contas a pagar <span class="font-weight-regular muted">(próximos 30 dias)</span></div>
            <router-link class="link text-body-2" to="/contas-a-pagar">Ver todas →</router-link>
          </div>
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Fornecedor</th>
                <th class="d-none d-md-table-cell">Obra</th>
                <th class="text-right">Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in data.upcomingPayables" :key="t.id">
                <td :class="new Date(t.dueDate) < new Date() ? 'text-error font-weight-medium' : ''">{{ date(t.dueDate) }}</td>
                <td>
                  <div class="text-truncate" style="max-width: 170px">{{ t.supplierName }}</div>
                  <div class="text-caption muted text-truncate" style="max-width: 170px">{{ t.description }}</div>
                </td>
                <td class="d-none d-md-table-cell"><div class="text-truncate" style="max-width: 120px">{{ t.projectNames ?? '—' }}</div></td>
                <td class="text-right money">{{ brl(t.amount - t.paidAmount) }}</td>
                <td><PayableChip :status="t.status" :due-date="t.dueDate" /></td>
              </tr>
              <tr v-if="!data.upcomingPayables.length">
                <td colspan="5" class="muted text-center">Nada a pagar nos próximos 30 dias.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
      <v-col cols="12" lg="5">
        <v-card class="pa-5 h-100">
          <div class="d-flex justify-space-between align-center mb-3">
            <div class="card-title d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-creation-outline</v-icon>Inteligência da OperaIA
              <v-chip color="primary" variant="tonal" class="ml-2">regras</v-chip>
            </div>
            <router-link class="link text-body-2" to="/inteligencia">Ver todos →</router-link>
          </div>
          <div class="d-flex flex-column ga-2">
            <AlertItem v-for="a in data.alerts" :key="a.id" :alert="a" compact @open="openAlert(a)" />
            <div v-if="!data.alerts.length" class="muted text-body-2">Nenhum alerta aberto. Tudo sob controle.</div>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </template>
</template>

<style scoped>
.project-row {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 10px;
  margin: 0 -10px;
  border-radius: 10px;
  cursor: pointer;
}
.project-row:hover {
  background: #f8faf9;
}
</style>
