<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string; hintColor?: string; icon?: string; valueColor?: string; progress?: number }>()
</script>

<template>
  <v-card class="pa-4 h-100">
    <div class="kpi-label d-flex align-center">
      <v-icon v-if="icon" size="16" class="mr-1" :color="valueColor">{{ icon }}</v-icon>{{ label }}
    </div>
    <div class="kpi-value mt-1" :class="valueColor ? `text-${valueColor}` : ''">{{ value }}</div>
    <div v-if="progress !== undefined" class="d-flex align-center mt-2">
      <v-progress-linear :model-value="progress" color="primary" bg-color="#E9EDEB" bg-opacity="1" height="7" rounded class="mr-3" />
      <span class="text-caption muted">{{ Math.round(progress) }}%</span>
    </div>
    <div v-if="hint" class="text-caption mt-1" :class="hintColor ? `text-${hintColor}` : 'muted'">{{ hint }}</div>
  </v-card>
</template>
