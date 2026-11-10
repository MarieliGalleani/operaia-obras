<script setup lang="ts">
/**
 * Comparação de tamanho (quanto foi para cada coisa), do maior para o menor.
 * Uma só cor: a barra mais comprida é a maior. O nome e o valor estão escritos em cada linha,
 * então a pessoa não precisa decorar legenda nem relacionar cores.
 */
import { computed } from 'vue'
import { brl } from '@/lib/format'

const props = defineProps<{
  items: { key: string; label: string; amount: number }[]
  /** rótulo do total, escrito embaixo */
  totalLabel?: string
  emptyText?: string
}>()

const SHADES = ['var(--oo-data-1)', 'var(--oo-data-2)', 'var(--oo-data-3)', 'var(--oo-data-4)', 'var(--oo-data-5)']
const fade = (c: string) => `linear-gradient(90deg, ${c} 0%, color-mix(in srgb, ${c} 55%, #fff) 100%)`
const rows = computed(() => {
  const list = props.items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount)
  const max = list.length ? list[0].amount : 1
  const total = list.reduce((a, b) => a + b.amount, 0)
  return list.map((i, idx) => ({
    ...i,
    width: Math.max((i.amount / max) * 100, 2),
    share: total ? Math.round((i.amount / total) * 100) : 0,
    color: SHADES[Math.min(idx, SHADES.length - 1)],
  }))
})
const total = computed(() => rows.value.reduce((a, b) => a + b.amount, 0))
</script>

<template>
  <div>
    <div v-for="r in rows" :key="r.key" class="bar-row">
      <div class="bar-head">
        <span class="bar-name">{{ r.label }}</span>
        <span class="money bar-amount">{{ brl(r.amount) }}</span>
      </div>
      <div class="bar-track">
        <span class="bar-fill" :style="{ width: r.width + '%', background: fade(r.color) }" />
      </div>
      <div v-if="rows.length > 1" class="bar-foot muted">{{ r.share }} de cada 100 reais gastos</div>
    </div>
    <div v-if="!rows.length" class="muted py-4">{{ emptyText ?? 'Nada lançado neste período.' }}</div>
    <div v-else class="bar-total">
      <span>{{ totalLabel ?? 'Total' }}</span>
      <span class="money font-weight-bold">{{ brl(total) }}</span>
    </div>
  </div>
</template>

<style scoped>
.bar-row {
  padding: 8px 0;
}
.bar-row + .bar-row {
  border-top: 1px solid var(--oo-line);
}
.bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 7px;
}
.bar-name {
  font-size: var(--oo-fs-body);
  font-weight: 600;
}
.bar-amount {
  font-size: var(--oo-fs-body);
  font-weight: 700;
}
.bar-track {
  height: 10px;
  border-radius: 999px;
  background: var(--oo-track);
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
}
.bar-foot {
  font-size: var(--oo-fs-micro);
  margin-top: 5px;
}
.bar-total {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1.5px solid var(--oo-border);
  font-size: var(--oo-fs-body);
}
</style>
