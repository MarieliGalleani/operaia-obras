<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { CATEGORIES, brl, categoryLabel, cnpj, date, type CostCategory } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface Supplier {
  id: string
  cnpj: string
  name: string
  tradeName: string | null
  defaultCategory: CostCategory | null
  status: 'HOMOLOGADO' | 'PENDENTE' | 'BLOQUEADO'
  email: string | null
  phone: string | null
  documentsCount: number
  purchasedTotal: number | string
  lastPurchase: string | null
}

const auth = useAuth()
const rows = ref<Supplier[]>([])
const q = ref('')
const category = ref<CostCategory | null>(null)
const loading = ref(false)
const editing = ref<Supplier | null>(null)
const createDialog = ref(false)
const newForm = ref({ cnpj: '', name: '', defaultCategory: null as CostCategory | null, email: '' })
const STATUS = {
  HOMOLOGADO: { color: 'success', icon: 'mdi-check-decagram', label: 'Homologado' },
  PENDENTE: { color: 'warning', icon: 'mdi-clock-outline', label: 'Pendente' },
  BLOQUEADO: { color: 'error', icon: 'mdi-cancel', label: 'Bloqueado' },
}

async function load() {
  loading.value = true
  try {
    const p = new URLSearchParams()
    if (q.value) p.set('q', q.value)
    if (category.value) p.set('category', category.value)
    rows.value = await api.get<Supplier[]>(`/api/suppliers?${p}`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(category, load)

const sorted = computed(() => [...rows.value].sort((a, b) => Number(b.purchasedTotal) - Number(a.purchasedTotal)))

async function saveEdit() {
  if (!editing.value) return
  try {
    const e = editing.value
    await api.patch(`/api/suppliers/${e.id}`, { status: e.status, defaultCategory: e.defaultCategory, email: e.email || null, phone: e.phone || null, tradeName: e.tradeName || null })
    toast('Fornecedor atualizado')
    editing.value = null
    load()
  } catch (e) {
    toastError(e)
  }
}
async function create() {
  try {
    await api.post('/api/suppliers', { ...newForm.value, email: newForm.value.email || null })
    toast('Fornecedor cadastrado')
    createDialog.value = false
    newForm.value = { cnpj: '', name: '', defaultCategory: null, email: '' }
    load()
  } catch (e) {
    toastError(e)
  }
}
</script>

<template>
  <div class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
    <div>
      <div class="page-title">Fornecedores</div>
      <div class="page-subtitle">Cadastrados automaticamente a partir das notas. Homologue, bloqueie e defina a categoria padrão.</div>
    </div>
    <v-btn color="primary" prepend-icon="mdi-plus" @click="createDialog = true">Novo fornecedor</v-btn>
  </div>

  <v-card class="pa-4 mb-4">
    <div class="d-flex flex-wrap ga-3 align-center">
      <v-text-field v-model="q" placeholder="Buscar por nome ou CNPJ…" prepend-inner-icon="mdi-magnify" style="max-width: 360px" @keyup.enter="load" />
      <v-chip-group v-model="category" color="primary" variant="outlined">
        <v-chip :value="null" size="default" filter>Todos</v-chip>
        <v-chip v-for="c in CATEGORIES.slice(0, 5)" :key="c.value" :value="c.value" size="default" filter>{{ c.title }}</v-chip>
      </v-chip-group>
    </div>
  </v-card>

  <v-row dense>
    <v-col v-for="s in sorted" :key="s.id" cols="12" sm="6" lg="3">
      <v-card class="pa-4 h-100 d-flex flex-column">
        <div class="d-flex justify-space-between align-start">
          <div style="min-width: 0">
            <div class="font-weight-bold text-truncate">{{ s.tradeName ?? s.name }}</div>
            <div class="text-caption muted text-truncate">{{ s.name }}</div>
            <div class="text-caption muted">{{ cnpj(s.cnpj) }}</div>
          </div>
          <v-btn icon="mdi-pencil-outline" size="small" variant="text" @click="editing = { ...s }" />
        </div>
        <div class="d-flex ga-1 my-3 flex-wrap">
          <v-chip :color="STATUS[s.status].color" variant="tonal" :prepend-icon="STATUS[s.status].icon">{{ STATUS[s.status].label }}</v-chip>
          <v-chip v-if="s.defaultCategory" variant="tonal">{{ categoryLabel(s.defaultCategory) }}</v-chip>
        </div>
        <v-spacer />
        <div class="d-flex justify-space-between align-end">
          <div>
            <div class="text-caption muted">Comprado (aprovado)</div>
            <div class="font-weight-bold money">{{ brl(Number(s.purchasedTotal), { compact: true }) }}</div>
          </div>
          <div class="text-right text-caption muted">
            {{ s.documentsCount }} nota(s)<br />
            última {{ date(s.lastPurchase) }}
          </div>
        </div>
      </v-card>
    </v-col>
    <v-col v-if="!loading && !sorted.length" cols="12"><v-card class="pa-8 text-center muted">Nenhum fornecedor encontrado.</v-card></v-col>
  </v-row>

  <v-dialog :model-value="!!editing" max-width="480" @update:model-value="editing = null">
    <v-card v-if="editing" class="pa-5">
      <div class="card-title mb-1">{{ editing.name }}</div>
      <div class="text-caption muted mb-4">{{ cnpj(editing.cnpj) }}</div>
      <v-select v-model="editing.status" :items="[{ title: 'Homologado', value: 'HOMOLOGADO' }, { title: 'Pendente', value: 'PENDENTE' }, { title: 'Bloqueado', value: 'BLOQUEADO' }]" label="Situação" class="mb-3" :disabled="!auth.canApprove" />
      <v-select v-model="editing.defaultCategory" :items="CATEGORIES" label="Categoria padrão" clearable class="mb-3" hint="Usada para classificar as próximas notas deste fornecedor" persistent-hint />
      <v-text-field v-model="editing.tradeName" label="Nome fantasia" class="mb-3" />
      <v-text-field v-model="editing.email" label="E-mail" class="mb-3" />
      <v-text-field v-model="editing.phone" label="Telefone" />
      <div class="d-flex justify-end ga-2 mt-5">
        <v-btn variant="text" @click="editing = null">Cancelar</v-btn>
        <v-btn color="primary" @click="saveEdit">Salvar</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <v-dialog v-model="createDialog" max-width="480">
    <v-card class="pa-5">
      <div class="card-title mb-4">Novo fornecedor</div>
      <v-text-field v-model="newForm.cnpj" label="CNPJ" class="mb-3" />
      <v-text-field v-model="newForm.name" label="Razão social" class="mb-3" />
      <v-select v-model="newForm.defaultCategory" :items="CATEGORIES" label="Categoria padrão" clearable class="mb-3" />
      <v-text-field v-model="newForm.email" label="E-mail" />
      <div class="d-flex justify-end ga-2 mt-5">
        <v-btn variant="text" @click="createDialog = false">Cancelar</v-btn>
        <v-btn color="primary" :disabled="!newForm.cnpj || !newForm.name" @click="create">Cadastrar</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
