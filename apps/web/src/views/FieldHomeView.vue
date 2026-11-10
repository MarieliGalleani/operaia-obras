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
    // com sinal: guarda já os dados de cada obra, para o celular estar em dia se o sinal cair no canteiro
    if (!r.offline) for (const p of r.data) cachedGet(`/api/field/projects/${p.id}`).catch(() => {})
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
      <div class="page-subtitle">Toque na obra para pedir material, receber entrega, tirar foto, registrar ocorrência ou atualizar o avanço.</div>
    </div>

    <v-alert v-if="offlineAt" type="warning" variant="tonal" icon="mdi-wifi-off" class="mb-4">
      <div class="font-weight-bold">Sem internet agora</div>
      Você está vendo os dados de {{ date(new Date(offlineAt).toISOString()) }}, {{ new Date(offlineAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}.
      Pode continuar usando: o que você registrar fica guardado no celular e sobe sozinho quando o sinal voltar.
    </v-alert>
    <div v-if="loading" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" size="40" /></div>
    <v-card v-else-if="!rows.length" class="pa-8 text-center">
      <v-icon size="40" color="grey">mdi-home-city-outline</v-icon>
      <div class="mt-3 font-weight-bold" style="font-size: var(--oo-fs-lead)">Nenhuma obra em andamento</div>
      <div class="muted mt-1">Quando o escritório liberar uma obra para você, ela aparece aqui.</div>
    </v-card>

    <v-card v-for="p in rows" :key="p.id" class="obra-card mb-4" @click="router.push(`/campo/${p.id}`)">
      <div class="d-flex align-center ga-4">
        <ProjectThumb :name="p.name" :image-url="p.imageUrl" :size="56" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="font-weight-bold text-truncate" style="font-size: 1.1rem; line-height: 1.2">{{ p.name }}</div>
          <div class="muted text-truncate" style="font-size: var(--oo-fs-micro)">{{ p.code }}<template v-if="p.address"> · {{ p.address }}</template></div>
        </div>
      </div>

      <div class="avanco">
        <div class="flex-grow-1">
          <div class="d-flex justify-space-between align-baseline mb-2">
            <span class="font-weight-medium">Avanço da obra</span>
            <span class="font-weight-bold money" style="font-size: 1.05rem">{{ fmt(p.physicalPct) }}</span>
          </div>
          <v-progress-linear :model-value="p.physicalPct ?? 0" color="primary" bg-color="#E9EDEB" bg-opacity="1" height="10" rounded />
          <div v-if="p.physicalPct == null" class="muted mt-2" style="font-size: var(--oo-fs-micro)">O escritório ainda não cadastrou as etapas desta obra.</div>
        </div>
      </div>

      <div class="pend">
        <div v-if="p.lateDeliveries" class="state state-late"><v-icon size="18">mdi-truck-alert</v-icon>{{ p.lateDeliveries }} entrega(s) atrasada(s)</div>
        <div v-else-if="p.deliveriesToday" class="state state-attention"><v-icon size="18">mdi-truck</v-icon>{{ p.deliveriesToday }} entrega(s) chegam hoje</div>
        <div v-else-if="p.expectedDeliveries" class="state state-ok"><v-icon size="18">mdi-truck-outline</v-icon>{{ p.expectedDeliveries }} entrega(s) a caminho</div>
        <div v-if="p.highOccurrences" class="state state-late"><v-icon size="18">mdi-alert-octagon</v-icon>{{ p.highOccurrences }} ocorrência(s) grave(s)</div>
        <div v-else-if="p.openOccurrences" class="state state-attention"><v-icon size="18">mdi-alert</v-icon>{{ p.openOccurrences }} ocorrência(s) aberta(s)</div>
        <div v-if="p.openRequests" class="state state-attention"><v-icon size="18">mdi-cart-outline</v-icon>{{ p.openRequests }} pedido(s) esperando o escritório</div>
        <div v-if="queued(p.id)" class="state state-attention"><v-icon size="18">mdi-cloud-upload-outline</v-icon>{{ queued(p.id) }} registro(s) guardado(s) no celular</div>
        <div v-if="!p.expectedDeliveries && !p.openOccurrences && !p.openRequests && !queued(p.id)" class="state state-ok">
          <v-icon size="18">mdi-check-circle</v-icon>Nada pendente nesta obra
        </div>
      </div>

      <v-btn color="primary" variant="flat" size="large" block prepend-icon="mdi-arrow-right-circle" class="mt-4">Abrir esta obra</v-btn>
    </v-card>
  </div>
</template>

<style scoped>
.field-wrap {
  max-width: 720px;
}
.obra-card {
  padding: 15px;
  cursor: pointer;
}
.avanco {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--oo-border);
}
.pend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.pend .state {
  font-size: var(--oo-fs-micro);
  padding: 5px 10px;
}
</style>
