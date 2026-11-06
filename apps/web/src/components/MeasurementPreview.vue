<script setup lang="ts">
/**
 * Prévia da medição: o que o proprietário vai pagar no fechamento.
 * Usada no portal do proprietário, na obra (construtora) e na versão para imprimir.
 */
import { computed } from 'vue'
import { brl, categoryLabel, date } from '@/lib/format'
import { closingLabel, contractLabel, docLabel, monthName, ymdBR, type Measurement } from '@/lib/measurement'

const props = defineProps<{ m: Measurement; printable?: boolean; canOpenFiles?: boolean }>()
const emit = defineEmits<{ (e: 'open-file', id: string): void }>()

const admin = computed(() => props.m.contract.type === 'ADMINISTRACAO')
const pct = computed(() => props.m.fee.pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 }))
const groups = computed(() => props.m.realized.groups.filter((g) => g.amount > 0))
const PAY: Record<string, { text: string; color: string }> = {
  PAGO: { text: 'paga', color: 'success' },
  PARCIAL: { text: 'paga em parte', color: 'info' },
  ABERTO: { text: 'a pagar', color: 'warning' },
  SEM_TITULO: { text: '—', color: 'grey' },
}
</script>

<template>
  <div class="measure" :class="{ printable }">
    <div class="d-flex align-start justify-space-between flex-wrap ga-2 mb-4">
      <div>
        <div class="text-overline muted" style="letter-spacing: 0.08em">Prévia da medição</div>
        <div class="text-h6 font-weight-bold">{{ monthName(m.period.month) }}</div>
        <div class="text-body-2 muted">
          {{ ymdBR(m.period.first) }} a {{ ymdBR(m.period.last) }} · {{ contractLabel(m.contract) }} · {{ closingLabel(m.contract.measurementDay) }}
        </div>
      </div>
      <v-chip :color="m.period.closed ? 'secondary' : 'info'" variant="tonal" size="small">{{ m.period.closed ? 'período fechado' : 'em andamento' }}</v-chip>
    </div>

    <!-- o número que importa -->
    <div class="hero mb-4">
      <div>
        <div class="text-body-2 muted">{{ m.period.closed ? 'Total da medição' : 'Previsão até o fechamento' }}</div>
        <div class="hero-value money">{{ brl(m.totals.expected) }}</div>
        <div class="text-caption muted">
          custos {{ brl(m.totals.expectedCosts) }}<template v-if="admin"> + taxa de administração {{ brl(m.fee.total) }} ({{ pct }}%)</template>
        </div>
      </div>
      <div v-if="admin && m.contract.ownerPaysSuppliers" class="split">
        <div><span class="muted">Direto aos fornecedores</span><b class="money">{{ brl(m.totals.toSuppliers) }}</b></div>
        <div><span class="muted">À construtora (taxa)</span><b class="money">{{ brl(m.totals.toBuilder) }}</b></div>
      </div>
      <div v-else class="split">
        <div><span class="muted">Já lançado</span><b class="money">{{ brl(m.totals.realizedWithFee) }}</b></div>
        <div><span class="muted">Ainda vem</span><b class="money">{{ brl(m.totals.expected - m.totals.realizedWithFee) }}</b></div>
      </div>
    </div>

    <v-row dense>
      <v-col cols="12" md="6">
        <div class="box">
          <div class="box-title">Já lançado no período</div>
          <div v-for="g in groups" :key="g.key" class="line"><span>{{ g.label }}</span><span class="money">{{ brl(g.amount) }}</span></div>
          <div v-if="!groups.length" class="line muted"><span>Nenhuma nota aprovada ainda neste período.</span></div>
          <div class="line strong"><span>Custos lançados</span><span class="money">{{ brl(m.realized.total) }}</span></div>
          <div v-if="admin" class="line"><span>Taxa de administração ({{ pct }}%)</span><span class="money">{{ brl(m.fee.onRealized) }}</span></div>
          <div v-if="admin" class="line strong"><span>Subtotal</span><span class="money">{{ brl(m.totals.realizedWithFee) }}</span></div>
        </div>
      </v-col>
      <v-col cols="12" md="6">
        <div class="box">
          <div class="box-title">O que ainda vem até o fechamento</div>
          <div v-for="i in m.forecast.items" :key="i.id" class="line">
            <span>
              {{ i.kind === 'PEDIDO' ? 'Compra aprovada' : 'Nota em conferência' }} · {{ i.supplier ?? '—' }}
              <span class="text-caption muted">· {{ categoryLabel(i.category) }}<template v-if="i.date"> · {{ i.kind === 'PEDIDO' ? 'entrega' : 'emitida' }} {{ date(i.date) }}</template></span>
            </span>
            <span class="money">{{ brl(i.amount) }}</span>
          </div>
          <div v-if="!m.forecast.items.length" class="line muted"><span>Nada previsto além do já lançado.</span></div>
          <div class="line strong"><span>Custos previstos</span><span class="money">{{ brl(m.forecast.total) }}</span></div>
          <div v-if="admin" class="line"><span>Taxa de administração ({{ pct }}%)</span><span class="money">{{ brl(m.fee.onForecast) }}</span></div>
        </div>
      </v-col>
    </v-row>

    <div class="box mt-3">
      <div class="box-title">Notas do período ({{ m.realized.documents.length }})</div>
      <v-table density="compact" class="bg-transparent">
        <thead>
          <tr>
            <th>Data</th>
            <th>Nota</th>
            <th>Fornecedor</th>
            <th>Categoria</th>
            <th v-if="!printable">Pagamento</th>
            <th class="text-right">Valor na obra</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in m.realized.documents" :key="d.id">
            <td>{{ date(d.issueDate) }}</td>
            <td>
              <a v-if="canOpenFiles && d.hasFile && !printable" href="#" class="link" @click.prevent="emit('open-file', d.id)">{{ docLabel(d.type, d.number) }}</a>
              <template v-else>{{ docLabel(d.type, d.number) }}</template>
            </td>
            <td>{{ d.supplier ?? '—' }}</td>
            <td>{{ d.categories.map(categoryLabel).join(', ') }}</td>
            <td v-if="!printable"><v-chip size="x-small" variant="tonal" :color="PAY[d.payment].color">{{ PAY[d.payment].text }}</v-chip></td>
            <td class="text-right money">
              {{ brl(d.amount) }}
              <div v-if="d.amount !== d.documentTotal" class="text-caption muted">de {{ brl(d.documentTotal) }} (rateada)</div>
            </td>
          </tr>
          <tr v-if="!m.realized.documents.length">
            <td :colspan="printable ? 5 : 6" class="text-center muted py-4">Nenhuma nota aprovada neste período.</td>
          </tr>
        </tbody>
      </v-table>
    </div>

    <div v-if="m.due.length" class="box mt-3">
      <div class="box-title">Vencimentos no período</div>
      <div v-for="v in m.due" :key="v.id" class="line">
        <span>{{ date(v.dueDate) }} · {{ v.supplier ?? '—' }} <span class="text-caption muted">· {{ v.document }}</span></span>
        <span class="money">{{ brl(v.amount) }}</span>
      </div>
    </div>

    <div class="text-caption muted mt-3">
      Prévia calculada com as notas aprovadas (pela data de emissão), as notas que chegaram e aguardam conferência e o saldo das compras aprovadas com entrega
      até o fechamento.<template v-if="admin"> A taxa de administração incide sobre material e mão de obra.</template> Valores podem mudar até o fechamento.
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 12px;
  background: rgba(15, 92, 72, 0.06);
  border: 1px solid rgba(15, 92, 72, 0.14);
}
.hero-value {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.2;
}
.split {
  display: grid;
  gap: 4px;
  min-width: 240px;
}
.split > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 0.9rem;
}
.box {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 14px 16px;
  height: 100%;
  background: rgb(var(--v-theme-surface));
}
.box-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  font-size: 0.9rem;
}
.line.strong {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  margin-top: 4px;
  padding-top: 8px;
  font-weight: 600;
}
.link {
  color: rgb(var(--v-theme-primary));
}
.printable .box {
  break-inside: avoid;
}
</style>
