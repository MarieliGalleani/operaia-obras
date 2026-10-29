<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/lib/api'
import { toast, toastError } from '@/lib/toast'

const info = ref<{ apiKey: string; nfeEndpoint: string } | null>(null)
const reveal = ref(false)
onMounted(async () => {
  try {
    info.value = await api.get('/api/integrations')
  } catch (e) {
    toastError(e)
  }
})
const base = computed(() => `${window.location.origin}${info.value?.nfeEndpoint ?? ''}`)
const curl = computed(
  () => `curl -X POST ${base.value} \\
  -H "x-api-key: ${reveal.value ? info.value?.apiKey : '••••••••'}" \\
  -H "x-source: email" \\
  -H "Content-Type: application/xml" \\
  --data-binary @nota.xml`,
)
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copiado')
  } catch {
    toast('Não foi possível copiar', 'warning')
  }
}

const planned = [
  { name: 'E-mail (via n8n)', desc: 'Caixa dedicada recebe as notas e envia os XMLs para o endpoint abaixo.', status: 'Disponível', color: 'success' },
  { name: 'Planilha / CSV', desc: 'Exportar lançamentos e títulos para o financeiro atual.', status: 'Próximo', color: 'info' },
  { name: 'Sienge · TOTVS · Conta Azul', desc: 'Sincronizar obras, fornecedores e títulos com o ERP existente.', status: 'Planejado', color: 'grey' },
  { name: 'Google Drive', desc: 'Arquivar XML e PDF por obra e mês.', status: 'Planejado', color: 'grey' },
  { name: 'WhatsApp', desc: 'Notificar alertas críticos e receber fotos de comprovantes do canteiro.', status: 'Planejado', color: 'grey' },
]
</script>

<template>
  <div class="mb-6">
    <div class="page-title">Integrações</div>
    <div class="page-subtitle">Conecte com o que a construtora já usa. A primeira porta de entrada é o e-mail.</div>
  </div>

  <v-card class="pa-5 mb-4">
    <div class="card-title mb-1">Receber NF-e automaticamente</div>
    <div class="text-body-2 muted mb-4">
      Configure um fluxo no n8n (ou outro automatizador) que pega os anexos .xml da caixa de notas e faz um POST neste endpoint. Reenvios da mesma nota são ignorados.
    </div>
    <v-text-field :model-value="reveal ? info?.apiKey : '•'.repeat(24)" label="Chave de integração" readonly class="mb-3" style="max-width: 520px">
      <template #append-inner>
        <v-btn size="small" variant="text" :icon="reveal ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" @click="reveal = !reveal" />
        <v-btn size="small" variant="text" icon="mdi-content-copy" @click="copy(info?.apiKey ?? '')" />
      </template>
    </v-text-field>
    <pre class="code">{{ curl }}</pre>
    <div class="text-caption muted mt-2">A chave dá acesso de escrita às notas desta construtora. Guarde como credencial no n8n.</div>
  </v-card>

  <v-row dense>
    <v-col v-for="p in planned" :key="p.name" cols="12" sm="6" lg="4">
      <v-card class="pa-4 h-100">
        <div class="d-flex justify-space-between align-start">
          <div class="font-weight-bold">{{ p.name }}</div>
          <v-chip :color="p.color" variant="tonal">{{ p.status }}</v-chip>
        </div>
        <div class="text-body-2 muted mt-2">{{ p.desc }}</div>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.code {
  background: #0f1f1a;
  color: #d8f3e7;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 0.8rem;
  overflow-x: auto;
}
</style>
