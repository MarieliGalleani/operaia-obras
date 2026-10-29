<script setup lang="ts">
import { computed } from 'vue'
import { PAYABLE_STATUS } from '@/lib/format'

const props = defineProps<{ status: string; dueDate: string }>()
const overdue = computed(() => ['ABERTO', 'PARCIAL'].includes(props.status) && new Date(props.dueDate) < new Date(new Date().toDateString()))
</script>

<template>
  <v-chip v-if="overdue" color="error" variant="tonal">Vencido</v-chip>
  <v-chip v-else :color="PAYABLE_STATUS[status]?.color" variant="tonal">{{ PAYABLE_STATUS[status]?.label ?? status }}</v-chip>
</template>
