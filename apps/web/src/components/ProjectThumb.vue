<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; imageUrl?: string | null; size?: number }>(), { size: 56 })
// paleta estável por nome, para cada obra ter "cara" própria sem precisar de foto
const palettes = [
  ['#0E6B53', '#2BC48A'],
  ['#2D5B9A', '#6FA0E0'],
  ['#B7791F', '#F2A93B'],
  ['#5B4B8A', '#9C88D6'],
  ['#8A4B4B', '#D68888'],
]
const colors = computed(() => palettes[[...props.name].reduce((a, c) => a + c.charCodeAt(0), 0) % palettes.length])
const initials = computed(() =>
  props.name
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <div class="thumb" :style="{ width: size + 'px', height: size * 0.75 + 'px', background: imageUrl ? `center/cover url(${imageUrl})` : `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }">
    <template v-if="!imageUrl">
      <svg viewBox="0 0 40 30" class="skyline" aria-hidden="true">
        <path d="M2 30V14h6V8h7v22M15 30V4h9v26M24 30V12h6v4h8v14" fill="rgba(255,255,255,.22)" />
      </svg>
      <span>{{ initials }}</span>
    </template>
  </div>
</template>

<style scoped>
.thumb {
  position: relative;
  border-radius: 8px;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.skyline {
  position: absolute;
  inset: auto 0 0 0;
  width: 100%;
}
span {
  position: relative;
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}
</style>
