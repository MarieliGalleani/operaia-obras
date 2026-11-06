<script setup lang="ts">
/**
 * Acerto das sugestões (área da dona) — plano de validação: ≥ 95% nos campos críticos.
 * Na aprovação de cada nota o sistema compara o que sugeriu com o que a pessoa confirmou.
 */
import { computed, onMounted, ref, watch } from 'vue'
import KpiCard from '@/components/KpiCard.vue'
import { api } from '@/lib/api'
import { brl, categoryLabel, date } from '@/lib/format'
import { toastError } from '@/lib/toast'

type Field = 'obra' | 'categoria' | 'vencimento' | 'pedido' | 'fornecedor' | 'valor' | 'numero' | 'emissao'
interface Summary {
  acertou: number
  errou: number
  semSugestao: number
  total: number
  rate: number | null
  precision: number | null
}
interface Accuracy {
  target: number
  documentsMeasured: number
  documentsBeforeMeasurement: number
  critical: Summary
  fields: Array<Summary & { field: Field; critical: boolean }>
  companies: Array<Summary & { companyId: string; name: string; fields: Partial<Record<Field, number | null>> }>
  trend: Array<Summary & { month: string }>
  misses: Array<{
    id: string
    documentId: string
    company: string
    document: string
    supplier: string | null
    field: Field
    outcome: 'ERROU' | 'SEM_SUGESTAO'
    suggested: string | null
    final: string | null
    reason: string | null
    at: string
  }>
}

const LABEL: Record<Field, string> = {
  obra: 'Obra',
  categoria: 'Categoria',
  vencimento: 'Vencimentos',
  pedido: 'Pedido de compra',
  fornecedor: 'Fornecedor',
  valor: 'Valor',
  numero: 'Número',
  emissao: 'Data de emissão',
}
const HINT: Record<Field, string> = {
  obra: 'pelo texto da nota, pelo pedido ou pelo histórico do fornecedor',
  categoria: 'pelo padrão do fornecedor, NCM, CFOP ou item de serviço',
  vencimento: 'duplicatas que vieram na nota',
  pedido: 'vínculo automático pelo número do pedido (não conta na meta)',
  fornecedor: 'lido por IA',
  valor: 'lido por IA',
  numero: 'lido por IA',
  emissao: 'lido por IA',
}

const PERIODS = [
  { title: '30 dias', value: 30 },
  { title: '90 dias', value: 90 },
  { title: 'Tudo', value: 0 },
]
const days = ref(90)
const companyId = ref<string | null>(null)
const data = ref<Accuracy | null>(null)
const companyOptions = ref<{ title: string; value: string }[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const q = new URLSearchParams()
    if (days.value) q.set('days', String(days.value))
    if (companyId.value) q.set('companyId', companyId.value)
    data.value = await api.get<Accuracy>(`/api/platform/accuracy?${q}`)
    if (!companyId.value) companyOptions.value = data.value.companies.map((c) => ({ title: c.name, value: c.companyId })).sort((a, b) => a.title.localeCompare(b.title))
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
watch([days, companyId], load)
onMounted(load)

const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const color = (v: number | null) => (v === null ? 'grey' : v >= (data.value?.target ?? 95) ? 'success' : v >= 80 ? 'warning' : 'error')
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00-03:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '')

