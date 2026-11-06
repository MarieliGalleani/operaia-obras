<script setup lang="ts">
/** Portal do proprietário: obras liberadas. Com uma obra só, abre direto nela. */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ProjectThumb from '@/components/ProjectThumb.vue'
import { api } from '@/lib/api'
import { brl } from '@/lib/format'
import { contractLabel, monthName, type Contract } from '@/lib/measurement'
import { toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface OwnerProject {
  id: string
  code: string
  name: string
  address: string | null
  imageUrl: string | null
  budgetTotal: number
  costToDate: number
  contract: Contract
  measurement: { month: string; expected: number; realizedWithFee: number }
}
const router = useRouter()
const auth = useAuth()
const items = ref<OwnerProject[] | null>(null)

onMounted(async () => {
  try {
    items.value = await api.get<OwnerProject[]>('/api/owner/projects')
    if (items.value.length === 1) router.replace({ name: 'owner-project', params: { id: items.value[0].id } })
  } catch (e) {
    toastError(e)
  }
})
</script>

<template>
  <div class="mb-6">
    <div class="page-title">Olá, {{ auth.me?.user.name.split(' ')[0] }}</div>
    <div class="page-subtitle">Acompanhe o que está sendo comprado e quanto vem na próxima medição.</div>
  </div>
  <v-row v-if="items">
    <v-col v-for="p in items" :key="p.id" cols="12" md="6">
      <v-card class="pa-0 overflow-hidden" :to="{ name: 'owner-project', params: { id: p.id } }">
        <div class="d-flex">
          <ProjectThumb :image-url="p.imageUrl" :name="p.name" :size="140" />
          <div class="pa-4 flex-grow-1" style="min-width: 0">
            <div class="text-caption muted">{{ p.code }} · {{ contractLabel(p.contract) }}</div>
            <div class="text-subtitle-1 font-weight-bold text-truncate">{{ p.name }}</div>
            <div class="text-body-2 muted text-truncate">{{ p.address ?? '' }}</div>
            <div class="d-flex ga-6 mt-3 flex-wrap">
              <div>
                <div class="text-caption muted">Custo até hoje</div>
                <div class="font-weight-bold money">{{ brl(p.costToDate) }}</div>
              </div>
              <div>
                <div class="text-caption muted">Medição de {{ monthName(p.measurement.month).split(' ')[0].toLowerCase() }}</div>
                <div class="font-weight-bold money text-primary">{{ brl(p.measurement.expected) }}</div>
              </div>
            </div>
          </div>
        </div>
      </v-card>
    </v-col>
    <v-col v-if="!items.length" cols="12">
      <v-card class="pa-8 text-center muted">Nenhuma obra liberada para você ainda. Fale com a construtora.</v-card>
    </v-col>
  </v-row>
</template>
