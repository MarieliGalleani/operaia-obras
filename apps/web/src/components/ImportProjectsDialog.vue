<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { CATEGORIES, brl } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'

interface Row {
  line: number
  code: string
  name: string
  address: string | null
  status: string
  startDate: string | null
  endDate: string | null
  budgets: Array<{ category: string; amount: number }>
  budgetTotal: number
  action: 'NOVA' | 'ATUALIZA' | null
  errors: string[]
  warnings: string[]
}
interface Preview {
  fileName: string
  rows: Row[]
  summary: { total: number; create: number; update: number; errors: number }
  columnsMissing: string[]
}

const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ imported: [] }>()

const file = ref<File | null>(null)
const preview = ref<Preview | null>(null)
const reading = ref(false)
const saving = ref(false)
const downloading = ref(false)
const onlyErrors = ref(false)
const dragging = ref(false)
const input = ref<HTMLInputElement>()

watch(open, (v) => {
  if (v) {
    file.value = null
    preview.value = null
    onlyErrors.value = false
  }
})

const dateBR = (ymd: string) => ymd.split('-').reverse().join('/')
const STATUS: Record<string, string> = { ATIVA: 'Ativa', PAUSADA: 'Pausada', CONCLUIDA: 'Concluída' }
const catLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.title ?? c
const shown = computed(() => (preview.value?.rows ?? []).filter((r) => !onlyErrors.value || r.errors.length))
const importable = computed(() => (preview.value ? preview.value.summary.create + preview.value.summary.update : 0))

