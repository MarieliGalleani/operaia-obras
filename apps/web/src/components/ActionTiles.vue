<script setup lang="ts">
/**
 * Ações principais como blocos grandes: ícone, nome e uma linha dizendo o que faz.
 * Para quem usa pouco tecnologia, saber o que o botão faz antes de apertar é o que importa.
 */
defineProps<{
  actions: { key: string; label: string; hint: string; icon: string; tone?: 'primary' | 'attention' | 'late'; badge?: number }[]
  columns?: number
}>()
const emit = defineEmits<{ (e: 'run', key: string): void }>()
</script>

<template>
  <div class="tiles" :style="columns ? { '--cols': String(columns) } : undefined">
    <button v-for="a in actions" :key="a.key" type="button" class="tile" :class="`tone-${a.tone ?? 'primary'}`" @click="emit('run', a.key)">
      <span class="tile-icon">
        <v-icon size="22">{{ a.icon }}</v-icon>
        <span v-if="a.badge" class="tile-badge">{{ a.badge }}</span>
      </span>
      <span class="tile-label">{{ a.label }}</span>
      <span class="tile-hint">{{ a.hint }}</span>
    </button>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 14px 15px 15px;
  border: 0;
  border-radius: var(--oo-r-inner);
  background: var(--oo-surface);
  box-shadow: var(--oo-shadow);
  cursor: pointer;
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}
.tile:hover {
  box-shadow: var(--oo-shadow-lift);
  transform: translateY(-2px);
}
.tile:active {
  transform: scale(0.985);
}
.tile-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  margin-bottom: 8px;
}
.tone-primary .tile-icon {
  background: var(--oo-primary-soft);
  color: var(--oo-primary);
}
.tone-attention .tile-icon {
  background: var(--oo-orange-soft);
  color: var(--oo-orange);
}
.tone-late .tile-icon {
  background: var(--oo-red-soft);
  color: var(--oo-red);
}
.tile-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--oo-late);
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.tile-label {
  font-weight: 700;
  font-size: var(--oo-fs-body);
  line-height: 1.2;
}
.tile-hint {
  color: var(--oo-muted);
  font-size: var(--oo-fs-micro);
  line-height: 1.3;
}
</style>
