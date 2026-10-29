<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/lib/api'
import { toastError } from '@/lib/toast'

export interface UploadResult {
  fileName: string
  status: 'CRIADO' | 'JA_IMPORTADO' | 'ERRO'
  documentId?: string
  message?: string
  document?: { status: string; number: string | null; supplier: { name: string } | null; issues: { severity: string }[] }
}

const emit = defineEmits<{ done: [results: UploadResult[]]; open: [id: string] }>()
const dragging = ref(false)
const uploading = ref(false)
const input = ref<HTMLInputElement>()
const results = ref<UploadResult[]>([])

async function send(files: FileList | File[]) {
  const list = [...files]
  if (!list.length) return
  const form = new FormData()
  for (const f of list) form.append('files', f, f.name)
  uploading.value = true
  try {
    const res = await api.post<{ results: UploadResult[] }>('/api/documents/upload', form)
    results.value = res.results
    emit('done', res.results)
  } catch (e) {
    toastError(e)
  } finally {
    uploading.value = false
    if (input.value) input.value.value = ''
  }
}
function onDrop(e: DragEvent) {
  dragging.value = false
  if (e.dataTransfer?.files) send(e.dataTransfer.files)
}
const label = (r: UploadResult) => {
  if (r.status === 'ERRO') return { color: 'error', text: r.message ?? 'Erro' }
  if (r.status === 'JA_IMPORTADO') return { color: 'grey', text: 'Já importada antes' }
  if (r.document?.status === 'EM_REVISAO') return { color: 'warning', text: 'Precisa de revisão' }
  return { color: 'success', text: 'Lida e validada' }
}
</script>

<template>
  <div
    class="zone"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @click="input?.click()"
  >
    <input ref="input" type="file" multiple accept=".xml,.pdf,.jpg,.jpeg,.png" hidden @change="send(($event.target as HTMLInputElement).files ?? [])" />
    <v-progress-circular v-if="uploading" indeterminate color="primary" />
    <template v-else>
      <v-icon size="30" color="primary">mdi-tray-arrow-up</v-icon>
      <div class="font-weight-medium mt-1">Arraste XMLs de NF-e ou PDFs aqui</div>
      <div class="text-caption muted">ou clique para selecionar · vários arquivos de uma vez</div>
    </template>
  </div>
  <div v-if="results.length" class="mt-3 d-flex flex-column ga-1">
    <div v-for="r in results" :key="r.fileName + r.documentId" class="d-flex align-center ga-2 text-body-2">
      <v-icon size="18" :color="label(r).color">{{ r.status === 'ERRO' ? 'mdi-close-circle' : 'mdi-check-circle' }}</v-icon>
      <span class="text-truncate" style="max-width: 280px">{{ r.fileName }}</span>
      <v-chip :color="label(r).color" variant="tonal">{{ label(r).text }}</v-chip>
      <a v-if="r.documentId" class="link text-caption" @click.stop="emit('open', r.documentId!)">abrir</a>
    </div>
  </div>
</template>

<style scoped>
.zone {
  border: 2px dashed #c9d3cf;
  border-radius: 12px;
  padding: 22px;
  text-align: center;
  cursor: pointer;
  background: #fafcfb;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.zone:hover,
.zone.dragging {
  border-color: var(--oo-bright);
  background: #effaf5;
}
</style>
