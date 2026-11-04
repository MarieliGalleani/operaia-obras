<script setup lang="ts">
/** App de obra: o mestre escolhe a obra. Pensado para celular, com botões grandes. */
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ProjectThumb from '@/components/ProjectThumb.vue'
import { date } from '@/lib/format'
import { cachedGet, queue } from '@/lib/offline'
import { toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface FieldProjectRow {
  id: string
  code: string
  name: string
  address: string | null
  imageUrl: string | null
  physicalPct: number | null
  expectedDeliveries: number
  lateDeliveries: number
  deliveriesToday: number
  openOccurrences: number
  highOccurrences: number
  openRequests: number
}

const router = useRouter()
const auth = useAuth()
const rows = ref<FieldProjectRow[]>([])
const loading = ref(true)
const offlineAt = ref<number | null>(null)
async function load() {
  try {
    const r = await cachedGet<FieldProjectRow[]>('/api/field/projects')
    rows.value = r.data
    offlineAt.value = r.offline ? r.at : null
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => queue.lastSyncAt, load)
const queued = (projectId: string) => queue.items.filter((i) => i.projectId === projectId).length
const firstName = () => auth.me?.user.name.split(' ')[0] ?? ''
const fmt = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)
</script>

<template>
  <div class="field-wrap">
    <div class="mb-5">
      <div class="page-title">Olá, {{ firstName() }}</div>
      <div class="page-subtitle">Escolha a obra para pedir material, receber entrega, tirar foto, registrar ocorrência ou atualizar o avanço.</div>
    </div>

    <v-alert v-if="offlineAt" type="warning" variant="tonal" density="compact" icon="mdi-wifi-off" class="mb-3">
      Sem internet. Mostrando os dados de {{ date(new Date(offlineAt).toISOString()) }} {{ new Date(offlineAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}. O que você registrar fica guardado no celular.
    </v-alert>
    <div v-if="loading" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
    <v-card v-else-if="!rows.length" class="pa-8 text-center muted">Nenhuma obra em andamento.</v-card>

    <v-card v-for="p in rows" :key="p.id" class="obra-card mb-3" @click="router.push(`/campo/${p.id}`)">
      <div class="d-flex align-center ga-3">
        <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="56" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-subtitle-1 font-weight-bold text-truncate">{{ p.name }}</div>
          <div class="text-caption muted text-truncate">{{ p.code }}<template v-if="p.address"> · {{ p.address }}</template></div>
        </div>
        <v-progress-circular :model-value="p.physicalPct ?? 0" :size="56" :width="6" color="primary" bg-color="grey-lighten-3">
          <span class="text-caption font-weight-bold">{{ fmt(p.physicalPct) }}</span>
        </v-progress-circular>
      </div>
      <div class="d-flex flex-wrap ga-2 mt-3">
        <v-chip v-if="p.lateDeliveries" size="small" color="error" variant="flat" prepend-icon="mdi-truck-alert-outline">{{ p.lateDeliveries }} entrega(s) atrasada(s)</v-chip>
        <v-chip v-else-if="p.deliveriesToday" size="small" color="info" variant="flat" prepend-icon="mdi-truck-outline">{{ p.deliveriesToday }} entrega(s) hoje</v-chip>
        <v-chip v-else-if="p.expectedDeliveries" size="small" variant="tonal" prepend-icon="mdi-truck-outline">{{ p.expectedDeliveries }} entrega(s) a caminho</v-chip>
        <v-chip v-if="p.highOccurrences" size="small" color="error" variant="tonal" prepend-icon="mdi-alert-octagon-outline">{{ p.highOccurrences }} ocorrência(s) grave(s)</v-chip>
        <v-chip v-else-if="p.openOccurrences" size="small" color="warning" variant="tonal" prepend-icon="mdi-alert-outline">{{ p.openOccurrences }} ocorrência(s) aberta(s)</v-chip>
        <v-chip v-if="queued(p.id)" size="small" color="info" variant="flat" prepend-icon="mdi-cloud-upload-outline">{{ queued(p.id) }} guardado(s) no celular</v-chip>
        <v-chip v-if="p.openRequests" size="small" variant="tonal" prepend-icon="mdi-cart-outline">{{ p.openRequests }} pedido(s) de material aguardando</v-chip>
        <span v-if="!p.expectedDeliveries && !p.openOccurrences && !p.openRequests" class="text-caption muted">Nada pendente</span>
      </div>
      <div class="text-caption muted mt-2">Avanço físico{{ p.physicalPct == null ? ': etapas ainda não cadastradas pelo escritório' : '' }}</div>
    </v-card>
  </div>
</template>

<style scoped>
.field-wrap {
  max-width: 720px;
}
.obra-card {
  padding: 16px;
  cursor: pointer;
}
</style>
