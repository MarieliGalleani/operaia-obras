<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AlertItem from '@/components/AlertItem.vue'
import DocumentReview from '@/components/DocumentReview.vue'
import KpiCard from '@/components/KpiCard.vue'
import ProjectThumb from '@/components/ProjectThumb.vue'
import StackBar from '@/components/StackBar.vue'
import { api } from '@/lib/api'
import { CATEGORIES, DOC_STATUS, PAYABLE_STATUS, brl, categoryColor, date, pct } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface Detail {
  id: string
  code: string
  name: string
  address: string | null
  status: string
  budgetTotal: number
  imageUrl: string | null
  financials: { budget: number; appropriated: number; paid: number; open: number; committedPct: number; byCategory: Record<string, { budget: number; appropriated: number }> }
  documents: { id: string; number: string | null; status: string; supplierName: string | null; issueDate: string | null; totalAmount: number | null; description: string | null }[]
  payables: { id: string; dueDate: string; amount: number; paidAmount: number; status: string; supplierName: string | null; installment: string; documentNumber: string | null }[]
  alerts: { id: string; severity: string; title: string; message: string; documentId: string | null; projectId: string | null }[]
}

interface Field {
  physicalPct: number | null
  stages: { id: string; name: string; weight: number; progress: number; updatedAt: string | null; updatedByName: string | null }[]
  occurrences: { id: string; typeLabel: string; severity: string; status: string; title: string; description: string | null; createdAt: string; createdByName: string | null; resolution: string | null; photos: string[] }[]
  photos: { id: string; url: string; caption: string | null; createdAt: string; userName: string | null }[]
  stageUpdates: { id: string; stageName: string; fromProgress: number; progress: number; note: string | null; userName: string | null; createdAt: string }[]
  receipts: { id: string; code: string; supplierName: string; problem: boolean; notes: string | null; receivedAt: string; receivedByName: string | null }[]
}

const route = useRoute()
const router = useRouter()
const data = ref<Detail | null>(null)
const field = ref<Field | null>(null)
const tab = ref('custos')
const openDoc = ref<string | null>(null)

async function load() {
  try {
    ;[data.value, field.value] = await Promise.all([api.get<Detail>(`/api/projects/${route.params.id}`), api.get<Field>(`/api/field/projects/${route.params.id}`).catch(() => null)])
  } catch (e) {
    toastError(e)
    router.replace({ name: 'projects' })
  }
}
onMounted(load)
watch(() => route.params.id, load)

const categories = computed(() => {
  const by = data.value?.financials.byCategory ?? {}
  return CATEGORIES.map((c) => ({ ...c, budget: by[c.value]?.budget ?? 0, appropriated: by[c.value]?.appropriated ?? 0 })).filter((c) => c.budget || c.appropriated)
})
const auth = useAuth()
const canEdit = computed(() => ['ADMIN', 'GESTOR_OBRA'].includes(auth.me?.user.role ?? ''))
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
async function onPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || !data.value) return
  if (file.size > 5 * 1024 * 1024) return toast('A foto pode ter no máximo 5 MB.', 'warning')
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await api.post<{ imageUrl: string }>(`/api/projects/${data.value.id}/image`, form)
    data.value.imageUrl = res.imageUrl
    toast('Foto da obra atualizada')
  } catch (err) {
    toastError(err)
  } finally {
    uploading.value = false
  }
}
async function removePhoto() {
  if (!data.value) return
  try {
    await api.request('DELETE', `/api/projects/${data.value.id}/image`)
    data.value.imageUrl = null
    toast('Foto removida')
  } catch (err) {
    toastError(err)
  }
}
// ------------------------------------------------------------ andamento físico
const financialPct = computed(() => (data.value && data.value.budgetTotal ? (data.value.financials.appropriated / data.value.budgetTotal) * 100 : null))
const gap = computed(() => (field.value?.physicalPct != null && financialPct.value != null ? financialPct.value - field.value.physicalPct : null))
const stagesOpen = ref(false)
const stageRows = ref<{ id?: string; name: string; weight: number }[]>([])
const savingStages = ref(false)
async function openStages() {
  stageRows.value = field.value?.stages.length
    ? field.value.stages.map((s) => ({ id: s.id, name: s.name, weight: s.weight }))
    : await api.get<{ name: string; weight: number }[]>('/api/stage-templates')
  stagesOpen.value = true
}
const weightSum = computed(() => stageRows.value.reduce((a, s) => a + (Number(s.weight) || 0), 0))
async function saveStages() {
  if (!data.value) return
  savingStages.value = true
  try {
    await api.request('PUT', `/api/projects/${data.value.id}/stages`, { stages: stageRows.value.map((s) => ({ id: s.id ?? null, name: s.name, weight: Number(s.weight) || 1 })) })
    stagesOpen.value = false
    toast('Etapas salvas. O mestre já pode atualizar o avanço no app de obra.')
    load()
  } catch (e) {
    toastError(e)
  } finally {
    savingStages.value = false
  }
}
const SEV_COLOR: Record<string, string> = { BAIXA: 'grey', MEDIA: 'warning', ALTA: 'error' }
const viewer = ref<string | null>(null)
const balance = computed(() => (data.value ? data.value.budgetTotal - data.value.financials.paid - data.value.financials.open : 0))
</script>

