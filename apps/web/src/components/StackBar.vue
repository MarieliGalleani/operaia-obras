<script setup lang="ts">
/**
 * Orçamento da obra em três pedaços: já pago, ainda falta pagar e o que sobra.
 * Sempre com legenda escrita e valor, para não depender de reconhecer cor.
 * `columns` arruma a legenda em duas colunas (cabe em cartão estreito).
 */
import { computed } from 'vue'
import { brl } from '@/lib/format'

const props = defineProps<{ paid: number; open: number; budget: number; legend?: boolean; columns?: boolean }>()
const parts = computed(() => {
  const total = Math.max(props.budget, props.paid + props.open, 1)
  return {
    paid: (props.paid / total) * 100,
    open: (props.open / total) * 100,
    rest: Math.max(props.budget - props.paid - props.open, 0),
  }
})
</script>

<template>
  <div>
    <div class="stack-bar" role="img" :aria-label="`Pago ${brl(paid)}, ainda falta pagar ${brl(open)}, sobra do orçamento ${brl(parts.rest)}`">
      <span :style="{ width: parts.paid + '%', background: 'linear-gradient(90deg,var(--oo-primary-deep),var(--oo-primary))' }" />
      <span :style="{ width: parts.open + '%', background: 'linear-gradient(90deg,var(--oo-orange),#f8a94d)' }" />
    </div>

    <div v-if="legend && columns" class="legend-tight">
      <div><span class="legend-dot" style="background: var(--oo-primary)" />Já pago<b class="money">{{ brl(paid) }}</b></div>
      <div><span class="legend-dot" style="background: var(--oo-orange)" />Falta pagar<b class="money">{{ brl(open) }}</b></div>
      <div class="rest"><span class="legend-dot" style="background: var(--oo-track)" />Sobra do orçamento<b class="money">{{ brl(parts.rest) }}</b></div>
    </div>

    <div v-else-if="legend" class="legend-rows">
      <div><span class="legend-dot" style="background: var(--oo-primary)" />Já pago<b class="money">{{ brl(paid) }}</b></div>
      <div><span class="legend-dot" style="background: var(--oo-orange)" />Ainda falta pagar<b class="money">{{ brl(open) }}</b></div>
      <div><span class="legend-dot" style="background: var(--oo-track)" />Sobra do orçamento<b class="money">{{ brl(parts.rest) }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.legend-tight {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  font-size: 0.78125rem;
  color: var(--oo-muted);
}
.legend-tight > div {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}
.legend-tight .legend-dot {
  flex: none;
}
.legend-tight b {
  margin-left: auto;
  font-size: 0.875rem;
  color: var(--oo-text);
}
.legend-tight .rest {
  padding-top: 7px;
  border-top: 1px solid var(--oo-line);
}

.legend-rows {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  font-size: var(--oo-fs-micro);
}
.legend-rows > div {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.legend-rows b {
  margin-left: auto;
  font-size: var(--oo-fs-body);
  white-space: nowrap;
}
</style>