/** Mostra a sugestão/valor final de forma legível por campo */
function show(field: Field, v: string | null) {
  if (v == null || v === '') return '—'
  if (field === 'categoria') return v.split(',').map(categoryLabel).join(', ')
  if (field === 'valor') return brl(Number(v))
  if (field === 'emissao') return date(`${v}T12:00:00-03:00`)
  if (field === 'vencimento')
    return v
      .split(' | ')
      .map((p) => {
        const [d, a] = p.split('=')
        return `${date(`${d}T12:00:00-03:00`)} ${brl(Number(a))}`
      })
      .join(' · ')
  return v
}
const criticalFields = computed(() => data.value?.fields.filter((f) => f.critical) ?? [])
const otherFields = computed(() => data.value?.fields.filter((f) => !f.critical) ?? [])
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="text-overline muted" style="letter-spacing: 0.08em">Área da dona</div>
      <div class="page-title">Acerto das sugestões</div>
      <div class="page-subtitle">
        Quanto do que o sistema sugere a pessoa aprova sem mexer. Meta do plano de validação: {{ data?.target ?? 95 }}% nos campos críticos.
      </div>
    </div>
    <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="{ name: 'platform' }">Plataforma</v-btn>
  </div>

  <div class="d-flex align-center flex-wrap ga-3 mb-4">
    <v-btn-toggle v-model="days" mandatory density="comfortable" color="primary" variant="outlined" divided>
      <v-btn v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.title }}</v-btn>
    </v-btn-toggle>
    <v-select v-model="companyId" :items="companyOptions" label="Construtora" clearable density="compact" hide-details style="max-width: 300px" placeholder="Todas" />
    <v-progress-circular v-if="loading" indeterminate size="18" width="2" color="primary" />
  </div>

  <template v-if="data">
    <v-row dense class="mb-2">
      <v-col cols="12" sm="6" md="3">
        <KpiCard
          label="Acerto nos campos críticos"
          :value="pct(data.critical.rate)"
          :value-color="data.critical.rate === null ? undefined : color(data.critical.rate)"
          :hint="data.critical.total ? `quando sugere, acerta ${pct(data.critical.precision)} · meta ${data.target}%` : 'nenhuma nota aprovada com medição ainda'"
        />
      </v-col>
      <v-col cols="6" md="3">
        <KpiCard
          label="Notas medidas"
          :value="String(data.documentsMeasured)"
          :hint="data.documentsBeforeMeasurement ? `${data.documentsBeforeMeasurement} aprovada(s) antes da medição existir` : 'toda nota aprovada entra'"
        />
      </v-col>
      <v-col cols="6" md="3"><KpiCard label="Campos conferidos" :value="String(data.critical.total)" :hint="`${data.critical.acertou} aprovados sem mexer`" /></v-col>
      <v-col cols="12" md="3">
        <KpiCard
          label="Trabalho da pessoa"
          :value="String(data.critical.errou + data.critical.semSugestao)"
          :hint="`${data.critical.errou} sugestão(ões) trocada(s) · ${data.critical.semSugestao} sem sugestão`"
          :hint-color="data.critical.errou ? 'warning' : undefined"
        />
      </v-col>
    </v-row>

    <v-card class="mb-4">
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Campo</th>
            <th class="text-right">Aprovado sem mexer</th>
            <th class="text-right">Trocado</th>
            <th class="text-right">Sem sugestão</th>
            <th style="min-width: 220px">Acerto</th>
            <th class="text-right">Quando sugere</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in [...criticalFields, ...otherFields]" :key="f.field" :class="{ 'not-critical': !f.critical }">
            <td>
              <div class="font-weight-medium">{{ LABEL[f.field] }}</div>
              <div class="text-caption muted">{{ HINT[f.field] }}</div>
            </td>
            <td class="text-right">{{ f.acertou }}</td>
            <td class="text-right" :class="{ 'text-warning font-weight-medium': f.errou }">{{ f.errou }}</td>
            <td class="text-right">{{ f.semSugestao }}</td>
            <td>
              <div class="d-flex align-center ga-2">
                <div class="bar-track">
                  <div class="bar-fill" :class="`bg-${color(f.rate)}`" :style="{ width: `${f.rate ?? 0}%` }" />
                  <div class="bar-target" :style="{ left: `${data.target}%` }" />
                </div>
                <span class="font-weight-bold rate">{{ pct(f.rate) }}</span>
              </div>
            </td>
            <td class="text-right">{{ pct(f.precision) }}</td>
          </tr>
          <tr v-if="!data.fields.length">
            <td colspan="6" class="text-center muted py-6">Ainda não há notas aprovadas com medição neste período.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-row dense>
      <v-col cols="12" lg="5">
        <v-card class="pa-4 h-100">
          <div class="card-title mb-3">Por construtora</div>
          <div v-for="c in data.companies" :key="c.companyId" class="company-row">
            <div class="flex-grow-1">
              <div class="font-weight-medium">{{ c.name }}</div>
              <div class="text-caption muted">
                {{ c.total }} campo(s) ·
                <template v-for="(v, k, i) in c.fields" :key="k">{{ i ? ' · ' : '' }}{{ LABEL[k as Field].toLowerCase() }} {{ pct(v ?? null) }}</template>
              </div>
            </div>
            <v-chip size="small" variant="tonal" :color="color(c.rate)">{{ pct(c.rate) }}</v-chip>
          </div>
          <div v-if="!data.companies.length" class="muted text-body-2">Nenhuma construtora com medição.</div>
          <template v-if="data.trend.length > 1">
            <div class="card-title mt-5 mb-2">Por mês</div>
            <div class="d-flex flex-wrap ga-2">
              <v-chip v-for="t in data.trend" :key="t.month" size="small" variant="outlined" :color="color(t.rate)">{{ monthLabel(t.month) }} · {{ pct(t.rate) }}</v-chip>
            </div>
          </template>
        </v-card>
      </v-col>
      <v-col cols="12" lg="7">
        <v-card class="pa-4 h-100">
          <div class="card-title mb-1">Onde a pessoa precisou mexer</div>
          <div class="text-caption muted mb-3">Últimos casos, com o motivo da sugestão. É aqui que se ajusta a regra (palavra-chave, padrão do fornecedor, código da obra).</div>
          <div v-for="m in data.misses" :key="m.id" class="miss">
            <div class="d-flex align-center justify-space-between ga-2">
              <div class="text-body-2">
                <router-link :to="{ path: '/notas', query: { doc: m.documentId } }" class="font-weight-medium link">{{ m.document }}</router-link>
                <span class="muted"> · {{ m.supplier ?? 'sem fornecedor' }} · {{ m.company }}</span>
              </div>
              <span class="text-caption muted">{{ date(m.at) }}</span>
            </div>
            <div class="text-body-2 mt-1">
              <v-chip size="x-small" :color="m.outcome === 'ERROU' ? 'warning' : 'grey'" variant="tonal" class="mr-1">{{ LABEL[m.field] }}</v-chip>
              <template v-if="m.outcome === 'ERROU'">
                sugeriu <b>{{ show(m.field, m.suggested) }}</b> → aprovado <b>{{ show(m.field, m.final) }}</b>
              </template>
              <template v-else>sem sugestão → preenchido <b>{{ show(m.field, m.final) }}</b></template>
            </div>
            <div v-if="m.reason" class="text-caption muted mt-1">motivo da sugestão: {{ m.reason }}</div>
          </div>
          <div v-if="!data.misses.length" class="muted text-body-2">Nenhum ajuste no período.</div>
        </v-card>
      </v-col>
    </v-row>

    <div class="text-caption muted mt-3 explain">
      Acerto = campos aprovados exatamente como o sistema sugeriu ÷ todos os campos conferidos (inclui os que ficaram sem sugestão, porque a pessoa teve que
      preencher). "Quando sugere" mostra só a precisão das sugestões feitas. Fornecedor, valor, número e data lidos do XML são exatos e não entram; eles passam a
      contar quando a leitura de PDF e foto por IA estiver ligada. Vencimentos só contam quando vieram na nota.
    </div>
  </template>
</template>

<style scoped>
.bar-track {
  position: relative;
  flex: 1;
  height: 8px;
  background: #eef1ef;
  border-radius: 4px;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
}
.bar-target {
  position: absolute;
  top: -4px;
  bottom: -4px;
  border-left: 2px dashed #16211d;
  opacity: 0.5;
}
.rate {
  min-width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.not-critical {
  opacity: 0.75;
}
.company-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.miss {
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.link {
  color: inherit;
}
.explain {
  max-width: 900px;
  line-height: 1.5;
}
</style>
