<script setup lang="ts">
defineProps<{ light?: boolean }>()
</script>

<template>
  <div class="logo" :class="{ light }">
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 4a12 12 0 1 0 7.6 21.3l3.2 3.2 2.4-2.4-3.2-3.2A12 12 0 0 0 16 4Zm0 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" fill="#2BC48A" />
    </svg>
    <div>
      <div class="name">Opera<span>IA</span></div>
      <div class="sub">Obras</div>
    </div>
  </div>
</template>

<style scoped>
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--oo-text);
}
.logo.light {
  color: #fff;
}
.name {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
}
.name span {
  color: #2bc48a;
}
.sub {
  font-size: 0.78rem;
  font-weight: 600;
  text-align: right;
  opacity: 0.85;
  margin-top: 2px;
}
</style>
