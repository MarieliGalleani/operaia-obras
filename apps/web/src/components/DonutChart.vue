<script setup lang="ts">
import { computed } from 'vue'
import { brl, categoryColor, categoryLabel } from '@/lib/format'

const props = defineProps<{ data: { category: string; total: number }[]; caption?: string }>()
const total = computed(() => props.data.reduce((a, b) => a + b.total, 0))
const R = 54
const C = 2 * Math.PI * R
const segments = computed(() => {
  let offset = 0
  return props.data.map((d) => {
    const frac = total.value ? d.total / total.value : 0
    const seg = { ...d, frac, dash: `${Math.max(frac * C - 2, 0)} ${C}`, offset: -offset }
    offset += frac * C
    return seg
  })
})
</script>

<template>
  <div class="donut-wrap">
    <div class="donut">
      <svg viewBox="0 0 140 140" width="168" height="168" role="img" aria-label="Custos por categoria">
        <circle cx="70" cy="70" :r="R" fill="none" stroke="#EEF1EF" stroke-width="20" />
        <circle
          v-for="s in segments"
          :key="s.category"
          cx="70"
          cy="70"
          :r="R"
          fill="none"
          :stroke="categoryColor(s.category)"
          stroke-width="20"
          :stroke-dasharray="s.dash"
          :stroke-dashoffset="s.offset"
          transform="rotate(-90 70 70)"
        >
          <title>{{ categoryLabel(s.category) }}: {{ brl(s.total) }}</title>
        </circle>
      </svg>
      <div class="center">
        <div class="money font-weight-bold" style="font-size: 0.95rem">{{ brl(total, { compact: true }) }}</div>
        <div class="text-caption muted">{{ caption ?? 'no período' }}</div>
      </div>
    </div>
    <div class="legend">
      <div v-for="s in segments" :key="s.category" class="d-flex align-center justify-space-between text-body-2 py-1">
        <span><span class="legend-dot" :style="{ background: categoryColor(s.category) }" />{{ categoryLabel(s.category) }}</span>
        <span class="font-weight-medium ml-4">{{ Math.round(s.frac * 100) }}%</span>
      </div>
      <div v-if="!segments.length" class="muted text-body-2">Nenhum custo aprovado no período.</div>
    </div>
  </div>
</template>

<style scoped>
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.donut {
  position: relative;
  width: 168px;
  height: 168px;
}
.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.legend {
  flex: 1;
  min-width: 160px;
}
</style>
