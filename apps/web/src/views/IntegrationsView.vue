<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/lib/api'
import MailInboxCard from '@/components/MailInboxCard.vue'
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

const catalog = [
  { name: 'E-mail', role: 'Recebimento automático', icon: 'mdi-email-fast-outline', color: '#C5221F', ready: true },
  { name: 'Planilha', role: 'Exportar lançamentos', icon: 'mdi-microsoft-excel', color: '#1E7145', ready: true },
  { name: 'API', role: 'n8n e outros sistemas', icon: 'mdi-api', color: '#0E6B53', ready: true },
  { name: 'Sienge', role: 'ERP', icon: 'mdi-domain', color: '#E4572E', ready: false },
  { name: 'TOTVS', role: 'Protheus', icon: 'mdi-server-outline', color: '#1B1F1E', ready: false },
  { name: 'Conta Azul', role: 'Contábil', icon: 'mdi-calculator-variant-outline', color: '#1565C0', ready: false },
  { name: 'Bancos', role: 'Pagamentos', icon: 'mdi-bank-outline', color: '#37474F', ready: false },
  { name: 'Google Drive', role: 'Arquivo de notas', icon: 'mdi-google-drive', color: '#188038', ready: false },
  { name: 'WhatsApp', role: 'Avisos', icon: 'mdi-whatsapp', color: '#128C7E', ready: false },
]
</script>

<template>
  <div class="mb-6">
    <div class="page-title">Integrações</div>
    <div class="page-subtitle">Conecte com os sistemas que você já usa.</div>
  </div>

  <div class="tiles mb-6">
    <v-card v-for="c in catalog" :key="c.name" class="tile pa-4" :class="{ off: !c.ready }">
      <v-icon :color="c.color" size="34">{{ c.icon }}</v-icon>
      <div class="font-weight-bold mt-2">{{ c.name }}</div>
      <div class="text-caption muted">{{ c.role }}</div>
      <v-chip size="small" class="mt-2" :color="c.ready ? 'success' : 'grey'" variant="tonal">{{ c.ready ? 'Disponível' : 'Em breve' }}</v-chip>
    </v-card>
  </div>

  <MailInboxCard base="/api/mail-inbox" class="mb-4" />

  <v-card class="pa-5 mb-4">
    <div class="card-title mb-1">Integração por API (avançado)</div>
    <div class="text-body-2 muted mb-4">
      Para enviar notas a partir de outro sistema ou automatizador (n8n, ERP). Reenvios da mesma nota são ignorados.
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

  <v-alert type="info" variant="tonal" density="comfortable">
    API aberta para novas integrações. Precisa de outra? Fale com o suporte.
  </v-alert>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 12px;
}
.tile {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.tile.off {
  opacity: 0.75;
}
.code {
  background: #0f1f1a;
  color: #d8f3e7;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 0.8rem;
  overflow-x: auto;
}
</style>
