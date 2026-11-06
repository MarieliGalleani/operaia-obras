<script setup lang="ts">
/** Medição para imprimir ou salvar em PDF (pelo navegador). Serve à construtora e ao proprietário. */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import MeasurementPreview from '@/components/MeasurementPreview.vue'
import { api } from '@/lib/api'
import { cnpj } from '@/lib/format'
import { type Measurement } from '@/lib/measurement'
import { toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const m = ref<Measurement | null>(null)

onMounted(async () => {
  const id = route.params.id as string
  const month = route.query.month ? `?month=${route.query.month}` : ''
  try {
    m.value = await api.get<Measurement>(auth.isProprietario ? `/api/owner/projects/${id}/measurement${month}` : `/api/projects/${id}/measurement${month}`)
    document.title = `Medição ${m.value.period.month} · ${m.value.project.name}`
  } catch (e) {
    toastError(e)
  }
})
const doPrint = () => window.print()
const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
</script>

<template>
  <div class="print-page">
    <div class="no-print d-flex justify-space-between align-center mb-4">
      <v-btn variant="text" prepend-icon="mdi-arrow-left" @click="router.back()">Voltar</v-btn>
      <v-btn color="primary" prepend-icon="mdi-printer-outline" @click="doPrint">Imprimir ou salvar PDF</v-btn>
    </div>
    <template v-if="m">
      <div class="d-flex justify-space-between align-start mb-5 head">
        <div>
          <div class="text-h6 font-weight-bold">{{ m.project.code }} · {{ m.project.name }}</div>
          <div class="text-body-2 muted">{{ m.project.address }}</div>
          <div v-if="m.contract.ownerName" class="text-body-2">Proprietário: {{ m.contract.ownerName }}</div>
        </div>
        <div class="text-right">
          <AppLogo />
          <div class="text-body-2 font-weight-medium mt-1">{{ auth.me?.company.name }}</div>
          <div class="text-caption muted">{{ cnpj(auth.me?.company.cnpj) }}</div>
        </div>
      </div>
      <MeasurementPreview :m="m" printable />
      <div class="text-caption muted mt-4">Gerado em {{ now }} pelo OperaIA Obras.</div>
    </template>
  </div>
</template>

<style scoped>
.print-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  background: #fff;
  min-height: 100vh;
}
.head {
  border-bottom: 2px solid #0e6b53;
  padding-bottom: 12px;
}
@media print {
  .no-print {
    display: none !important;
  }
  .print-page {
    padding: 0;
  }
}
</style>
