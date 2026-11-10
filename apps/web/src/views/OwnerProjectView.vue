<script setup lang="ts">
/**
 * Portal do proprietário: espelho da obra. Prévia da medição, notas (com o arquivo), fotos do
 * andamento e etapas. Só leitura.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import KpiCard from '@/components/KpiCard.vue'
import MeasurementPreview from '@/components/MeasurementPreview.vue'
import StageTimeline from '@/components/StageTimeline.vue'
import { api } from '@/lib/api'
import { DEMO } from '@/lib/demo'
import { brl, categoryLabel, date } from '@/lib/format'
import { contractLabel, docLabel, monthName, shiftMonth, type Contract, type Measurement } from '@/lib/measurement'
import { toastError } from '@/lib/toast'

interface Detail {
  project: Measurement['project']
  contract: Contract
  costToDate: number
  physicalPct: number | null
  stages: Array<{ name: string; progress: number; updatedAt: string | null }>
  measurement: Measurement
  documents: Array<{ id: string; type: string; number: string | null; issueDate: string; approvedAt: string | null; supplier: string | null; amount: number; categories: string[]; hasFile: boolean; isNew: boolean }>
  photos: Array<{ id: string; url: string; caption: string | null; createdAt: string }>
  news: { since: string | null; documents: number; firstVisit: boolean }
}

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)
const data = ref<Detail | null>(null)
const measurement = ref<Measurement | null>(null)
const tab = ref((route.query.aba as string) || 'medicao')
const loadingM = ref(false)
const photo = ref<string | null>(null)

async function load() {
  try {
    data.value = await api.get<Detail>(`/api/owner/projects/${id.value}`)
    measurement.value = data.value.measurement
    // marca as novidades como vistas (o destaque continua nesta visita)
    if (!DEMO) api.post('/api/owner/seen').catch(() => {})
  } catch (e) {
    toastError(e)
  }
}
async function goMonth(delta: number) {
  if (!measurement.value) return
  loadingM.value = true
  try {
    measurement.value = await api.get<Measurement>(`/api/owner/projects/${id.value}/measurement?month=${shiftMonth(measurement.value.period.month, delta)}`)
  } catch (e) {
    toastError(e)
  } finally {
    loadingM.value = false
  }
}
async function openFile(docId: string) {
  try {
    await api.openFile(`/api/owner/documents/${docId}/file`)
  } catch (e) {
    toastError(e)
  }
}
function print() {
  router.push({ name: 'measurement-print', params: { id: id.value }, query: { month: measurement.value?.period.month } })
}
watch(tab, (t) => router.replace({ query: { ...route.query, aba: t } }))
onMounted(load)
</script>

<template>
  <template v-if="data">
    <div class="owner-head mb-5" :style="data.project.imageUrl ? { backgroundImage: `linear-gradient(90deg, rgba(10,40,32,.88), rgba(10,40,32,.35)), url(${data.project.imageUrl})` } : {}">
      <div class="text-caption head-muted">{{ data.project.code }} · {{ contractLabel(data.contract) }}</div>
      <div class="text-h5 font-weight-bold">{{ data.project.name }}</div>
      <div v-if="data.project.address" class="text-body-2 head-muted">{{ data.project.address }}</div>
    </div>

    <v-alert v-if="data.news.documents" type="info" variant="tonal" density="compact" class="mb-4" icon="mdi-bell-ring-outline">
      {{ data.news.documents }} nota(s) nova(s) desde a sua última visita. Elas aparecem marcadas na aba Notas.
    </v-alert>

    <v-row dense class="mb-3">
      <v-col cols="12" sm="4">
        <KpiCard
          :label="`Medição de ${monthName(data.measurement.period.month).split(' ')[0].toLowerCase()}`"
          :value="brl(data.measurement.totals.expected)"
          value-color="primary"
          :hint="`${brl(data.measurement.totals.realizedWithFee)} já lançado`"
        />
      </v-col>
      <v-col cols="6" sm="4"><KpiCard label="Custo da obra até hoje" :value="brl(data.costToDate)" hint="notas aprovadas" /></v-col>
      <v-col cols="6" sm="4">
        <KpiCard
          label="Andamento físico"
          :value="data.physicalPct === null ? '—' : `${Math.round(data.physicalPct)}%`"
          :progress="data.physicalPct ?? undefined"
          :hint="data.physicalPct === null ? 'etapas ainda não cadastradas' : undefined"
        />
      </v-col>
    </v-row>

    <v-card>
      <v-tabs v-model="tab" color="primary" class="px-4">
        <v-tab value="medicao" class="text-none">Medição</v-tab>
        <v-tab value="notas" class="text-none">
          Notas<v-badge v-if="data.news.documents" :content="data.news.documents" color="info" inline />
        </v-tab>
        <v-tab value="fotos" class="text-none">Fotos ({{ data.photos.length }})</v-tab>
        <v-tab value="etapas" class="text-none">Etapas</v-tab>
      </v-tabs>
      <v-divider />
      <v-window v-model="tab">
        <v-window-item value="medicao" class="pa-4">
          <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-3">
            <div class="d-flex align-center">
              <v-btn icon="mdi-chevron-left" variant="text" size="small" aria-label="Medição anterior" @click="goMonth(-1)" />
              <v-btn icon="mdi-chevron-right" variant="text" size="small" aria-label="Próxima medição" @click="goMonth(1)" />
              <v-progress-circular v-if="loadingM" indeterminate size="16" width="2" class="ml-2" />
            </div>
            <v-btn variant="outlined" size="small" prepend-icon="mdi-printer-outline" @click="print">Imprimir ou salvar PDF</v-btn>
          </div>
          <MeasurementPreview v-if="measurement" :m="measurement" can-open-files @open-file="openFile" />
        </v-window-item>

        <v-window-item value="notas">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Aprovada</th>
                <th>Nota</th>
                <th>Fornecedor</th>
                <th>Categoria</th>
                <th class="text-right">Valor na obra</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in data.documents" :key="d.id" :class="{ 'is-new': d.isNew }">
                <td>
                  {{ date(d.approvedAt) }}
                  <v-chip v-if="d.isNew" size="x-small" color="info" variant="flat" class="ml-1">nova</v-chip>
                </td>
                <td>{{ docLabel(d.type, d.number) }}<div class="text-caption muted">emitida {{ date(d.issueDate) }}</div></td>
                <td>{{ d.supplier ?? '—' }}</td>
                <td>{{ d.categories.map(categoryLabel).join(', ') }}</td>
                <td class="text-right money">{{ brl(d.amount) }}</td>
                <td class="text-right">
                  <v-btn v-if="d.hasFile" size="small" variant="text" prepend-icon="mdi-file-download-outline" @click="openFile(d.id)">Arquivo</v-btn>
                </td>
              </tr>
              <tr v-if="!data.documents.length">
                <td colspan="6" class="text-center muted py-6">Nenhuma nota aprovada ainda.</td>
              </tr>
            </tbody>
          </v-table>
        </v-window-item>

        <v-window-item value="fotos" class="pa-4">
          <div v-if="data.photos.length" class="photos">
            <button v-for="f in data.photos" :key="f.id" class="photo" type="button" :aria-label="f.caption ?? 'Foto da obra'" @click="photo = f.url">
              <img :src="f.url" :alt="f.caption ?? 'Foto da obra'" loading="lazy" />
              <span>{{ date(f.createdAt) }}<template v-if="f.caption"> · {{ f.caption }}</template></span>
            </button>
          </div>
          <div v-else class="muted text-center py-6">Ainda não há fotos do andamento.</div>
        </v-window-item>

        <v-window-item value="etapas" class="pa-4">
          <StageTimeline labels :stages="data.stages" />
        </v-window-item>
      </v-window>
    </v-card>

    <v-dialog :model-value="!!photo" max-width="1000" @update:model-value="photo = null">
      <v-card v-if="photo"><img :src="photo" alt="Foto da obra" style="width: 100%; display: block" /></v-card>
    </v-dialog>
  </template>
</template>

<style scoped>
.owner-head {
  border-radius: 14px;
  padding: 26px 24px;
  color: #fff;
  background: linear-gradient(90deg, #0e3b30, #155f4b);
  background-size: cover;
  background-position: center;
}
.head-muted {
  opacity: 0.8;
}
.is-new {
  background: rgba(33, 150, 243, 0.05);
}
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.photo {
  border: 0;
  padding: 0;
  background: none;
  text-align: left;
  cursor: zoom-in;
}
.photo img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 10px;
  display: block;
}
.photo span {
  display: block;
  font-size: 0.75rem;
  color: var(--oo-muted);
  margin-top: 4px;
}
.stage {
  margin-bottom: 14px;
  max-width: 640px;
}
</style>
