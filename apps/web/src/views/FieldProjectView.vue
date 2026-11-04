<script setup lang="ts">
/**
 * App de obra: tudo o que o mestre faz numa obra, em uma tela de celular.
 * Pedir material · Receber entrega · Foto · Ocorrência · Avanço físico. Sem valores em dinheiro.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { api } from '@/lib/api'
import { date, ymd } from '@/lib/format'
import { uploadSitePhoto } from '@/lib/image'
import { toast, toastError } from '@/lib/toast'

type Item = { description: string; unit: string | null; quantity: number }
interface FieldData {
  project: { id: string; code: string; name: string; address: string | null; imageUrl: string | null }
  physicalPct: number | null
  stages: { id: string; name: string; weight: number; progress: number; updatedAt: string | null; updatedByName: string | null }[]
  deliveries: {
    id: string
    code: string
    status: string
    supplierName: string
    expectedDate: string | null
    late: boolean
    items: { id: string; description: string; unit: string | null; orderedQty: number; receivedQty: number; remainingQty: number }[]
  }[]
  receipts: { id: string; code: string; supplierName: string; items: Item[]; problem: boolean; notes: string | null; receivedAt: string; receivedByName: string | null; photos: string[] }[]
  requests: {
    id: string
    status: 'ABERTA' | 'EM_COMPRA' | 'RECUSADA'
    items: Item[]
    neededBy: string | null
    urgent: boolean
    notes: string | null
    createdAt: string
    createdByName: string | null
    declineReason: string | null
    orderCode: string | null
    orderStatus: string | null
  }[]
  occurrences: {
    id: string
    type: string
    typeLabel: string
    severity: 'BAIXA' | 'MEDIA' | 'ALTA'
    status: 'ABERTA' | 'RESOLVIDA'
    title: string
    description: string | null
    createdAt: string
    createdByName: string | null
    resolution: string | null
    resolvedByName: string | null
    resolvedAt: string | null
    photos: string[]
  }[]
  photos: { id: string; url: string; caption: string | null; createdAt: string; userName: string | null; kind: string }[]
  stageUpdates: { id: string; stageName: string; fromProgress: number; progress: number; note: string | null; userName: string | null; createdAt: string; photos: string[] }[]
}

const route = useRoute()
const router = useRouter()
const { smAndDown } = useDisplay()
const id = computed(() => String(route.params.id))
const data = ref<FieldData | null>(null)
const tab = ref<string>((route.query.aba as string) || 'entregas')
const busy = ref(false)

async function load() {
  try {
    data.value = await api.get<FieldData>(`/api/field/projects/${id.value}`)
  } catch (e) {
    toastError(e)
    router.replace('/campo')
  }
}
onMounted(load)

const openDeliveries = computed(() => data.value?.deliveries ?? [])
const openOcc = computed(() => data.value?.occurrences.filter((o) => o.status === 'ABERTA') ?? [])
const openReq = computed(() => data.value?.requests.filter((r) => r.status === 'ABERTA') ?? [])
const qty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const SEV: Record<string, { label: string; color: string }> = { BAIXA: { label: 'Baixa', color: 'grey' }, MEDIA: { label: 'Média', color: 'warning' }, ALTA: { label: 'Alta', color: 'error' } }
const REQ: Record<string, { label: string; color: string }> = {
  ABERTA: { label: 'Aguardando o escritório', color: 'warning' },
  EM_COMPRA: { label: 'Comprado', color: 'success' },
  RECUSADA: { label: 'Recusado', color: 'grey' },
}

// ------------------------------------------------------------ foto (câmera)
const fileInput = ref<HTMLInputElement | null>(null)
let onPicked: ((f: File) => void) | null = null
function pickPhoto(cb: (f: File) => void) {
  onPicked = cb
  if (fileInput.value) {
    fileInput.value.value = ''
    fileInput.value.click()
  }
}
function picked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f && onPicked) onPicked(f)
}
const preview = (f: File | null) => (f ? URL.createObjectURL(f) : '')
async function sendPhoto(file: File | null, meta: Parameters<typeof uploadSitePhoto>[3]) {
  if (!file) return
  await uploadSitePhoto(api.post, id.value, file, meta)
}

// ------------------------------------------------------------ pedir material
const reqOpen = ref(false)
const reqForm = ref({ items: [{ description: '', unit: '', quantity: '' }], neededBy: '', urgent: false, notes: '' })
function openRequest() {
  reqForm.value = { items: [{ description: '', unit: '', quantity: '' }], neededBy: ymd(new Date(Date.now() + 3 * 86400000)), urgent: false, notes: '' }
  reqOpen.value = true
}
const num = (s: string | number) => Number(String(s).replace(',', '.')) || 0
const reqValid = computed(() => reqForm.value.items.some((i) => i.description.trim().length >= 2 && num(i.quantity) > 0))
async function sendRequest() {
  busy.value = true
  try {
    await api.post(`/api/field/projects/${id.value}/requests`, {
      items: reqForm.value.items.filter((i) => i.description.trim() && num(i.quantity) > 0).map((i) => ({ description: i.description, unit: i.unit || null, quantity: num(i.quantity) })),
      neededBy: reqForm.value.neededBy || null,
      urgent: reqForm.value.urgent,
      notes: reqForm.value.notes || null,
    })
    reqOpen.value = false
    toast('Pedido de material enviado ao escritório')
    tab.value = 'pedidos'
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}

// ------------------------------------------------------------ receber entrega
const recOpen = ref(false)
const recOrder = ref<FieldData['deliveries'][number] | null>(null)
const recQty = ref<Record<string, string>>({})
const recProblem = ref(false)
const recNotes = ref('')
const recPhoto = ref<File | null>(null)
function openReceive(o?: FieldData['deliveries'][number]) {
  recOrder.value = o ?? (openDeliveries.value.length === 1 ? openDeliveries.value[0] : null)
  recQty.value = Object.fromEntries((recOrder.value?.items ?? []).map((i) => [i.id, String(i.remainingQty)]))
  recProblem.value = false
  recNotes.value = ''
  recPhoto.value = null
  recOpen.value = true
}
function chooseOrder(o: FieldData['deliveries'][number]) {
  recOrder.value = o
  recQty.value = Object.fromEntries(o.items.map((i) => [i.id, String(i.remainingQty)]))
}
async function sendReceive() {
  if (!recOrder.value) return
  busy.value = true
  try {
    const r = await api.post<{ id: string; occurrenceId: string | null }>(`/api/field/orders/${recOrder.value.id}/receive`, {
      items: recOrder.value.items.map((i) => ({ orderItemId: i.id, quantity: num(recQty.value[i.id] ?? 0) })),
      problem: recProblem.value,
      notes: recNotes.value || null,
    })
    await sendPhoto(recPhoto.value, { receiptId: r.id, caption: `Entrega ${recOrder.value.code}` })
    recOpen.value = false
    toast(recProblem.value ? 'Entrega registrada com problema: o escritório foi avisado' : 'Entrega conferida')
    tab.value = 'entregas'
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}

// ------------------------------------------------------------ foto avulsa
const photoOpen = ref(false)
const photoFile = ref<File | null>(null)
const photoCaption = ref('')
function takePhoto() {
  pickPhoto((f) => {
    photoFile.value = f
    photoCaption.value = ''
    photoOpen.value = true
  })
}
async function savePhoto() {
  busy.value = true
  try {
    await sendPhoto(photoFile.value, { caption: photoCaption.value || undefined })
    photoOpen.value = false
    toast('Foto salva no diário da obra')
    tab.value = 'fotos'
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}

// ------------------------------------------------------------ ocorrência
const TYPES = [
  { value: 'FALTA_MATERIAL', title: 'Falta de material', icon: 'mdi-package-variant-remove' },
  { value: 'ATRASO', title: 'Atraso', icon: 'mdi-clock-alert-outline' },
  { value: 'SEGURANCA', title: 'Segurança', icon: 'mdi-hard-hat' },
  { value: 'QUALIDADE', title: 'Qualidade', icon: 'mdi-check-decagram-outline' },
  { value: 'CLIMA', title: 'Clima', icon: 'mdi-weather-pouring' },
  { value: 'OUTRO', title: 'Outro', icon: 'mdi-dots-horizontal' },
]
const occOpen = ref(false)
const occForm = ref({ type: 'FALTA_MATERIAL', severity: 'MEDIA', title: '', description: '' })
const occPhoto = ref<File | null>(null)
function openOccurrence() {
  occForm.value = { type: 'FALTA_MATERIAL', severity: 'MEDIA', title: '', description: '' }
  occPhoto.value = null
  occOpen.value = true
}
async function sendOccurrence() {
  busy.value = true
  try {
    const o = await api.post<{ id: string }>(`/api/field/projects/${id.value}/occurrences`, { ...occForm.value, description: occForm.value.description || null })
    await sendPhoto(occPhoto.value, { occurrenceId: o.id, caption: occForm.value.title })
    occOpen.value = false
    toast(occForm.value.severity === 'BAIXA' ? 'Ocorrência registrada' : 'Ocorrência registrada: o escritório foi avisado')
    tab.value = 'ocorrencias'
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
const resolving = ref<FieldData['occurrences'][number] | null>(null)
const resolution = ref('')
async function resolve() {
  if (!resolving.value) return
  busy.value = true
  try {
    await api.post(`/api/field/occurrences/${resolving.value.id}/resolve`, { resolution: resolution.value })
    resolving.value = null
    toast('Ocorrência resolvida')
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}

// ------------------------------------------------------------ avanço
const stageOpen = ref(false)
const stage = ref<FieldData['stages'][number] | null>(null)
const stageValue = ref(0)
const stageNote = ref('')
const stagePhoto = ref<File | null>(null)
function openStage(s: FieldData['stages'][number]) {
  stage.value = s
  stageValue.value = s.progress
  stageNote.value = ''
  stagePhoto.value = null
  stageOpen.value = true
}
async function saveStage() {
  if (!stage.value) return
  busy.value = true
  try {
    const r = await api.post<{ stageUpdateId: string }>(`/api/field/stages/${stage.value.id}/progress`, { progress: stageValue.value, note: stageNote.value || null })
    await sendPhoto(stagePhoto.value, { stageUpdateId: r.stageUpdateId, caption: `${stage.value.name}: ${stageValue.value}%` })
    stageOpen.value = false
    toast(`${stage.value.name}: ${stageValue.value}%`)
    load()
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}

const viewer = ref<string | null>(null)
const ACTIONS = computed(() => [
  { key: 'material', label: 'Pedir material', icon: 'mdi-cart-plus', color: 'primary', run: openRequest },
  { key: 'entrega', label: 'Receber entrega', icon: 'mdi-truck-check-outline', color: 'info', run: () => openReceive(), badge: openDeliveries.value.length },
  { key: 'foto', label: 'Foto', icon: 'mdi-camera-outline', color: 'secondary', run: takePhoto },
  { key: 'ocorrencia', label: 'Ocorrência', icon: 'mdi-alert-octagon-outline', color: 'error', run: openOccurrence, badge: openOcc.value.length },
  { key: 'avanco', label: 'Avanço', icon: 'mdi-progress-check', color: 'success', run: () => (tab.value = 'avanco') },
])
</script>

<template>
  <div class="field-wrap">
    <input ref="fileInput" type="file" accept="image/*" capture="environment" class="d-none" @change="picked" />
    <div v-if="!data" class="pa-8 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
    <template v-else>
      <div class="d-flex align-center ga-2 mb-4">
        <v-btn icon="mdi-arrow-left" variant="text" aria-label="Voltar" @click="router.push('/campo')" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-h6 font-weight-bold text-truncate">{{ data.project.name }}</div>
          <div class="text-caption muted text-truncate">{{ data.project.code }}<template v-if="data.project.address"> · {{ data.project.address }}</template></div>
        </div>
        <v-progress-circular :model-value="data.physicalPct ?? 0" :size="58" :width="6" color="primary" bg-color="grey-lighten-3">
          <span class="text-caption font-weight-bold">{{ data.physicalPct == null ? '—' : `${Math.round(data.physicalPct)}%` }}</span>
        </v-progress-circular>
      </div>

      <div class="actions mb-4">
        <button v-for="a in ACTIONS" :key="a.key" type="button" class="action" @click="a.run()">
          <v-badge :model-value="!!a.badge" :content="a.badge" color="error" floating>
            <v-icon :color="a.color" size="30">{{ a.icon }}</v-icon>
          </v-badge>
          <span>{{ a.label }}</span>
        </button>
      </div>

      <v-tabs v-model="tab" show-arrows color="primary" density="comfortable" class="mb-3">
        <v-tab value="entregas">Entregas</v-tab>
        <v-tab value="pedidos">Pedidos <v-chip v-if="openReq.length" size="x-small" class="ml-1">{{ openReq.length }}</v-chip></v-tab>
        <v-tab value="ocorrencias">Ocorrências <v-chip v-if="openOcc.length" size="x-small" color="error" class="ml-1">{{ openOcc.length }}</v-chip></v-tab>
        <v-tab value="avanco">Avanço</v-tab>
        <v-tab value="fotos">Fotos</v-tab>
      </v-tabs>

      <!-- ENTREGAS -->
      <template v-if="tab === 'entregas'">
        <div class="section-title">A caminho</div>
        <v-card v-for="o in openDeliveries" :key="o.id" class="pa-4 mb-3">
          <div class="d-flex align-center ga-2">
            <div class="flex-grow-1">
              <div class="font-weight-bold">{{ o.supplierName }} · {{ o.code }}</div>
              <div class="text-caption" :class="o.late ? 'text-error font-weight-bold' : 'muted'">
                <v-icon size="14">{{ o.late ? 'mdi-clock-alert-outline' : 'mdi-calendar' }}</v-icon>
                {{ o.late ? 'Atrasada · era para' : 'Previsto' }} {{ date(o.expectedDate) }}
              </div>
            </div>
            <v-btn color="info" variant="flat" prepend-icon="mdi-truck-check-outline" @click="openReceive(o)">Chegou</v-btn>
          </div>
          <div v-for="i in o.items" :key="i.id" class="d-flex justify-space-between text-body-2 mt-2">
            <span class="text-truncate mr-2">{{ i.description }}</span>
            <span class="text-no-wrap">
              <b>{{ qty(i.remainingQty) }}</b> {{ i.unit }}
              <span v-if="i.receivedQty" class="muted text-caption"> (já chegou {{ qty(i.receivedQty) }})</span>
            </span>
          </div>
        </v-card>
        <div v-if="!openDeliveries.length" class="empty">Nenhuma entrega a caminho para esta obra.</div>

        <div class="section-title mt-4">Recebidas</div>
        <v-card v-for="r in data.receipts" :key="r.id" class="pa-4 mb-2">
          <div class="d-flex align-center ga-2">
            <v-icon :color="r.problem ? 'warning' : 'success'">{{ r.problem ? 'mdi-truck-alert-outline' : 'mdi-check-circle-outline' }}</v-icon>
            <div class="flex-grow-1">
              <div class="font-weight-medium">{{ r.supplierName }} · {{ r.code }}</div>
              <div class="text-caption muted">{{ when(r.receivedAt) }} · {{ r.receivedByName }}</div>
            </div>
            <v-chip v-if="r.problem" size="x-small" color="warning" variant="flat">com problema</v-chip>
          </div>
          <div class="text-body-2 mt-1">
            <span v-for="(i, k) in r.items" :key="k">{{ qty(i.quantity) }} {{ i.unit }} {{ i.description.toLowerCase() }}<span v-if="k < r.items.length - 1">; </span></span>
          </div>
          <div v-if="r.notes" class="text-caption mt-1">{{ r.notes }}</div>
          <div v-if="r.photos.length" class="thumbs mt-2"><img v-for="u in r.photos" :key="u" :src="u" alt="Foto da entrega" @click="viewer = u" /></div>
        </v-card>
        <div v-if="!data.receipts.length" class="empty">Nenhuma entrega conferida nos últimos 45 dias.</div>
      </template>

      <!-- PEDIDOS DE MATERIAL -->
      <template v-else-if="tab === 'pedidos'">
        <v-btn block color="primary" size="large" prepend-icon="mdi-cart-plus" class="mb-3" @click="openRequest">Pedir material</v-btn>
        <v-card v-for="r in data.requests" :key="r.id" class="pa-4 mb-2">
          <div class="d-flex align-center ga-2 mb-1">
            <v-chip size="small" variant="tonal" :color="REQ[r.status].color">{{ REQ[r.status].label }}{{ r.orderCode ? ` · ${r.orderCode}` : '' }}</v-chip>
            <v-chip v-if="r.urgent && r.status === 'ABERTA'" size="small" color="error" variant="flat">urgente</v-chip>
            <v-spacer />
            <span class="text-caption muted">{{ date(r.createdAt) }}</span>
          </div>
          <div v-for="(i, k) in r.items" :key="k" class="text-body-2">{{ qty(i.quantity) }} {{ i.unit }} · {{ i.description }}</div>
          <div class="text-caption muted mt-1">
            <template v-if="r.neededBy">Precisa até {{ date(r.neededBy) }} · </template>{{ r.createdByName }}
          </div>
          <div v-if="r.notes" class="text-caption mt-1">{{ r.notes }}</div>
          <div v-if="r.declineReason" class="text-caption text-error mt-1">Escritório: {{ r.declineReason }}</div>
        </v-card>
        <div v-if="!data.requests.length" class="empty">Nenhum pedido de material recente.</div>
      </template>

      <!-- OCORRÊNCIAS -->
      <template v-else-if="tab === 'ocorrencias'">
        <v-btn block color="error" variant="tonal" size="large" prepend-icon="mdi-alert-octagon-outline" class="mb-3" @click="openOccurrence">Registrar ocorrência</v-btn>
        <v-card v-for="o in data.occurrences" :key="o.id" class="pa-4 mb-2" :class="{ resolved: o.status === 'RESOLVIDA' }">
          <div class="d-flex align-center ga-2 mb-1">
            <v-chip size="x-small" :color="SEV[o.severity].color" variant="flat">{{ SEV[o.severity].label }}</v-chip>
            <span class="text-caption muted">{{ o.typeLabel }} · {{ when(o.createdAt) }}</span>
            <v-spacer />
            <v-chip v-if="o.status === 'RESOLVIDA'" size="x-small" color="success" variant="tonal">resolvida</v-chip>
          </div>
          <div class="font-weight-bold">{{ o.title }}</div>
          <div v-if="o.description" class="text-body-2">{{ o.description }}</div>
          <div v-if="o.photos.length" class="thumbs mt-2"><img v-for="u in o.photos" :key="u" :src="u" alt="Foto da ocorrência" @click="viewer = u" /></div>
          <div class="text-caption muted mt-1">{{ o.createdByName }}</div>
          <div v-if="o.resolution" class="text-caption text-success mt-1">✓ {{ o.resolution }} ({{ o.resolvedByName }}, {{ date(o.resolvedAt) }})</div>
          <v-btn v-if="o.status === 'ABERTA'" size="small" variant="tonal" color="success" class="mt-2" prepend-icon="mdi-check" @click="(resolving = o), (resolution = '')">Resolvida</v-btn>
        </v-card>
        <div v-if="!data.occurrences.length" class="empty">Nenhuma ocorrência nos últimos 45 dias.</div>
      </template>

      <!-- AVANÇO -->
      <template v-else-if="tab === 'avanco'">
        <div v-if="!data.stages.length" class="empty">As etapas desta obra ainda não foram cadastradas. Peça ao escritório para cadastrar em Obras → {{ data.project.name }}.</div>
        <div v-else class="text-caption muted mb-2">Toque na etapa para atualizar o percentual concluído.</div>
        <v-card v-for="s in data.stages" :key="s.id" class="pa-4 mb-2 stage" @click="openStage(s)">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="font-weight-medium">{{ s.name }}</span>
            <b :class="s.progress === 100 ? 'text-success' : ''">{{ s.progress }}%</b>
          </div>
          <v-progress-linear :model-value="s.progress" :color="s.progress === 100 ? 'success' : 'primary'" bg-color="grey-lighten-2" height="10" rounded />
          <div v-if="s.updatedAt" class="text-caption muted mt-1">Atualizado {{ date(s.updatedAt) }} por {{ s.updatedByName }}</div>
        </v-card>
        <template v-if="data.stageUpdates.length">
          <div class="section-title mt-4">Últimas atualizações</div>
          <div v-for="u in data.stageUpdates.slice(0, 10)" :key="u.id" class="text-body-2 mb-2">
            <span class="muted">{{ date(u.createdAt) }}</span> · <b>{{ u.stageName }}</b> {{ u.fromProgress }}% → {{ u.progress }}%
            <span class="muted"> · {{ u.userName }}</span>
            <div v-if="u.note" class="text-caption">{{ u.note }}</div>
          </div>
        </template>
      </template>

      <!-- FOTOS -->
      <template v-else>
        <v-btn block color="secondary" size="large" prepend-icon="mdi-camera-outline" class="mb-3" @click="takePhoto">Tirar foto</v-btn>
        <div v-if="data.photos.length" class="gallery">
          <figure v-for="f in data.photos" :key="f.id" @click="viewer = f.url">
            <img :src="f.url" :alt="f.caption ?? 'Foto da obra'" loading="lazy" />
            <figcaption>{{ f.caption ? `${f.caption} · ` : '' }}<span class="muted">{{ date(f.createdAt) }}</span></figcaption>
          </figure>
        </div>
        <div v-else class="empty">Nenhuma foto ainda. As fotos tiradas aqui ficam no diário da obra e o escritório vê na hora.</div>
      </template>
    </template>

    <!-- DIÁLOGOS -->
    <v-dialog v-model="reqOpen" :fullscreen="smAndDown" max-width="560" scrollable>
      <v-card>
        <v-toolbar color="surface" density="comfortable"><v-btn icon="mdi-close" @click="reqOpen = false" /><v-toolbar-title>Pedir material</v-toolbar-title></v-toolbar>
        <v-card-text>
          <div v-for="(i, k) in reqForm.items" :key="k" class="req-row">
            <v-text-field v-model="i.description" label="Material" density="comfortable" class="desc" />
            <v-text-field v-model="i.quantity" label="Qtd." inputmode="decimal" density="comfortable" class="q" />
            <v-text-field v-model="i.unit" label="Un." density="comfortable" class="u" />
          </div>
          <v-btn variant="text" prepend-icon="mdi-plus" size="small" class="mb-3" @click="reqForm.items.push({ description: '', unit: '', quantity: '' })">Mais um material</v-btn>
          <v-text-field v-model="reqForm.neededBy" type="date" label="Precisa até" />
          <v-switch v-model="reqForm.urgent" color="error" label="Urgente (obra pode parar)" inset hide-details class="mb-2" />
          <v-textarea v-model="reqForm.notes" label="Observação (opcional)" rows="2" auto-grow />
        </v-card-text>
        <div class="pa-4"><v-btn block size="large" color="primary" :disabled="!reqValid" :loading="busy" @click="sendRequest">Enviar ao escritório</v-btn></div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="recOpen" :fullscreen="smAndDown" max-width="560" scrollable>
      <v-card>
        <v-toolbar color="surface" density="comfortable"><v-btn icon="mdi-close" @click="recOpen = false" /><v-toolbar-title>Receber entrega</v-toolbar-title></v-toolbar>
        <v-card-text>
          <template v-if="!recOrder">
            <div class="text-body-2 mb-2">Qual entrega chegou?</div>
            <v-card v-for="o in openDeliveries" :key="o.id" variant="outlined" class="pa-3 mb-2" @click="chooseOrder(o)">
              <div class="font-weight-bold">{{ o.supplierName }} · {{ o.code }}</div>
              <div class="text-caption muted">{{ o.items.map((i) => i.description.toLowerCase()).join(', ') }}</div>
            </v-card>
            <div v-if="!openDeliveries.length" class="empty">Nenhum pedido aguardando entrega nesta obra. Se chegou algo sem pedido, registre uma ocorrência.</div>
          </template>
          <template v-else>
            <div class="font-weight-bold mb-1">{{ recOrder.supplierName }} · {{ recOrder.code }}</div>
            <div class="text-caption muted mb-3">Confira e corrija a quantidade que chegou de verdade.</div>
            <div v-for="i in recOrder.items" :key="i.id" class="mb-2">
              <div class="text-body-2 font-weight-medium">{{ i.description }}</div>
              <v-text-field v-model="recQty[i.id]" :suffix="i.unit ?? ''" inputmode="decimal" density="comfortable" :hint="`Faltavam ${qty(i.remainingQty)} ${i.unit ?? ''}`" persistent-hint />
            </div>
            <v-switch v-model="recProblem" color="warning" label="Chegou com problema (avaria, faltou, errado)" inset hide-details class="my-2" />
            <v-textarea v-model="recNotes" :label="recProblem ? 'O que aconteceu? (obrigatório)' : 'Observação (opcional)'" rows="2" auto-grow />
            <div class="d-flex align-center ga-3">
              <v-btn variant="tonal" prepend-icon="mdi-camera-outline" @click="pickPhoto((f) => (recPhoto = f))">{{ recPhoto ? 'Trocar foto' : 'Foto da entrega' }}</v-btn>
              <img v-if="recPhoto" :src="preview(recPhoto)" class="mini" alt="Prévia" />
            </div>
          </template>
        </v-card-text>
        <div v-if="recOrder" class="pa-4"><v-btn block size="large" :color="recProblem ? 'warning' : 'info'" :loading="busy" :disabled="recProblem && !recNotes.trim()" @click="sendReceive">Confirmar recebimento</v-btn></div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="photoOpen" :fullscreen="smAndDown" max-width="560">
      <v-card>
        <v-toolbar color="surface" density="comfortable"><v-btn icon="mdi-close" @click="photoOpen = false" /><v-toolbar-title>Foto da obra</v-toolbar-title></v-toolbar>
        <v-card-text>
          <img v-if="photoFile" :src="preview(photoFile)" class="big-preview mb-3" alt="Prévia da foto" />
          <v-text-field v-model="photoCaption" label="Legenda (ex.: laje do 3º pavimento)" />
        </v-card-text>
        <div class="pa-4"><v-btn block size="large" color="primary" :loading="busy" @click="savePhoto">Salvar no diário</v-btn></div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="occOpen" :fullscreen="smAndDown" max-width="560" scrollable>
      <v-card>
        <v-toolbar color="surface" density="comfortable"><v-btn icon="mdi-close" @click="occOpen = false" /><v-toolbar-title>Ocorrência</v-toolbar-title></v-toolbar>
        <v-card-text>
          <div class="text-body-2 mb-2">O que aconteceu?</div>
          <div class="types mb-3">
            <button v-for="t in TYPES" :key="t.value" type="button" class="type" :class="{ on: occForm.type === t.value }" @click="occForm.type = t.value">
              <v-icon size="22">{{ t.icon }}</v-icon><span>{{ t.title }}</span>
            </button>
          </div>
          <div class="text-body-2 mb-2">Gravidade</div>
          <v-btn-toggle v-model="occForm.severity" mandatory divided variant="outlined" class="mb-1 w-100">
            <v-btn value="BAIXA" class="flex-grow-1">Baixa</v-btn>
            <v-btn value="MEDIA" class="flex-grow-1" color="warning">Média</v-btn>
            <v-btn value="ALTA" class="flex-grow-1" color="error">Alta</v-btn>
          </v-btn-toggle>
          <div class="text-caption muted mb-3">{{ occForm.severity === 'ALTA' ? 'Alta: obra parada ou risco a pessoas. O escritório recebe alerta crítico.' : occForm.severity === 'MEDIA' ? 'Média: atrapalha o serviço. O escritório recebe alerta.' : 'Baixa: só fica registrado no diário.' }}</div>
          <v-text-field v-model="occForm.title" label="Resumo (ex.: equipe parada sem cabo)" />
          <v-textarea v-model="occForm.description" label="Detalhes (opcional)" rows="2" auto-grow />
          <div class="d-flex align-center ga-3">
            <v-btn variant="tonal" prepend-icon="mdi-camera-outline" @click="pickPhoto((f) => (occPhoto = f))">{{ occPhoto ? 'Trocar foto' : 'Foto' }}</v-btn>
            <img v-if="occPhoto" :src="preview(occPhoto)" class="mini" alt="Prévia" />
          </div>
        </v-card-text>
        <div class="pa-4"><v-btn block size="large" color="error" :disabled="occForm.title.trim().length < 3" :loading="busy" @click="sendOccurrence">Registrar</v-btn></div>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!resolving" max-width="460" @update:model-value="resolving = null">
      <v-card class="pa-5">
        <div class="card-title mb-2">Como foi resolvido?</div>
        <v-textarea v-model="resolution" rows="2" auto-grow autofocus />
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="resolving = null">Voltar</v-btn>
          <v-btn color="success" :disabled="resolution.trim().length < 3" :loading="busy" @click="resolve">Marcar como resolvida</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="stageOpen" :fullscreen="smAndDown" max-width="520">
      <v-card v-if="stage">
        <v-toolbar color="surface" density="comfortable"><v-btn icon="mdi-close" @click="stageOpen = false" /><v-toolbar-title>{{ stage.name }}</v-toolbar-title></v-toolbar>
        <v-card-text>
          <div class="text-center mb-2"><span class="text-h3 font-weight-bold text-primary">{{ stageValue }}%</span></div>
          <v-slider v-model="stageValue" :min="0" :max="100" :step="5" color="primary" thumb-label hide-details class="mb-2" />
          <div class="d-flex ga-2 mb-4 flex-wrap">
            <v-chip v-for="v in [25, 50, 75, 100]" :key="v" size="small" @click="stageValue = v">{{ v }}%</v-chip>
          </div>
          <v-textarea v-model="stageNote" label="Observação (opcional)" rows="2" auto-grow />
          <div class="d-flex align-center ga-3">
            <v-btn variant="tonal" prepend-icon="mdi-camera-outline" @click="pickPhoto((f) => (stagePhoto = f))">{{ stagePhoto ? 'Trocar foto' : 'Foto do serviço' }}</v-btn>
            <img v-if="stagePhoto" :src="preview(stagePhoto)" class="mini" alt="Prévia" />
          </div>
        </v-card-text>
        <div class="pa-4"><v-btn block size="large" color="primary" :loading="busy" :disabled="stageValue === stage.progress" @click="saveStage">Salvar avanço</v-btn></div>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!viewer" max-width="960" @update:model-value="viewer = null">
      <v-card v-if="viewer" class="pa-2" @click="viewer = null"><img :src="viewer" alt="Foto ampliada" style="width: 100%; border-radius: 8px" /></v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.field-wrap {
  max-width: 760px;
}
.actions {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 4px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.15;
  text-align: center;
  color: inherit;
  cursor: pointer;
}
.action:active {
  transform: scale(0.97);
}
@media (max-width: 420px) {
  .actions {
    grid-template-columns: repeat(3, 1fr);
  }
}
.section-title {
  font-weight: 700;
  margin-bottom: 8px;
}
.empty {
  color: var(--oo-muted);
  font-size: 0.875rem;
  padding: 12px 4px;
}
.resolved {
  opacity: 0.7;
}
.stage {
  cursor: pointer;
}
.thumbs {
  display: flex;
  gap: 6px;
}
.thumbs img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
}
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.gallery figure {
  margin: 0;
  cursor: pointer;
}
.gallery img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 10px;
}
.gallery figcaption {
  font-size: 0.75rem;
  margin-top: 2px;
}
.req-row {
  display: flex;
  gap: 8px;
}
.req-row .desc {
  flex: 1 1 auto;
}
.req-row .q {
  flex: 0 0 84px;
}
.req-row .u {
  flex: 0 0 68px;
}
.mini {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
}
.big-preview {
  width: 100%;
  max-height: 50vh;
  object-fit: contain;
  border-radius: 10px;
  background: #000;
}
.types {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.type {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  font-size: 0.75rem;
  background: none;
  color: inherit;
  cursor: pointer;
}
.type.on {
  border-color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
  font-weight: 700;
}
</style>
