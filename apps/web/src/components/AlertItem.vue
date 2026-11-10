<script setup lang="ts">
/**
 * Um achado do sistema vira tarefa: diz o assunto, o quanto pesa e o que fazer agora.
 * Sem o botão, o alerta só informa; com ele, a pessoa resolve sem procurar a tela certa.
 */
import { computed } from 'vue'
import { IMPACT, SEVERITY, alertTopic } from '@/lib/format'

const props = defineProps<{
  alert: { id: string; type?: string | null; severity: string; title: string; message: string; documentId?: string | null; projectId?: string | null }
  compact?: boolean
}>()
defineEmits<{ open: [] }>()

const impact = computed(() => IMPACT[props.alert.severity] ?? IMPACT.INFO)
const action = computed(() =>
  props.alert.documentId ? { label: 'Abrir a nota', icon: 'mdi-file-document-outline' } : props.alert.projectId ? { label: 'Abrir a obra', icon: 'mdi-home-city-outline' } : { label: 'Ver detalhe', icon: 'mdi-arrow-right' },
)
</script>

<template>
  <div class="alert-item" :class="`sev-${alert.severity}`">
    <v-avatar :color="SEVERITY[alert.severity]?.color" variant="tonal" size="30" rounded="lg">
      <v-icon size="17">{{ SEVERITY[alert.severity]?.icon }}</v-icon>
    </v-avatar>
    <div class="flex-grow-1" style="min-width: 0">
      <div class="tags">
        <span class="tag">{{ alertTopic(alert.type) }}</span>
        <span class="state" :class="impact.cls">{{ impact.label }}</span>
      </div>
      <div class="font-weight-bold a-title">{{ alert.title }}</div>
      <div class="muted a-msg" :class="{ 'text-truncate': compact }">{{ alert.message }}</div>
    </div>
    <div class="a-side">
      <slot />
      <v-btn size="small" variant="outlined" :prepend-icon="action.icon" @click.stop="$emit('open')">{{ action.label }}</v-btn>
    </div>
  </div>
</template>

<style scoped>
.alert-item {
  min-width: 0;
  display: flex;
  gap: 11px;
  align-items: flex-start;
  padding: 12px 13px;
  border: 0;
  border-radius: var(--oo-r-inner);
  background: rgba(17, 25, 23, 0.035);
  transition: background 0.15s ease;
}
.alert-item:hover {
  background: rgba(17, 25, 23, 0.06);
}
.tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}
.tag {
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--oo-muted);
  background: var(--oo-surface);
  border-radius: 999px;
  padding: 2px 9px;
}
.tags .state {
  font-size: 0.6875rem;
  padding: 2px 8px;
}
.a-title {
  font-size: var(--oo-fs-body);
  line-height: 1.25;
}
.a-msg {
  font-size: var(--oo-fs-micro);
  line-height: 1.35;
}
.a-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
@media (max-width: 700px) {
  .alert-item {
    flex-wrap: wrap;
  }
  .a-side {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
