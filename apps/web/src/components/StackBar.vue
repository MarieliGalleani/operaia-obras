<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ paid: number; open: number; budget: number }>()
const w = computed(() => {
  const total = Math.max(props.budget, props.paid + props.open, 1)
  return { paid: (props.paid / total) * 100, open: (props.open / total) * 100 }
})
</script>

<template>
  <div class="stack-bar" role="img" :aria-label="`Pago ${w.paid.toFixed(0)}%, a pagar ${w.open.toFixed(0)}%`">
    <span :style="{ width: w.paid + '%', background: 'var(--oo-bright)' }" />
    <span :style="{ width: w.open + '%', background: 'var(--oo-accent)' }" />
  </div>
</template>