function form() {
  const fd = new FormData()
  fd.append('file', file.value!, file.value!.name)
  return fd
}
async function pick(f: File | undefined | null) {
  if (!f) return
  file.value = f
  reading.value = true
  preview.value = null
  try {
    preview.value = await api.post<Preview>('/api/projects/import/preview', form())
  } catch (e) {
    toastError(e)
    file.value = null
  } finally {
    reading.value = false
    if (input.value) input.value.value = ''
  }
}
function drop(e: DragEvent) {
  dragging.value = false
  pick(e.dataTransfer?.files?.[0])
}
async function template() {
  downloading.value = true
  try {
    await api.download('/api/projects/import/template.xlsx', 'obras-operaia.xlsx')
  } catch (e) {
    toastError(e)
  } finally {
    downloading.value = false
  }
}
async function confirm() {
  saving.value = true
  try {
    const r = await api.post<{ created: number; updated: number; skipped: number }>('/api/projects/import', form())
    const parts = [r.created && `${r.created} cadastrada${r.created > 1 ? 's' : ''}`, r.updated && `${r.updated} atualizada${r.updated > 1 ? 's' : ''}`].filter(Boolean)
    toast(`Obras importadas: ${parts.join(', ')}${r.skipped ? ` · ${r.skipped} com erro ficaram de fora` : ''}`)
    open.value = false
    emit('imported')
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" :max-width="preview ? 1100 : 620" scrollable>
    <v-card>
      <v-card-title class="pa-5 card-title d-flex align-center">
        Importar obras por planilha
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="open = false" />
      </v-card-title>

      <v-card-text class="px-5 pb-2">
        <template v-if="!preview">
          <ol class="steps mb-5">
            <li>
              <div class="font-weight-medium">Baixe a planilha modelo</div>
              <div class="text-body-2 muted">Uma linha por obra: código, nome, endereço, situação, datas e orçamento por categoria. Ela já vem com as obras que você tem hoje, para atualizar.</div>
              <v-btn class="mt-2" variant="outlined" color="primary" prepend-icon="mdi-microsoft-excel" :loading="downloading" @click="template">Baixar modelo (.xlsx)</v-btn>
            </li>
            <li>
              <div class="font-weight-medium">Preencha e envie</div>
              <div class="text-body-2 muted">Código que já existe atualiza a obra; código novo cadastra. Também aceita .csv do Excel ou do Google Planilhas.</div>
            </li>
          </ol>
          <div
            class="drop pa-8 text-center"
            :class="{ over: dragging }"
            @click="input?.click()"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="drop"
          >
            <v-progress-circular v-if="reading" indeterminate color="primary" class="mb-2" />
            <v-icon v-else icon="mdi-file-upload-outline" size="40" color="primary" class="mb-2" />
            <div class="font-weight-medium">{{ reading ? `Lendo ${file?.name}…` : 'Arraste a planilha aqui ou clique para escolher' }}</div>
            <div class="text-caption muted">.xlsx ou .csv · até 500 obras · nada é gravado antes da sua confirmação</div>
            <input ref="input" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden @change="pick(($event.target as HTMLInputElement).files?.[0])" />
          </div>
        </template>

        <template v-else>
          <div class="d-flex flex-wrap align-center ga-2 mb-4">
            <v-icon icon="mdi-file-table-outline" class="muted" />
            <span class="font-weight-medium mr-2">{{ preview.fileName }}</span>
            <v-chip v-if="preview.summary.create" color="success" variant="tonal" size="small" prepend-icon="mdi-plus">{{ preview.summary.create }} nova{{ preview.summary.create > 1 ? 's' : '' }}</v-chip>
            <v-chip v-if="preview.summary.update" color="info" variant="tonal" size="small" prepend-icon="mdi-pencil">{{ preview.summary.update }} para atualizar</v-chip>
            <v-chip v-if="preview.summary.errors" color="error" variant="tonal" size="small" prepend-icon="mdi-alert-circle">{{ preview.summary.errors }} com erro</v-chip>
            <v-spacer />
            <v-switch v-if="preview.summary.errors" v-model="onlyErrors" label="Só as linhas com erro" density="compact" hide-details color="error" class="flex-grow-0" />
          </div>
          <v-alert v-if="preview.columnsMissing.length" type="info" variant="tonal" density="compact" class="mb-3">
            Colunas não encontradas (ficam em branco): {{ preview.columnsMissing.join(', ') }}.
          </v-alert>
          <v-table density="compact" class="preview-table">
            <thead>
              <tr>
                <th style="width: 56px">Linha</th>
                <th>Obra</th>
                <th>Situação</th>
                <th>Período</th>
                <th>Orçamento por categoria</th>
                <th class="text-right">Total</th>
                <th style="width: 120px">Resultado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in shown" :key="r.line" :class="{ 'row-error': r.errors.length }">
                <td class="muted">{{ r.line }}</td>
                <td>
                  <div class="text-caption muted">{{ r.code || '—' }}</div>
                  <div class="font-weight-medium">{{ r.name || '—' }}</div>
                  <div v-if="r.address" class="text-caption muted text-truncate" style="max-width: 260px">{{ r.address }}</div>
                </td>
                <td>{{ STATUS[r.status] }}</td>
                <td class="text-caption text-no-wrap">
                  <div>{{ r.startDate ? dateBR(r.startDate) : '—' }}</div>
                  <div v-if="r.endDate" class="muted">até {{ dateBR(r.endDate) }}</div>
                </td>
                <td class="text-caption">
                  <span v-if="!r.budgets.length" class="muted">—</span>
                  <span v-for="b in r.budgets" :key="b.category" class="mr-2 d-inline-block">{{ catLabel(b.category) }} <span class="money">{{ brl(b.amount, { compact: true }) }}</span></span>
                </td>
                <td class="text-right money font-weight-medium">{{ r.budgetTotal ? brl(r.budgetTotal) : '—' }}</td>
                <td>
                  <v-chip v-if="r.action === 'NOVA'" color="success" size="x-small" variant="flat">Nova</v-chip>
                  <v-chip v-else-if="r.action === 'ATUALIZA'" color="info" size="x-small" variant="flat">Atualiza</v-chip>
                  <v-chip v-else color="error" size="x-small" variant="flat">Erro</v-chip>
                </td>
              </tr>
            </tbody>
          </v-table>
          <div v-if="preview.rows.some((r) => r.errors.length || r.warnings.length)" class="mt-4">
            <div class="text-body-2 font-weight-bold mb-2">O que conferir</div>
            <div v-for="r in shown.filter((x) => x.errors.length || x.warnings.length)" :key="`n${r.line}`" class="text-body-2 mb-1">
              <span class="muted">Linha {{ r.line }}{{ r.code ? ` (${r.code})` : '' }}:</span>
              <span v-for="e in r.errors" :key="e" class="text-error ml-1">{{ e }}.</span>
              <span v-for="w in r.warnings" :key="w" class="text-warning ml-1">{{ w }}.</span>
            </div>
          </div>
        </template>
      </v-card-text>

      <v-card-actions v-if="preview" class="pa-5">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" @click="preview = null; file = null">Outra planilha</v-btn>
        <v-spacer />
        <span v-if="preview.summary.errors && importable" class="text-caption muted mr-3">As linhas com erro ficam de fora. Corrija e importe de novo depois.</span>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!importable" @click="confirm">
          Importar {{ importable }} obra{{ importable === 1 ? '' : 's' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.steps {
  padding-left: 20px;
  display: grid;
  gap: 16px;
}
.drop {
  border: 2px dashed rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.drop:hover,
.drop.over {
  background: rgba(var(--v-theme-primary), 0.05);
}
.preview-table td {
  vertical-align: top;
  padding-top: 8px !important;
  padding-bottom: 8px !important;
}
.row-error {
  background: rgba(var(--v-theme-error), 0.05);
}
</style>
