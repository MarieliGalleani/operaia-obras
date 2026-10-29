<script setup lang="ts">
import { computed } from 'vue'
import { ymd } from '@/lib/format'

const model = defineModel<{ from: string; to: string }>({ required: true })

const options = computed(() => {
  const now = new Date()
  const list = []
  for (let i = 0; i < 6; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
    const label = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    const cap = label.charAt(0).toUpperCase() + label.slice(1)
    list.push({ title: i === 0 ? `${cap} · atual` : cap, value: `${ymd(first)}|${ymd(last)}` })
  }
  const q = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  list.splice(1, 0, { title: 'Últimos 3 meses', value: `${ymd(q)}|${ymd(end)}` })
  return list
})

const value = computed({
  get: () => `${model.value.from}|${model.value.to}`,
  set: (v: string) => {
    const [from, to] = v.split('|')
    model.value = { from, to }
  },
})
</script>

<template>
  <v-select v-model="value" :items="options" prepend-inner-icon="mdi-calendar-blank-outline" style="min-width: 250px; max-width: 280px" bg-color="surface" />
</template>
