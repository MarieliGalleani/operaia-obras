<script setup lang="ts">
/**
 * Miniatura da nota ao lado dos dados.
 * - PDF ou foto enviados: mostra o próprio arquivo.
 * - NF-e em XML (sem PDF): desenha uma DANFE simplificada a partir dos dados do XML.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api, getToken } from '@/lib/api'
import { DEMO } from '@/lib/demo'
import { brl, cnpj, date } from '@/lib/format'
import type { DocumentDetail } from '@/lib/types'

const props = defineProps<{ doc: DocumentDetail }>()

const kind = computed<'pdf' | 'image' | 'danfe' | 'none'>(() => {
  const name = props.doc.fileName?.toLowerCase() ?? ''
  if (props.doc.hasFile && name.endsWith('.pdf')) return 'pdf'
  if (props.doc.hasFile && /\.(jpe?g|png|webp)$/.test(name)) return 'image'
  if (props.doc.type === 'NFE') return 'danfe'
  return 'none'
})

const blobUrl = ref<string | null>(null)
const failed = ref(false)
const zoom = ref(false)

async function loadFile() {
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
  blobUrl.value = null
  failed.value = false
  if (kind.value !== 'pdf' && kind.value !== 'image') return
  if (DEMO) return void (failed.value = true)
  try {
    const res = await fetch(`/api/documents/${props.doc.id}/file`, { headers: { authorization: `Bearer ${getToken()}` } })
    if (!res.ok) throw new Error()
    blobUrl.value = URL.createObjectURL(await res.blob())
  } catch {
    failed.value = true
  }
}
watch(() => props.doc.id, loadFile, { immediate: true })
onBeforeUnmount(() => blobUrl.value && URL.revokeObjectURL(blobUrl.value))

const keyGroups = computed(() => (props.doc.accessKey ?? '').replace(/\D/g, '').match(/.{1,4}/g)?.join(' ') ?? '')
// "código de barras" decorativo, estável por chave
const bars = computed(() => {
  const k = (props.doc.accessKey ?? props.doc.id).replace(/\D/g, '') || '1234567890'
  return Array.from({ length: 44 }, (_, i) => 1 + (Number(k[i % k.length]) % 3))
})
const items = computed(() => props.doc.items.slice(0, 4))
const issuerName = computed(() => props.doc.supplier?.name ?? props.doc.issuer?.name ?? 'Emitente')
const issuerCnpj = computed(() => cnpj(props.doc.supplier?.cnpj ?? props.doc.issuer?.cnpj))

function openOriginal() {
  if (props.doc.hasFile) api.openFile(`/api/documents/${props.doc.id}/file`).catch(() => {})
}
</script>

<template>
  <div v-if="kind !== 'none'" class="preview" role="button" tabindex="0" :aria-label="`Ampliar ${doc.type === 'NFE' ? 'nota' : 'documento'}`" @click="zoom = true" @keydown.enter="zoom = true">
    <!-- arquivo real -->
    <img v-if="kind === 'image' && blobUrl" :src="blobUrl" alt="Foto do documento" class="file" />
    <iframe v-else-if="kind === 'pdf' && blobUrl" :src="`${blobUrl}#toolbar=0&view=FitH`" title="PDF do documento" class="file pdf" />
    <div v-else-if="kind !== 'danfe'" class="file placeholder">
      <v-icon size="36" color="grey">{{ failed ? 'mdi-file-alert-outline' : 'mdi-file-outline' }}</v-icon>
    </div>

    <!-- DANFE simplificada a partir do XML -->
    <div v-else class="danfe">
      <div class="d-top">
        <div class="d-issuer">
          <b>{{ issuerName }}</b>
          <span>CNPJ {{ issuerCnpj }}</span>
        </div>
        <div class="d-box">
          <b>DANFE</b>
          <span>NF-e</span>
          <span>Nº {{ doc.number ?? '—' }}</span>
          <span v-if="doc.series">Série {{ doc.series }}</span>
        </div>
      </div>
      <div class="d-bars" aria-hidden="true"><i v-for="(w, i) in bars" :key="i" :style="{ flexGrow: w }" :class="{ gap: i % 2 }" /></div>
      <div class="d-key">{{ keyGroups }}</div>
      <div class="d-row"><span>Emissão</span><b>{{ date(doc.issueDate) }}</b></div>
      <div class="d-items">
        <div v-for="it in items" :key="it.id" class="d-item">
          <span>{{ it.description }}</span><b>{{ brl(it.total) }}</b>
        </div>
        <div v-if="doc.items.length > items.length" class="d-more">+ {{ doc.items.length - items.length }} item(ns)</div>
      </div>
      <div class="d-total"><span>Valor total</span><b>{{ brl(doc.totalAmount) }}</b></div>
    </div>
    <div class="zoom-hint"><v-icon size="16">mdi-magnify-plus-outline</v-icon></div>
  </div>

  <v-dialog v-model="zoom" max-width="760">
    <v-card>
      <v-card-title class="d-flex align-center py-3 px-5">
        <span class="text-subtitle-1 font-weight-bold">{{ kind === 'danfe' ? 'Representação da NF-e' : doc.fileName }}</span>
        <v-spacer />
        <v-btn v-if="doc.hasFile" variant="text" size="small" prepend-icon="mdi-open-in-new" @click="openOriginal">Abrir original</v-btn>
        <v-btn icon="mdi-close" variant="text" size="small" @click="zoom = false" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4 zoomed">
        <img v-if="kind === 'image' && blobUrl" :src="blobUrl" alt="Foto do documento" style="width: 100%" />
        <iframe v-else-if="kind === 'pdf' && blobUrl" :src="blobUrl" title="PDF do documento" style="width: 100%; height: 70vh; border: 0" />
        <div v-else-if="kind === 'danfe'" class="danfe big">
          <div class="d-top">
            <div class="d-issuer">
              <b>{{ issuerName }}</b>
              <span>CNPJ {{ issuerCnpj }}</span>
            </div>
            <div class="d-box">
              <b>DANFE</b>
              <span>NF-e</span>
              <span>Nº {{ doc.number ?? '—' }}</span>
              <span v-if="doc.series">Série {{ doc.series }}</span>
            </div>
          </div>
          <div class="d-bars" aria-hidden="true"><i v-for="(w, i) in bars" :key="i" :style="{ flexGrow: w }" :class="{ gap: i % 2 }" /></div>
          <div class="d-key">{{ keyGroups }}</div>
          <div class="d-row"><span>Emissão</span><b>{{ date(doc.issueDate) }}</b></div>
          <div class="d-row" v-if="doc.recipientCnpj"><span>Destinatário</span><b>CNPJ {{ cnpj(doc.recipientCnpj) }}</b></div>
          <div class="d-items">
            <div v-for="it in doc.items" :key="it.id" class="d-item">
              <span>{{ Number(it.quantity).toLocaleString('pt-BR') }} {{ it.unit }} · {{ it.description }}</span><b>{{ brl(it.total) }}</b>
            </div>
          </div>
          <div v-if="doc.extraInfo" class="d-extra">{{ doc.extraInfo }}</div>
          <div class="d-total"><span>Valor total</span><b>{{ brl(doc.totalAmount) }}</b></div>
        </div>
        <div v-else class="text-body-2 muted pa-6 text-center">Não foi possível carregar o arquivo.</div>
        <div v-if="kind === 'danfe'" class="text-caption muted mt-3">
          Desenhada a partir do XML da nota, que é o documento fiscal válido. Não substitui a DANFE impressa pelo fornecedor.
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.preview {
  position: relative;
  width: 168px;
  height: 224px;
  flex-shrink: 0;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  overflow: hidden;
  cursor: zoom-in;
  box-shadow: 0 2px 8px rgba(15, 31, 26, 0.08);
}
.preview:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}
.file {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
  border: 0;
  pointer-events: none;
}
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f6f5;
}
.zoom-hint {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 6px;
  padding: 2px 4px;
  line-height: 1;
}
.danfe {
  font-size: 7px;
  line-height: 1.25;
  color: #222;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: 'Inter', Arial, sans-serif;
}
.danfe b {
  font-weight: 700;
}
.d-top {
  display: flex;
  gap: 4px;
  border: 1px solid #444;
}
.d-issuer {
  flex: 1;
  padding: 3px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}
.d-box {
  width: 42%;
  border-left: 1px solid #444;
  padding: 3px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.d-box b {
  font-size: 1.5em;
}
.d-bars {
  display: flex;
  height: 16px;
}
.d-bars i {
  background: #111;
}
.d-bars i.gap {
  background: transparent;
}
.d-key {
  font-family: monospace;
  letter-spacing: 0.02em;
  text-align: center;
  word-break: break-all;
}
.d-row,
.d-item,
.d-total {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.d-items {
  border-top: 1px solid #bbb;
  border-bottom: 1px solid #bbb;
  padding: 3px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.d-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-more,
.d-extra {
  color: #666;
}
.d-total {
  font-size: 1.15em;
}
.danfe.big {
  font-size: 13px;
  padding: 16px;
  gap: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
}
.danfe.big .d-bars {
  height: 40px;
}
.danfe.big .d-item span {
  white-space: normal;
}
.zoomed {
  max-height: 80vh;
  overflow: auto;
}
</style>
