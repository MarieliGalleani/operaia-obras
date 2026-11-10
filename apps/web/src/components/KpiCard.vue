<script setup lang="ts">
/**
 * Um número por cartão, com uma frase que diz o que ele significa.
 * Pensado para quem lê pouco em tela: valor grande, rótulo em palavras do dia a dia,
 * e situação sempre com ícone + palavra (nunca só a cor).
 */
defineProps<{
  label: string
  value: string
  hint?: string
  hintColor?: string
  icon?: string
  valueColor?: string
  progress?: number
  /** destaque: o número que responde a pergunta principal da tela */
  lead?: boolean
  /** ação escrita, quando o número pede providência */
  actionLabel?: string
  actionTo?: string
  actionIcon?: string
}>()
const STATE: Record<string, { cls: string; icon: string }> = {
  error: { cls: 'state-late', icon: 'mdi-alert-circle' },
  warning: { cls: 'state-attention', icon: 'mdi-alert' },
  success: { cls: 'state-ok', icon: 'mdi-check-circle' },
}
</script>

<template>
  <component :is="lead ? 'div' : 'v-card'" :class="lead ? 'lead-panel h-100' : 'pa-4 h-100'">
    <div class="kpi-label d-flex align-center">
      <v-icon v-if="icon" size="18" class="mr-1" :color="valueColor">{{ icon }}</v-icon>{{ label }}
    </div>
    <div class="mt-1" :class="[lead ? 'lead-value' : 'kpi-value', valueColor && !lead ? `text-${valueColor}` : '']">{{ value }}</div>

    <div v-if="progress !== undefined" class="mt-3">
      <div class="d-flex align-center ga-3">
        <v-progress-linear :model-value="progress" color="primary" bg-color="#E9EDEB" bg-opacity="1" height="14" rounded class="flex-grow-1" />
        <span class="font-weight-bold money">{{ Math.round(progress) }}%</span>
      </div>
    </div>

    <div v-if="hint" class="mt-2">
      <span v-if="hintColor && STATE[hintColor]" class="state" :class="STATE[hintColor].cls">
        <v-icon size="16">{{ STATE[hintColor].icon }}</v-icon>{{ hint }}
      </span>
      <span v-else class="muted" style="font-size: var(--oo-fs-micro)">{{ hint }}</span>
    </div>

    <v-btn v-if="actionLabel && actionTo" :to="actionTo" :prepend-icon="actionIcon" color="primary" variant="flat" class="mt-3" block>
      {{ actionLabel }}
    </v-btn>
  </component>
</template>
