<script setup lang="ts">
/**
 * Margem de contribuição por cliente (área da dona) — métrica principal do plano de validação.
 * Receita da mensalidade − custos variáveis de cada construtora no mês. Meta padrão: 70%.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import { api } from '@/lib/api'
import { brl, centsToInput, parseBRL } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'

interface Settings {
  storagePerGbCents: number
  supportHourCents: number
  paymentFeeBps: number
  paymentFixedCents: number
  fixedMonthlyCents: number
  targetPct: number
}
interface Row {
  companyId: string
  name: string
  status: 'ATIVA' | 'SUSPENSA'
  plan: string | null
  billingSince: string | null
  revenue: number
  setupRevenue: number
  costs: { storage: number; payment: number; support: number; ai: number; other: number }
  variableCosts: number
  margin: number
  marginPct: number | null
  marginStatus: 'OK' | 'ABAIXO' | 'NEGATIVA' | 'SEM_RECEITA'
  usage: { storageBytes: number; documentsInMonth: number; usersActive: number; supportSessions: number }
  manual: { supportMinutes: number; aiCost: number; otherCost: number; revenueAdjust: number; notes: string | null }
}
interface Margin {
  month: string
  settings: Settings
  rows: Row[]
  totals: {
    revenue: number
    setupRevenue: number
    variableCosts: number
    margin: number
    marginPct: number | null
    payingCompanies: number
    belowTarget: number
    fixedCosts: number
    result: number
    breakEvenCompanies: number | null
  }
  trend: { month: string; revenue: number; margin: number; marginPct: number | null; payingCompanies: number }[]
  filesToMeasure: number
}

const route = useRoute()
const router = useRouter()
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
const month = ref((route.query.mes as string) || today)
const data = ref<Margin | null>(null)
const loading = ref(false)

const PLAN: Record<string, string> = { PILOTO: 'Piloto', ESSENCIAL: 'Essencial', PROFISSIONAL: 'Profissional', AVANCADO: 'Avançado', CORTESIA: 'Cortesia' }
const STATUS = {
  OK: { color: 'success', text: 'na meta' },
  ABAIXO: { color: 'warning', text: 'abaixo da meta' },
  NEGATIVA: { color: 'error', text: 'negativa' },
  SEM_RECEITA: { color: 'grey', text: 'sem receita' },
} as const

const monthLabel = (m: string) => {
  const s = new Date(`${m}-15T12:00:00-03:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const shortMonth = (m: string) => new Date(`${m}-15T12:00:00-03:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
const shift = (delta: number) => {
  const [y, m] = month.value.split('-').map(Number)
  month.value = new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const size = (bytes: number) => {
  const [v, u] = bytes >= 1e9 ? [bytes / 1e9, 'GB'] : bytes >= 1e6 ? [bytes / 1e6, 'MB'] : [bytes / 1e3, 'KB']
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u}`
}

async function load() {
  loading.value = true
  try {
    data.value = await api.get<Margin>(`/api/platform/margin?month=${month.value}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
watch(month, (m) => {
  router.replace({ query: { ...route.query, mes: m } })
  load()
})
onMounted(load)

// pagantes primeiro, pior margem no topo: é onde agir
const rows = computed(() =>
  [...(data.value?.rows ?? [])].sort((a, b) => {
    if ((a.revenue > 0) !== (b.revenue > 0)) return a.revenue > 0 ? -1 : 1
    return (a.marginPct ?? 0) - (b.marginPct ?? 0)
  }),
)
const target = computed(() => data.value?.settings.targetPct ?? 70)
const trendMax = computed(() => Math.max(100, ...(data.value?.trend.map((t) => t.marginPct ?? 0) ?? [])))

// ---- custos do mês de uma construtora
const costDialog = ref(false)
const costRow = ref<Row | null>(null)
const costForm = ref({ supportMinutes: '0', aiCost: '', otherCost: '', revenueAdjust: '', notes: '' })
const saving = ref(false)
function openCosts(r: Row) {
  costRow.value = r
  costForm.value = {
    supportMinutes: String(r.manual.supportMinutes),
    aiCost: r.manual.aiCost ? centsToInput(r.manual.aiCost) : '',
    otherCost: r.manual.otherCost ? centsToInput(r.manual.otherCost) : '',
    revenueAdjust: r.manual.revenueAdjust ? centsToInput(r.manual.revenueAdjust) : '',
    notes: r.manual.notes ?? '',
  }
  costDialog.value = true
}
async function saveCosts() {
  if (!costRow.value) return
  saving.value = true
  try {
    const f = costForm.value
    await api.put(`/api/platform/companies/${costRow.value.companyId}/month-costs/${month.value}`, {
      supportMinutes: Math.max(0, Math.round(Number(f.supportMinutes.replace(',', '.')) || 0)),
      aiCost: parseBRL(f.aiCost || '0'),
      otherCost: parseBRL(f.otherCost || '0'),
      revenueAdjust: parseBRL(f.revenueAdjust || '0'),
      notes: f.notes || null,
    })
    costDialog.value = false
    toast('Custos do mês salvos')
    load()
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

// ---- parâmetros
const settingsDialog = ref(false)
const sForm = ref({ storagePerGb: '', supportHour: '', paymentPct: '', paymentFixed: '', fixedMonthly: '', targetPct: '' })
function openSettings() {
  const s = data.value!.settings
  sForm.value = {
    storagePerGb: centsToInput(s.storagePerGbCents),
    supportHour: centsToInput(s.supportHourCents),
    paymentPct: (s.paymentFeeBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
    paymentFixed: centsToInput(s.paymentFixedCents),
    fixedMonthly: centsToInput(s.fixedMonthlyCents),
    targetPct: String(s.targetPct),
  }
  settingsDialog.value = true
}
async function saveSettings() {
  saving.value = true
  try {
    const f = sForm.value
    await api.put('/api/platform/margin/settings', {
      storagePerGbCents: parseBRL(f.storagePerGb || '0'),
      supportHourCents: parseBRL(f.supportHour || '0'),
      paymentFeeBps: Math.round((Number(f.paymentPct.replace(',', '.')) || 0) * 100),
      paymentFixedCents: parseBRL(f.paymentFixed || '0'),
      fixedMonthlyCents: parseBRL(f.fixedMonthly || '0'),
      targetPct: Number(f.targetPct.replace(',', '.')) || 0,
    })
    settingsDialog.value = false
    toast('Parâmetros salvos')
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
      <div class="text-overline muted" style="letter-spacing: 0.08em">Área da dona</div>
      <div class="page-title">Margem por cliente</div>
      <div class="page-subtitle">Quanto sobra de cada construtora depois dos custos que ela gera. Meta do plano de validação: {{ target }}% ou mais.</div>
    </div>
    <div class="d-flex align-center ga-2 flex-wrap">
      <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="{ name: 'platform' }">Plataforma</v-btn>
      <v-btn variant="outlined" prepend-icon="mdi-tune-variant" :disabled="!data" @click="openSettings">Parâmetros de custo</v-btn>
    </div>
  </div>

  <div class="d-flex align-center ga-1 mb-4">
    <v-btn icon="mdi-chevron-left" variant="text" aria-label="Mês anterior" @click="shift(-1)" />
    <div class="text-h6 font-weight-bold month-label">{{ monthLabel(month) }}</div>
    <v-btn icon="mdi-chevron-right" variant="text" aria-label="Próximo mês" :disabled="month >= today" @click="shift(1)" />
    <v-progress-circular v-if="loading" indeterminate size="18" width="2" color="primary" class="ml-2" />
  </div>

  <template v-if="data">
    <v-row dense class="mb-2">
      <v-col cols="6" md>
        <KpiCard
          label="Margem de contribuição"
          :value="pct(data.totals.marginPct)"
          :value-color="data.totals.marginPct === null ? undefined : data.totals.marginPct >= target ? 'success' : 'warning'"
          :hint="data.totals.marginPct === null ? 'nenhuma construtora pagante no mês' : `${brl(data.totals.margin)} · meta ${target}%`"
        />
      </v-col>
      <v-col cols="6" md><KpiCard label="Receita recorrente" :value="brl(data.totals.revenue)" :hint="data.totals.setupRevenue ? `+ ${brl(data.totals.setupRevenue)} de implantação` : 'mensalidades do mês'" /></v-col>
      <v-col cols="6" md><KpiCard label="Custos variáveis" :value="brl(data.totals.variableCosts)" hint="armazenamento, taxas, suporte, IA e outros" /></v-col>
      <v-col cols="6" md>
        <KpiCard
          label="Construtoras pagantes"
          :value="String(data.totals.payingCompanies)"
          :hint="data.totals.belowTarget ? `${data.totals.belowTarget} abaixo da meta` : data.totals.payingCompanies ? 'todas na meta' : 'defina plano e mensalidade'"
          :hint-color="data.totals.belowTarget ? 'warning' : undefined"
        />
      </v-col>
      <v-col cols="6" md>
        <KpiCard
          label="Resultado após custos fixos"
          :value="brl(data.totals.result)"
          :value-color="data.totals.result < 0 ? 'error' : undefined"
          :hint="
            data.totals.fixedCosts
              ? `fixos ${brl(data.totals.fixedCosts)}${data.totals.breakEvenCompanies ? ` · equilíbrio com ${data.totals.breakEvenCompanies} pagante(s)` : ''}`
              : 'informe os custos fixos nos parâmetros'
          "
        />
      </v-col>
    </v-row>

    <v-card class="pa-4 mb-4">
      <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-3">
        <div class="card-title">Últimos 6 meses</div>
        <div class="text-caption muted"><span class="legend-target" /> meta {{ target }}%</div>
      </div>
      <div class="trend">
        <div v-for="t in data.trend" :key="t.month" class="trend-col" :class="{ on: t.month === month }" @click="month = t.month">
          <div class="trend-val">{{ pct(t.marginPct) }}</div>
          <div class="trend-track">
            <div class="trend-target" :style="{ bottom: `${(target / trendMax) * 100}%` }" />
            <div
              class="trend-bar"
              :class="t.marginPct === null ? 'none' : t.marginPct >= target ? 'ok' : 'low'"
              :style="{ height: `${Math.max(0, ((t.marginPct ?? 0) / trendMax) * 100)}%` }"
            />
          </div>
          <div class="trend-month">{{ shortMonth(t.month) }}</div>
          <div class="trend-sub">{{ t.payingCompanies }} pag.</div>
        </div>
      </div>
    </v-card>

    <v-card>
      <v-table density="comfortable" class="margin-table">
        <thead>
          <tr>
            <th>Construtora</th>
            <th class="text-right">Receita</th>
            <th class="text-right">Armazenamento</th>
            <th class="text-right">Taxas</th>
            <th class="text-right">Suporte</th>
            <th class="text-right">IA e outros</th>
            <th class="text-right">Custos variáveis</th>
            <th class="text-right">Margem</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.companyId">
            <td>
              <router-link :to="{ name: 'platform-company', params: { id: r.companyId } }" class="font-weight-medium name-link">{{ r.name }}</router-link>
              <div class="text-caption muted">
                <template v-if="r.plan">{{ PLAN[r.plan] }}</template><template v-else>sem plano</template>
                · {{ r.usage.documentsInMonth }} nota(s) no mês · {{ r.usage.usersActive }} pessoa(s)
                <template v-if="r.status === 'SUSPENSA'"> · suspensa</template>
              </div>
            </td>
            <td class="text-right money">
              {{ brl(r.revenue) }}
              <div v-if="r.manual.revenueAdjust" class="text-caption muted">ajuste {{ brl(r.manual.revenueAdjust) }}</div>
              <div v-if="r.setupRevenue" class="text-caption muted">+ {{ brl(r.setupRevenue) }} implantação</div>
            </td>
            <td class="text-right money">
              {{ brl(r.costs.storage) }}
              <div class="text-caption muted">{{ size(r.usage.storageBytes) }}</div>
            </td>
            <td class="text-right money">{{ brl(r.costs.payment) }}</td>
            <td class="text-right money">
              {{ brl(r.costs.support) }}
              <div class="text-caption" :class="r.usage.supportSessions && !r.manual.supportMinutes ? 'text-warning' : 'muted'">
                {{ r.manual.supportMinutes }} min<template v-if="r.usage.supportSessions"> · {{ r.usage.supportSessions }} acesso(s) de suporte</template>
              </div>
            </td>
            <td class="text-right money">{{ brl(r.costs.ai + r.costs.other) }}</td>
            <td class="text-right money">{{ brl(r.variableCosts) }}</td>
            <td class="text-right">
              <div class="money font-weight-bold">{{ r.revenue > 0 ? brl(r.margin) : '—' }}</div>
              <v-chip size="small" :color="STATUS[r.marginStatus].color" variant="tonal" class="mt-1">
                {{ r.marginPct === null ? STATUS[r.marginStatus].text : pct(r.marginPct) }}
              </v-chip>
            </td>
            <td class="text-right">
              <v-btn size="small" variant="text" icon="mdi-pencil-outline" :aria-label="`Lançar custos de ${r.name}`" @click="openCosts(r)" />
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="9" class="text-center muted py-6">Nenhuma construtora neste mês.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <div class="text-caption muted mt-3 explain">
      Margem = mensalidade do mês − (armazenamento dos arquivos × {{ brl(data.settings.storagePerGbCents) }}/GB + taxa do meio de pagamento + minutos de suporte ×
      {{ brl(data.settings.supportHourCents) }}/h + IA + outros). Custos fixos (servidor, domínio, ferramentas) ficam fora da margem e entram só no resultado.
      Implantação é receita única e aparece à parte. Plano, mensalidade e início da cobrança ficam na página de cada construtora.
      <template v-if="data.filesToMeasure"> Ainda faltam {{ data.filesToMeasure }} arquivo(s) antigos para medir: o armazenamento sobe um pouco a cada abertura desta tela.</template>
    </div>
  </template>

  <v-dialog v-model="costDialog" max-width="480">
    <v-card v-if="costRow" class="pa-5">
      <div class="card-title mb-1">Custos de {{ costRow.name }}</div>
      <div class="text-body-2 muted mb-4">{{ monthLabel(month) }}. Armazenamento e taxas são calculados sozinhos.</div>
      <v-text-field
        v-model="costForm.supportMinutes"
        label="Minutos de suporte e implantação"
        type="number"
        min="0"
        class="mb-3"
        :hint="costRow.usage.supportSessions ? `${costRow.usage.supportSessions} acesso(s) de suporte (Entrar como) neste mês` : undefined"
        persistent-hint
      />
      <v-row dense>
        <v-col cols="6"><v-text-field v-model="costForm.aiCost" label="IA (R$)" placeholder="0,00" /></v-col>
        <v-col cols="6"><v-text-field v-model="costForm.otherCost" label="Outros (R$)" placeholder="0,00" /></v-col>
      </v-row>
      <v-text-field v-model="costForm.revenueAdjust" label="Ajuste na receita (R$)" placeholder="0,00" hint="Negativo para desconto (ex.: -39,90)" persistent-hint class="mt-2 mb-3" />
      <v-textarea v-model="costForm.notes" label="Observação" rows="2" />
      <div class="d-flex justify-end ga-2 mt-4">
        <v-btn variant="text" @click="costDialog = false">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="saveCosts">Salvar</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <v-dialog v-model="settingsDialog" max-width="520">
    <v-card class="pa-5">
      <div class="card-title mb-1">Parâmetros de custo</div>
      <div class="text-body-2 muted mb-4">Valem para todas as construtoras e todos os meses.</div>
      <v-row dense>
        <v-col cols="6"><v-text-field v-model="sForm.storagePerGb" label="Armazenamento (R$ por GB/mês)" hint="Cloudflare R2 ≈ R$ 0,09" persistent-hint /></v-col>
        <v-col cols="6"><v-text-field v-model="sForm.supportHour" label="Hora de suporte (R$)" /></v-col>
        <v-col cols="6"><v-text-field v-model="sForm.paymentPct" label="Taxa do pagamento (%)" hint="Ex.: 1,99 no cartão" persistent-hint /></v-col>
        <v-col cols="6"><v-text-field v-model="sForm.paymentFixed" label="Taxa fixa por cobrança (R$)" hint="Ex.: boleto" persistent-hint /></v-col>
        <v-col cols="6"><v-text-field v-model="sForm.fixedMonthly" label="Custos fixos do mês (R$)" hint="Servidor, domínio, ferramentas" persistent-hint /></v-col>
        <v-col cols="6"><v-text-field v-model="sForm.targetPct" label="Meta de margem (%)" /></v-col>
      </v-row>
      <div class="d-flex justify-end ga-2 mt-5">
        <v-btn variant="text" @click="settingsDialog = false">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="saveSettings">Salvar</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.month-label {
  min-width: 180px;
  text-align: center;
}
.margin-table td {
  vertical-align: top;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
.name-link {
  color: inherit;
  text-decoration: none;
}
.name-link:hover {
  text-decoration: underline;
}
.trend {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}
.trend-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  border-radius: 8px;
  padding: 6px 0;
}
.trend-col.on {
  background: rgba(15, 92, 72, 0.06);
}
.trend-val {
  font-size: 0.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.trend-track {
  position: relative;
  width: 28px;
  height: 90px;
  margin: 6px 0;
  background: #eef1ef;
  border-radius: 4px;
  overflow: hidden;
}
.trend-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 4px 4px 0 0;
}
.trend-bar.ok {
  background: rgb(var(--v-theme-success));
}
.trend-bar.low {
  background: rgb(var(--v-theme-warning));
}
.trend-target {
  position: absolute;
  left: -4px;
  right: -4px;
  border-top: 2px dashed #16211d;
  opacity: 0.45;
  z-index: 1;
}
.legend-target {
  display: inline-block;
  width: 16px;
  border-top: 2px dashed #16211d;
  opacity: 0.45;
  vertical-align: middle;
  margin-right: 4px;
}
.trend-month {
  font-size: 0.78rem;
  text-transform: capitalize;
}
.trend-sub {
  font-size: 0.7rem;
  color: var(--oo-muted);
}
.explain {
  max-width: 900px;
  line-height: 1.5;
}
</style>
