<script setup lang="ts">
/**
 * Vários números do mesmo assunto em um bloco só, em vez de um cartão por número.
 * Ocupa menos espaço e deixa a comparação na mesma linha de leitura.
 */
defineProps<{
  title: string
  items: { label: string; value: string; tone?: 'ok' | 'attention' | 'late' }[]
}>()
</script>

<template>
  <div class="grp">
    <div class="grp-title">{{ title }}</div>
    <div class="grp-items">
      <div v-for="i in items" :key="i.label" class="grp-item">
        <div class="grp-value money" :class="i.tone ? `tone-${i.tone}` : ''">{{ i.value }}</div>
        <div class="grp-label">{{ i.label }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grp {
  min-width: 0;
  background: var(--oo-surface);
  border-radius: var(--oo-r-card);
  box-shadow: var(--oo-shadow);
  padding: 16px 20px 18px;
}
.grp-title {
  font-size: var(--oo-fs-micro);
  font-weight: 700;
  color: var(--oo-muted);
  margin-bottom: 9px;
}
.grp-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 12px 14px;
}
.grp-item {
  min-width: 0;
}
.grp-value {
  font-size: clamp(1.05rem, 1.4vw, 1.25rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.tone-ok {
  color: var(--oo-primary);
}
.tone-attention {
  color: var(--oo-attention);
}
.tone-late {
  color: var(--oo-late);
}
.grp-label {
  font-size: var(--oo-fs-micro);
  color: var(--oo-muted);
  margin-top: 2px;
}
</style>