<template>
  <div v-if="!data" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
  <template v-else>
    <div class="d-flex align-center ga-4 mb-6 flex-wrap">
      <v-btn icon="mdi-arrow-left" variant="text" to="/obras" />
      <div class="photo-wrap">
        <ProjectThumb :name="data.name" :image-url="data.imageUrl" :size="120" />
        <v-menu v-if="canEdit">
          <template #activator="{ props }">
            <v-btn v-bind="props" class="photo-btn" size="x-small" icon="mdi-camera-outline" color="surface" :loading="uploading" aria-label="Foto da obra" />
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-image-plus-outline" :title="data.imageUrl ? 'Trocar foto' : 'Adicionar foto'" @click="fileInput?.click()" />
            <v-list-item v-if="data.imageUrl" prepend-icon="mdi-delete-outline" title="Remover foto" @click="removePhoto" />
          </v-list>
        </v-menu>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onPhoto" />
      </div>
      <div>
        <div class="text-caption muted">{{ data.code }} · {{ data.status === 'ATIVA' ? 'Em andamento' : data.status }}</div>
        <div class="page-title">{{ data.name }}</div>
        <div class="page-subtitle">{{ data.address }}</div>
      </div>
    </div>

    <v-row dense class="mb-2">
      <v-col cols="6" md="3"><KpiCard label="Orçamento" :value="brl(data.budgetTotal, { compact: true })" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="Pago" :value="brl(data.financials.paid, { compact: true })" /></v-col>
      <v-col cols="6" md="3"><KpiCard label="A pagar" :value="brl(data.financials.open, { compact: true })" /></v-col>
      <v-col cols="6" md="3">
        <KpiCard label="Saldo do orçamento" :value="brl(balance, { compact: true })" :value-color="balance < 0 ? 'error' : undefined" :hint="`${pct(data.financials.committedPct)} comprometido`" :hint-color="data.financials.committedPct >= 90 ? 'error' : undefined" />
      </v-col>
    </v-row>

    <v-card class="pa-5 mb-4">
      <StackBar :paid="data.financials.paid" :open="data.financials.open" :budget="data.budgetTotal" style="height: 12px" />
      <div class="text-caption muted mt-2">
        <span class="mr-4"><span class="legend-dot" style="background: var(--oo-bright)" />Pago</span>
        <span class="mr-4"><span class="legend-dot" style="background: var(--oo-accent)" />A pagar</span>
        <span><span class="legend-dot" style="background: var(--oo-track)" />Saldo</span>
      </div>
    </v-card>

    <v-card class="pa-5 mb-4">
      <div class="d-flex align-center flex-wrap ga-2 mb-3">
        <div class="card-title">Andamento da obra</div>
        <v-spacer />
        <v-btn size="small" variant="text" prepend-icon="mdi-hard-hat" :to="`/campo/${data.id}`">Abrir no app de obra</v-btn>
        <v-btn v-if="canEdit" size="small" variant="tonal" prepend-icon="mdi-format-list-checks" @click="openStages">{{ field?.stages.length ? 'Editar etapas' : 'Cadastrar etapas' }}</v-btn>
      </div>
      <div v-if="!field?.stages.length" class="text-body-2 muted">
        Cadastre as etapas da obra para o mestre informar o avanço físico pelo celular e comparar com o gasto.
      </div>
      <template v-else>
        <div class="progress-compare mb-4">
          <div>
            <div class="text-caption muted">Avanço físico</div>
            <div class="text-h5 font-weight-bold text-primary">{{ pct(field.physicalPct) }}</div>
            <v-progress-linear :model-value="field.physicalPct ?? 0" color="primary" bg-color="grey-lighten-2" height="10" rounded />
          </div>
          <div>
            <div class="text-caption muted">Gasto do orçamento</div>
            <div class="text-h5 font-weight-bold" :class="gap != null && gap > 10 ? 'text-error' : ''">{{ pct(financialPct) }}</div>
            <v-progress-linear :model-value="financialPct ?? 0" :color="gap != null && gap > 10 ? 'error' : 'secondary'" bg-color="grey-lighten-2" height="10" rounded />
          </div>
        </div>
        <v-alert v-if="gap != null && gap > 10" type="warning" variant="tonal" density="compact" class="mb-4">
          O gasto está <b>{{ Math.round(gap) }} pontos à frente</b> do avanço físico. Vale conferir se há material comprado e ainda não aplicado, ou se o custo está acima do previsto.
        </v-alert>
        <v-alert v-else-if="gap != null && gap < -10" type="info" variant="tonal" density="compact" class="mb-4">
          O avanço físico está {{ Math.round(-gap) }} pontos à frente do gasto: pode haver notas ainda não lançadas.
        </v-alert>
        <div class="stages">
          <div v-for="s in field.stages" :key="s.id" class="stage-row">
            <span class="text-body-2 text-truncate">{{ s.name }}</span>
            <v-progress-linear :model-value="s.progress" :color="s.progress === 100 ? 'success' : 'primary'" bg-color="grey-lighten-2" height="8" rounded />
            <b class="text-body-2 text-right">{{ s.progress }}%</b>
          </div>
        </div>
      </template>
    </v-card>

    <div v-if="data.alerts.length" class="d-flex flex-column ga-2 mb-4">
      <AlertItem v-for="a in data.alerts" :key="a.id" :alert="a" @open="a.documentId && (openDoc = a.documentId)" />
    </div>

    <v-card>
      <v-tabs v-model="tab" color="primary" class="px-4">
        <v-tab value="custos" class="text-none">Orçado × apropriado</v-tab>
        <v-tab value="notas" class="text-none">Notas ({{ data.documents.length }})</v-tab>
        <v-tab value="titulos" class="text-none">Títulos ({{ data.payables.length }})</v-tab>
        <v-tab value="diario" class="text-none">Diário da obra</v-tab>
      </v-tabs>
      <v-divider />
      <div v-if="tab === 'custos'" class="pa-5">
        <div v-for="c in categories" :key="c.value" class="mb-4">
          <div class="d-flex justify-space-between text-body-2 mb-1">
            <span><span class="legend-dot" :style="{ background: c.color }" />{{ c.title }}</span>
            <span class="money">
              <strong :class="c.budget && c.appropriated > c.budget ? 'text-error' : ''">{{ brl(c.appropriated) }}</strong>
              <span class="muted"> / {{ c.budget ? brl(c.budget) : 'sem orçamento' }}</span>
            </span>
          </div>
          <v-progress-linear
            :model-value="c.budget ? Math.min((c.appropriated / c.budget) * 100, 100) : 0"
            :color="c.budget && c.appropriated > c.budget ? 'error' : categoryColor(c.value)"
            bg-color="#E9EDEB"
            bg-opacity="1"
            height="8"
            rounded
          />
        </div>
        <div v-if="!categories.length" class="muted">Sem orçamento por categoria nem custos apropriados.</div>
      </div>
      <v-table v-else-if="tab === 'notas'" density="comfortable" class="clickable-rows">
        <thead><tr><th>Nota</th><th>Fornecedor</th><th>Emissão</th><th class="text-right">Valor da nota</th><th>Situação</th></tr></thead>
        <tbody>
          <tr v-for="d in data.documents" :key="d.id" @click="openDoc = d.id">
            <td>{{ d.number }}</td>
            <td><div>{{ d.supplierName }}</div><div class="text-caption muted">{{ d.description }}</div></td>
            <td>{{ date(d.issueDate) }}</td>
            <td class="text-right money">{{ brl(d.totalAmount) }}</td>
            <td><v-chip :color="DOC_STATUS[d.status].color" variant="tonal">{{ DOC_STATUS[d.status].label }}</v-chip></td>
          </tr>
        </tbody>
      </v-table>
      <div v-else-if="tab === 'diario'" class="pa-5">
        <v-row>
          <v-col cols="12" md="6">
            <div class="font-weight-bold mb-2">Ocorrências</div>
            <div v-for="o in field?.occurrences ?? []" :key="o.id" class="occ" :class="{ done: o.status === 'RESOLVIDA' }">
              <div class="d-flex align-center ga-2">
                <v-chip size="x-small" :color="SEV_COLOR[o.severity]" variant="flat">{{ o.severity === 'MEDIA' ? 'Média' : o.severity === 'ALTA' ? 'Alta' : 'Baixa' }}</v-chip>
                <b class="text-body-2">{{ o.title }}</b>
                <v-spacer />
                <v-chip v-if="o.status === 'RESOLVIDA'" size="x-small" color="success" variant="tonal">resolvida</v-chip>
              </div>
              <div class="text-caption muted">{{ o.typeLabel }} · {{ date(o.createdAt) }} · {{ o.createdByName }}</div>
              <div v-if="o.description" class="text-body-2">{{ o.description }}</div>
              <div v-if="o.resolution" class="text-caption text-success">✓ {{ o.resolution }}</div>
            </div>
            <div v-if="!field?.occurrences.length" class="text-body-2 muted mb-4">Nenhuma ocorrência nos últimos 45 dias.</div>
            <div class="font-weight-bold mb-2 mt-4">Entregas conferidas na obra</div>
            <div v-for="r in field?.receipts ?? []" :key="r.id" class="text-body-2 mb-1">
              <v-icon size="16" :color="r.problem ? 'warning' : 'success'">{{ r.problem ? 'mdi-truck-alert-outline' : 'mdi-check-circle-outline' }}</v-icon>
              {{ date(r.receivedAt) }} · {{ r.supplierName }} ({{ r.code }}) · {{ r.receivedByName }}<span v-if="r.notes" class="text-warning"> · {{ r.notes }}</span>
            </div>
            <div v-if="!field?.receipts.length" class="text-body-2 muted">Nenhuma entrega conferida nos últimos 45 dias.</div>
          </v-col>
          <v-col cols="12" md="6">
            <div class="font-weight-bold mb-2">Avanço informado</div>
            <div v-for="u in (field?.stageUpdates ?? []).slice(0, 8)" :key="u.id" class="text-body-2 mb-1">
              <span class="muted">{{ date(u.createdAt) }}</span> · <b>{{ u.stageName }}</b> {{ u.fromProgress }}% → {{ u.progress }}% <span class="muted">· {{ u.userName }}</span>
            </div>
            <div v-if="!field?.stageUpdates.length" class="text-body-2 muted mb-4">Nenhuma atualização ainda.</div>
            <div class="font-weight-bold mb-2 mt-4">Fotos</div>
            <div v-if="field?.photos.length" class="gallery">
              <img v-for="f in field.photos.slice(0, 12)" :key="f.id" :src="f.url" :alt="f.caption ?? 'Foto da obra'" :title="`${f.caption ?? ''} · ${date(f.createdAt)} · ${f.userName ?? ''}`" @click="viewer = f.url" />
            </div>
            <div v-else class="text-body-2 muted">Nenhuma foto ainda. O mestre tira pelo app de obra.</div>
          </v-col>
        </v-row>
      </div>
      <v-table v-else density="comfortable">
        <thead><tr><th>Vencimento</th><th>Fornecedor</th><th>NF · parcela</th><th class="text-right">Valor do título</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="p in data.payables" :key="p.id">
            <td>{{ date(p.dueDate) }}</td>
            <td>{{ p.supplierName }}</td>
            <td>{{ p.documentNumber }} · {{ p.installment }}</td>
            <td class="text-right money">{{ brl(p.amount) }}</td>
            <td><v-chip :color="PAYABLE_STATUS[p.status].color" variant="tonal">{{ PAYABLE_STATUS[p.status].label }}</v-chip></td>
          </tr>
        </tbody>
      </v-table>
      <div v-if="tab === 'notas' || tab === 'titulos'" class="text-caption muted pa-4">Valores das notas e títulos são totais; se a nota foi rateada, só parte dela pertence a esta obra.</div>
    </v-card>

    <DocumentReview :document-id="openDoc" @close="openDoc = null" @changed="load" />

    <v-dialog v-model="stagesOpen" max-width="560" scrollable>
      <v-card>
        <div class="pa-5 pb-2">
          <div class="card-title">Etapas da obra</div>
          <div class="text-caption muted">O peso diz quanto cada etapa vale no avanço total (sugestão: a parte do orçamento que ela representa).</div>
        </div>
        <v-card-text class="pt-2">
          <div v-for="(s, k) in stageRows" :key="k" class="d-flex ga-2 align-center">
            <v-text-field v-model="s.name" label="Etapa" density="compact" />
            <v-text-field v-model.number="s.weight" label="Peso" type="number" density="compact" style="max-width: 96px" />
            <v-btn icon="mdi-delete-outline" size="small" variant="text" :disabled="stageRows.length === 1" aria-label="Remover etapa" @click="stageRows.splice(k, 1)" />
          </div>
          <div class="d-flex align-center justify-space-between">
            <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="stageRows.push({ name: '', weight: 5 })">Adicionar etapa</v-btn>
            <span class="text-caption muted">Pesos somam {{ weightSum }}</span>
          </div>
        </v-card-text>
        <div class="pa-4 d-flex justify-end ga-2">
          <v-btn variant="text" @click="stagesOpen = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="savingStages" :disabled="stageRows.some((s) => s.name.trim().length < 2)" @click="saveStages">Salvar etapas</v-btn>
        </div>
      </v-card>
    </v-dialog>
    <v-dialog :model-value="!!viewer" max-width="960" @update:model-value="viewer = null">
      <v-card v-if="viewer" class="pa-2" @click="viewer = null"><img :src="viewer" alt="Foto ampliada" style="width: 100%; border-radius: 8px" /></v-card>
    </v-dialog>
  </template>
</template>

<style scoped>
.progress-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.stages {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 6px 32px;
}
.stage-row {
  display: grid;
  grid-template-columns: 170px 1fr 44px;
  align-items: center;
  gap: 10px;
}
.occ {
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.occ.done {
  opacity: 0.65;
}
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
}
.gallery img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
}
.photo-wrap {
  position: relative;
}
.photo-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
}
</style>
