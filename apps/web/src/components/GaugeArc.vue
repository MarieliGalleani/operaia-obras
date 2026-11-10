<script setup lang="ts">
/**
 * Medidor em arco: um número grande com um arco que mostra o quanto já foi.
 * É a peça de leitura mais rápida da tela — a pessoa vê o preenchimento antes de ler o número.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    value: number
    label: string
    hint?: string
    /** acima de 100 o arco satura, mas a cor avisa */
    tone?: 'primary' | 'orange' | 'blue' | 'red' | 'auto'
    /** limites para o tom automático */
    warnAt?: number
    dangerAt?: number
    size?: number
    delta?: number | null
    /** texto grande no lugar da porcentagem (ex.: valor em reais) */
    display?: string
    /** só o arco, sem número nem legenda (o cartão escreve ao lado) */
    bare?: boolean
  }>(),
  { size: 128, warnAt: 75, dangerAt: 90, tone: 'auto' },
)

const COLOR = {
  primary: 'var(--oo-primary)',
  orange: 'var(--oo-orange)',
  blue: 'var(--oo-blue)',
  red: 'var(--oo-red)',
}
const tone = computed(() => {
  if (props.tone !== 'auto') return props.tone
  return props.value >= props.dangerAt ? 'red' : props.value >= props.warnAt ? 'orange' : 'primary'
})
const color = computed(() => COLOR[tone.value])

/** semicírculo: 180 graus de arco, aberto para baixo */
const R = 52
const CIRC = Math.PI * R
const dash = computed(() => (Math.min(Math.max(props.value, 0), 100) / 100) * CIRC)
const id = `g${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="gauge" :style="{ width: size + 'px' }">
    <svg :viewBox="`0 0 128 76`" :width="size" :height="size * 0.6" role="img" :aria-label="`${label}: ${display ?? Math.round(value) + '%'}`">
      <defs>
        <linearGradient :id="id" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" :stop-color="color" stop-opacity="0.55" />
          <stop offset="100%" :stop-color="color" />
        </linearGradient>
      </defs>
      <path d="M 12 66 A 52 52 0 0 1 116 66" fill="none" stroke="var(--oo-track)" stroke-width="13" stroke-linecap="round" />
      <path
        d="M 12 66 A 52 52 0 0 1 116 66"
        fill="none"
        :stroke="`url(#${id})`"
        stroke-width="13"
        stroke-linecap="round"
        :stroke-dasharray="`${dash} ${CIRC}`"
      />
    </svg>
    <div v-if="!bare" class="g-center">
      <div class="g-value" :style="{ color }">{{ display ?? `${Math.round(value)}%` }}</div>
    </div>
    <div v-if="!bare" class="g-foot">
      <div class="g-label">{{ label }}</div>
      <div v-if="hint" class="g-hint">{{ hint }}</div>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  text-align: center;
}
.g-center {
  margin-top: -26px;
}
.g-value {
  font-size: 1.5rem;
  font-weight: 500;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.g-foot {
  margin-top: 8px;
}
.g-label {
  font-size: var(--oo-fs-micro);
  font-weight: 600;
  color: var(--oo-text);
  line-height: 1.25;
}
.g-hint {
  font-size: 0.75rem;
  color: var(--oo-muted);
  margin-top: 1px;
}
</style>
