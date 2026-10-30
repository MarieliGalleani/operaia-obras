<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { CATEGORIES, brl, categoryColor, categoryLabel, cnpj, date, type CostCategory } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { useAuth } from '@/stores/auth'

interface Supplier {
  id: string
  cnpj: string
  name: string
  tradeName: string | null
  defaultCategory: CostCategory | null
  status: 'HOMOLOGADO' | 'PENDENTE' | 'BLOQUEADO'
  homologatedAt: string | null
  homologatedBy: string | null
  email: string | null
  phone: string | null
  documentsCount: number
  purchasedTotal: number | string
  lastPurchase: string | null
  avgPaymentTermDays: number | null
  materials: number
  topItem: { description: string; unit: string | null; lastPrice: number; lastDate: string | null; perMeasurement: boolean; variationPct: number | null } | null
}
interface Material {
  key: string
  description: string
  unit: string | null
  purchases: number
  perMeasurement: boolean
  totalQuantity: number
  totalSpent: number
  lastPrice: number
  lastDate: string | null
  avgPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  variationPct: number | null
  bestOther: { supplierId: string; supplierName: string; price: number; date: string | null; savingPct: number } | null
}

const auth = useAuth()
const rows = ref<Supplier[]>([])
const q = ref('')
const category = ref<CostCategory | null>(null)
const loading = ref(false)
const editing = ref<Supplier | null>(null)
const createDialog = ref(false)
const newForm = ref({ cnpj: '', name: '', defaultCategory: null as CostCategory | null, email: '' })
// ------------------------------------------------ preços por material
const UNITS: Record<string, string> = { M3: 'm³', M2: 'm²', M: 'm', KG: 'kg', T: 't', TON: 't', UN: 'un', UND: 'un', PC: 'pç', CX: 'cx', SC: 'saco', H: 'h', L: 'L', MES: 'mês' }
const unitLabel = (u: string | null) => (u ? (UNITS[u.toUpperCase()] ?? u.toLowerCase()) : '')
const price = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const varColor = (v: number | null) => (v == null ? undefined : v >= 15 ? 'error' : v >= 5 ? 'warning' : v <= -5 ? 'success' : undefined)
const varLabel = (v: number | null) => (v == null ? '' : `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const detail = ref<Supplier | null>(null)
const detailData = ref<{ avgPaymentTermDays: number | null; materials: Material[] } | null>(null)
async function openDetail(s: Supplier) {
  detail.value = s
  detailData.value = null
  try {
    detailData.value = await api.get(`/api/suppliers/${s.id}/prices`)
  } catch (e) {
    toastError(e)
  }
}

const situation = ref<'HOMOLOGADO' | 'PENDENTE' | 'BLOQUEADO' | null>(null)
const CATEGORY_ICON: Record<string, string> = {
  MATERIAIS: 'mdi-package-variant-closed',
  MAO_DE_OBRA: 'mdi-account-hard-hat-outline',
  TERCEIRIZADOS: 'mdi-handshake-outline',
  EQUIPAMENTOS: 'mdi-excavator',
  SERVICOS: 'mdi-wrench-outline',
  OUTROS: 'mdi-dots-horizontal-circle-outline',
}
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

const counts = computed(() => ({
  all: rows.value.length,
  HOMOLOGADO: rows.value.filter((r) => r.status === 'HOMOLOGADO').length,
  PENDENTE: rows.value.filter((r) => r.status === 'PENDENTE').length,
  BLOQUEADO: rows.value.filter((r) => r.status === 'BLOQUEADO').length,
}))
const sorted = computed(() =>
  rows.value
    .filter((r) => !situation.value || r.status === situation.value)
    .sort((a, b) => Number(b.purchasedTotal) - Number(a.purchasedTotal)),
)
const homologating = ref<string | null>(null)
async function homologate(s: Supplier) {
  homologating.value = s.id
  try {
    await api.patch(`/api/suppliers/${s.id}`, { status: 'HOMOLOGADO' })
    toast(`${s.tradeName ?? s.name} homologado`)
    load()
  } catch (e) {
    toastError(e)
  } finally {
    homologating.value = null
  }
}

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
      <div class="page-subtitle">Cadastrados automaticamente a partir das notas. Homologue quem é confiável, bloqueie quem não é e defina a categoria padrão.</div>
    </div>
    <v-btn color="primary" prepend-icon="mdi-plus" @click="createDialog = true">Novo fornecedor</v-btn>
  </div>

  <v-card class="pa-4 mb-4">
    <div class="d-flex flex-wrap ga-3 align-center">
      <v-text-field v-model="q" placeholder="Buscar por nome ou CNPJ…" prepend-inner-icon="mdi-magnify" style="max-width: 360px" @keyup.enter="load" />
      <v-chip-group v-model="situation" color="primary" variant="outlined">
        <v-chip :value="null" size="default" filter>Todos · {{ counts.all }}</v-chip>
        <v-chip value="HOMOLOGADO" size="default" filter prepend-icon="mdi-check-decagram">Homologados · {{ counts.HOMOLOGADO }}</v-chip>
        <v-chip value="PENDENTE" size="default" filter>Pendentes · {{ counts.PENDENTE }}</v-chip>
        <v-chip v-if="counts.BLOQUEADO" value="BLOQUEADO" size="default" filter>Bloqueados · {{ counts.BLOQUEADO }}</v-chip>
      </v-chip-group>
      <v-divider vertical class="mx-1 d-none d-md-block" />
      <v-chip-group v-model="category" color="primary" variant="outlined">
        <v-chip :value="null" size="default" filter>Todas categorias</v-chip>
        <v-chip v-for="c in CATEGORIES.slice(0, 5)" :key="c.value" :value="c.value" size="default" filter>{{ c.title }}</v-chip>
      </v-chip-group>
    </div>
  </v-card>

  <v-row dense>
    <v-col v-for="s in sorted" :key="s.id" cols="12" sm="6" lg="3">
      <v-card class="pa-4 h-100 d-flex flex-column supplier-card" role="button" tabindex="0" @click="openDetail(s)" @keydown.enter="openDetail(s)">
        <div class="d-flex justify-space-between align-start ga-3">
          <v-avatar size="44" :color="s.defaultCategory ? undefined : 'grey-lighten-3'" :style="s.defaultCategory ? { background: categoryColor(s.defaultCategory) + '26' } : {}" rounded="lg">
            <v-icon :color="s.defaultCategory ? categoryColor(s.defaultCategory) : 'grey'">{{ CATEGORY_ICON[s.defaultCategory ?? 'OUTROS'] }}</v-icon>
          </v-avatar>
          <div style="min-width: 0" class="flex-grow-1">
            <div class="font-weight-bold text-truncate">{{ s.tradeName ?? s.name }}</div>
            <div class="text-caption muted text-truncate">{{ s.name }}</div>
            <div class="text-caption muted">{{ cnpj(s.cnpj) }}</div>
          </div>
          <v-btn icon="mdi-pencil-outline" size="small" variant="text" aria-label="Editar fornecedor" @click.stop="editing = { ...s }" />
        </div>
        <div class="d-flex ga-1 my-3 flex-wrap">
          <v-tooltip v-if="s.status === 'HOMOLOGADO' && s.homologatedAt" location="top">
            <template #activator="{ props }">
              <v-chip v-bind="props" :color="STATUS[s.status].color" variant="tonal" :prepend-icon="STATUS[s.status].icon">{{ STATUS[s.status].label }}</v-chip>
            </template>
            Homologado em {{ date(s.homologatedAt) }}{{ s.homologatedBy ? ` por ${s.homologatedBy}` : '' }}
          </v-tooltip>
          <v-chip v-else :color="STATUS[s.status].color" variant="tonal" :prepend-icon="STATUS[s.status].icon">{{ STATUS[s.status].label }}</v-chip>
          <v-chip v-if="s.defaultCategory" variant="tonal">{{ categoryLabel(s.defaultCategory) }}</v-chip>
        </div>
        <div v-if="s.topItem" class="price-box mb-3">
          <div class="text-caption muted text-truncate" :title="s.topItem.description">{{ s.topItem.description }}</div>
          <div class="d-flex align-center ga-2">
            <span class="font-weight-bold money">{{ price(s.topItem.lastPrice) }}</span>
            <span class="text-caption muted">{{ s.topItem.perMeasurement ? 'por medição' : `/ ${unitLabel(s.topItem.unit)}` }}</span>
            <v-chip v-if="varColor(s.topItem.variationPct)" size="x-small" variant="tonal" :color="varColor(s.topItem.variationPct)">{{ varLabel(s.topItem.variationPct) }} vs média</v-chip>
          </div>
          <div class="text-caption muted">
            <v-icon size="14">mdi-calendar-clock-outline</v-icon>
            {{ s.avgPaymentTermDays != null ? `Pagamento em ~${s.avgPaymentTermDays} dias` : 'Sem prazo de pagamento' }}
            <span v-if="s.materials > 1"> · {{ s.materials }} materiais</span>
          </div>
        </div>
        <v-spacer />
        <v-btn
          v-if="s.status === 'PENDENTE' && auth.canApprove"
          variant="tonal"
          color="success"
          size="small"
          prepend-icon="mdi-check-decagram"
          class="mb-3 align-self-start"
          :loading="homologating === s.id"
          @click.stop="homologate(s)"
        >
          Homologar
        </v-btn>
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

  <v-dialog :model-value="!!detail" max-width="1080" scrollable @update:model-value="detail = null">
    <v-card v-if="detail">
      <v-card-title class="d-flex align-center ga-3 py-4 px-6">
        <div style="min-width: 0">
          <div class="text-h6 font-weight-bold text-truncate">{{ detail.tradeName ?? detail.name }}</div>
          <div class="text-caption muted">
            {{ cnpj(detail.cnpj) }} · {{ STATUS[detail.status].label }}
            <template v-if="detailData?.avgPaymentTermDays != null"> · pagamento em ~{{ detailData.avgPaymentTermDays }} dias</template>
          </div>
        </div>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="detail = null" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-0">
        <div v-if="!detailData" class="pa-10 d-flex justify-center"><v-progress-circular indeterminate color="primary" /></div>
        <div v-else-if="!detailData.materials.length" class="pa-10 text-center muted">Nenhuma nota aprovada deste fornecedor ainda.</div>
        <v-table v-else density="comfortable" class="prices">
          <thead>
            <tr>
              <th>Material</th>
              <th class="text-right">Compras</th>
              <th class="text-right">Último preço</th>
              <th class="text-right">Média 6 meses</th>
              <th class="text-right">Menor – maior</th>
              <th class="text-right">Variação</th>
              <th>Outro fornecedor mais barato</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in detailData.materials" :key="m.key">
              <td>
                <div class="font-weight-medium">{{ m.description }}</div>
                <div class="text-caption muted">{{ m.perMeasurement ? 'cobrado por medição' : `${m.totalQuantity.toLocaleString('pt-BR')} ${unitLabel(m.unit)} comprados` }} · {{ brl(m.totalSpent, { compact: true }) }}</div>
              </td>
              <td class="text-right">{{ m.purchases }}</td>
              <td class="text-right">
                <div class="font-weight-bold money">{{ price(m.lastPrice) }}<span class="text-caption muted font-weight-regular">{{ m.perMeasurement ? '' : ` /${unitLabel(m.unit)}` }}</span></div>
                <div class="text-caption muted">{{ date(m.lastDate) }}</div>
              </td>
              <td class="text-right money">{{ m.avgPrice != null ? price(m.avgPrice) : '—' }}</td>
              <td class="text-right money text-caption">{{ m.minPrice != null ? `${price(m.minPrice)} – ${price(m.maxPrice!)}` : '—' }}</td>
              <td class="text-right">
                <v-chip v-if="m.variationPct != null" size="small" variant="tonal" :color="varColor(m.variationPct) ?? 'grey'">{{ varLabel(m.variationPct) }}</v-chip>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <template v-if="m.bestOther">
                  <div class="font-weight-medium text-success">{{ m.bestOther.supplierName }} · {{ price(m.bestOther.price) }}</div>
                  <div class="text-caption muted">{{ m.bestOther.savingPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }}% mais barato · {{ date(m.bestOther.date) }}</div>
                </template>
                <span v-else class="muted text-caption">{{ m.perMeasurement ? 'não comparável' : 'é o menor preço' }}</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-divider />
      <div class="pa-4 text-caption muted">
        Preços das notas aprovadas. Variação = último preço contra a média das compras anteriores nos últimos 6 meses.
        Prazo = média entre emissão e vencimento das parcelas. Prazo de entrega chega junto com a tela de Compras.
      </div>
    </v-card>
  </v-dialog>

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

<style scoped>
.supplier-card {
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.supplier-card:hover {
  box-shadow: 0 4px 14px rgba(15, 31, 26, 0.1);
}
.price-box {
  background: rgba(14, 107, 83, 0.05);
  border-radius: 10px;
  padding: 10px 12px;
}
.prices :deep(td) {
  vertical-align: middle;
}
</style>
