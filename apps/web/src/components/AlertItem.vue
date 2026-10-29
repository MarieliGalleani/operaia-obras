<script setup lang="ts">
import { SEVERITY } from '@/lib/format'

defineProps<{ alert: { id: string; severity: string; title: string; message: string; documentId?: string | null; projectId?: string | null }; compact?: boolean }>()
defineEmits<{ open: [] }>()
</script>

<template>
  <div class="alert-item" :class="`sev-${alert.severity}`" @click="$emit('open')">
    <v-avatar :color="SEVERITY[alert.severity]?.color" variant="tonal" size="34" rounded="lg">
      <v-icon size="19">{{ SEVERITY[alert.severity]?.icon }}</v-icon>
    </v-avatar>
    <div class="flex-grow-1" style="min-width: 0">
      <div class="font-weight-medium text-body-2">{{ alert.title }}</div>
      <div class="text-caption muted" :class="{ 'text-truncate': compact }">{{ alert.message }}</div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.alert-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--oo-border);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.alert-item:hover {
  background: #f8faf9;
}
</style>
