<script setup lang="ts">
/**
 * Orçamento da obra em três pedaços: já pago, ainda falta pagar e o que sobra.
 * Com legenda escrita e valor em cada pedaço, para não depender de reconhecer cor.
 */
import { computed } from 'vue'
import { brl } from '@/lib/format'

const props = defineProps<{ paid: number; open: number; budget: number; legend?: boolean }>()
const parts = computed(() => {
  const total = Math.max(props.budget, props.paid + props.open, 1)
  const rest = Math.max(props.budget - props.paid - props.open, 0)
  return {
    paid: (props.paid / total) * 100,
    open: (props.open / total) * 100,
    rest,
  }
})
</script>

<template>
  <div>
    <div class="stack-bar" role="img" :aria-label="`Pago ${brl(paid)}, ainda falta pagar ${brl(open)}, sobra do orçamento ${brl(parts.rest)}`">
      <span :style="{ width: parts.paid + '%', background: 'var(--oo-data-1)' }" />
      <span :style="{ width: parts.open + '%', background: 'var(--oo-attention)' }" />
    </div>
    <div v-if="legend" class="stack-legend">
      <div><span class="legend-dot" style="background: var(--oo-data-1)" />Já pago<b class="money">{{ brl(paid) }}</b></div>
      <div><span class="legend-dot" style="background: var(--oo-attention)" />Ainda falta pagar<b class="money">{{ brl(open) }}</b></div>
      <div><span class="legend-dot" style="background: var(--oo-track)" />Sobra do orçamento<b class="money">{{ brl(parts.rest) }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.stack-legend {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  font-size: var(--oo-fs-micro);
}
.stack-legend > div {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stack-legend b {
  margin-left: auto;
  font-size: var(--oo-fs-body);
}
</style>
