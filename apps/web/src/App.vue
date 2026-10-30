<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import AppLogo from './components/AppLogo.vue'
import { DEMO } from './lib/demo'
import { cnpj } from './lib/format'
import { api } from './lib/api'
import { toast, toastError, toastState } from './lib/toast'
import { useAuth } from './stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const { mdAndUp } = useDisplay()
const drawer = ref<boolean | null>(null)
const search = ref('')

const nav = [
  { title: 'Visão Geral', icon: 'mdi-home-outline', to: '/' },
  { title: 'Obras', icon: 'mdi-office-building-outline', to: '/obras' },
  { title: 'Orçamentos', icon: 'mdi-calculator-variant-outline', to: '/orcamentos' },
  { title: 'Fornecedores', icon: 'mdi-truck-outline', to: '/fornecedores' },
  { title: 'Notas Fiscais', icon: 'mdi-file-document-outline', to: '/notas' },
  { title: 'Contas a Pagar', icon: 'mdi-calendar-check-outline', to: '/contas-a-pagar' },
  { title: 'Inteligência', icon: 'mdi-creation-outline', to: '/inteligencia' },
  { title: 'Integrações', icon: 'mdi-puzzle-outline', to: '/integracoes', admin: true },
  { title: 'Configurações', icon: 'mdi-cog-outline', to: '/configuracoes', admin: true },
]
const visibleNav = computed(() => {
  const items = nav.filter((n) => !n.admin || auth.me?.user.role === 'ADMIN')
  return auth.isPlatformOwner && !auth.impersonating
    ? [{ title: 'Plataforma', icon: 'mdi-shield-crown-outline', to: '/plataforma' }, ...items]
    : items
})

const leaving = ref(false)
async function backToPlatform() {
  leaving.value = true
  try {
    await auth.returnToPlatform()
    router.push('/plataforma')
  } catch (e) {
    toastError(e)
  } finally {
    leaving.value = false
  }
}
const isPublic = computed(() => !!route.meta.public)

function doSearch() {
  if (search.value.trim()) router.push({ name: 'documents', query: { q: search.value.trim(), tab: 'todas' } })
}
const pwDialog = ref(false)
const pw = ref({ current: '', next: '', confirm: '' })
const pwSaving = ref(false)
async function changePassword() {
  pwSaving.value = true
  try {
    await api.post('/api/auth/password', { current: pw.value.current, next: pw.value.next })
    pwDialog.value = false
    pw.value = { current: '', next: '', confirm: '' }
    toast('Senha alterada')
  } catch (e) {
    toastError(e)
  } finally {
    pwSaving.value = false
  }
}

function logout() {
  auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <v-app>
    <template v-if="isPublic">
      <router-view />
    </template>
    <template v-else>
      <v-navigation-drawer v-model="drawer" color="secondary" width="232" :permanent="mdAndUp" class="sidebar">
        <div class="pa-5 pb-4"><AppLogo light /></div>
        <v-list nav density="comfortable" class="px-3">
          <v-list-item
            v-for="item in visibleNav"
            :key="item.to"
            :to="item.to"
            :exact="item.to === '/'"
            :prepend-icon="item.icon"
            :title="item.title"
            rounded="lg"
            class="nav-item mb-1"
            active-class="nav-active"
          />
        </v-list>
        <template #append>
          <div class="pa-4 text-caption sidebar-foot">OperaIA Obras · MVP 0.1</div>
        </template>
      </v-navigation-drawer>

      <v-app-bar flat height="64" color="surface" class="appbar">
        <v-app-bar-nav-icon v-if="!mdAndUp" @click="drawer = !drawer" />
        <div class="d-flex align-center ml-4">
          <v-icon color="primary" class="mr-2">mdi-domain</v-icon>
          <div>
            <div class="font-weight-bold" style="line-height: 1.1">{{ auth.me?.company.name }}</div>
            <div class="text-caption muted" style="line-height: 1.1">{{ cnpj(auth.me?.company.cnpj) }}</div>
          </div>
        </div>
        <v-spacer />
        <v-text-field
          v-if="mdAndUp"
          v-model="search"
          placeholder="Buscar nota, fornecedor, número…"
          prepend-inner-icon="mdi-magnify"
          style="max-width: 360px"
          class="mr-4"
          bg-color="#F7F9F8"
          @keyup.enter="doSearch"
        />
        <v-btn icon variant="text" to="/inteligencia" aria-label="Alertas"><v-icon>mdi-bell-outline</v-icon></v-btn>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" class="mr-2 px-2">
              <v-avatar color="primary" size="34" class="text-caption font-weight-bold">{{ auth.initials }}</v-avatar>
              <v-icon size="18" class="ml-1">mdi-chevron-down</v-icon>
            </v-btn>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item :title="auth.me?.user.name" :subtitle="auth.me?.user.email" />
            <v-divider />
            <v-list-item v-if="!DEMO" prepend-icon="mdi-lock-reset" title="Trocar senha" @click="pwDialog = true" />
            <v-list-item v-if="!DEMO" prepend-icon="mdi-logout" title="Sair" @click="logout" />
          </v-list>
        </v-menu>
      </v-app-bar>

      <v-main>
        <div v-if="auth.impersonating" class="support-bar">
          <v-icon size="18" class="mr-2">mdi-lifebuoy</v-icon>
          <span>Você está dentro de <strong>{{ auth.me?.company.name }}</strong> como suporte. Tudo o que fizer fica registrado na auditoria dela.</span>
          <v-spacer />
          <v-btn size="small" variant="flat" color="white" class="text-secondary" :loading="leaving" @click="backToPlatform">Voltar à plataforma</v-btn>
        </div>
        <div v-if="DEMO" class="demo-bar">
          <v-icon size="16" class="mr-1">mdi-eye-outline</v-icon>
          Demonstração com dados fictícios da Construtora Alpha. Navegue à vontade; ações que gravam (aprovar, pagar, enviar) ficam desativadas.
        </div>
        <div class="page-wrap">
          <router-view />
        </div>
      </v-main>
    </template>

    <v-dialog v-model="pwDialog" max-width="420">
      <v-card class="pa-5">
        <div class="card-title mb-4">Trocar senha</div>
        <v-form @submit.prevent="changePassword">
          <v-text-field id="pw-current" v-model="pw.current" type="password" label="Senha atual" autocomplete="current-password" class="mb-3" />
          <v-text-field id="pw-next" v-model="pw.next" type="password" label="Nova senha (mín. 10 caracteres)" autocomplete="new-password" class="mb-3" />
          <v-text-field
            id="pw-confirm"
            v-model="pw.confirm"
            type="password"
            label="Repita a nova senha"
            autocomplete="new-password"
            :error-messages="pw.confirm && pw.confirm !== pw.next ? 'As senhas não conferem' : undefined"
          />
          <div class="d-flex justify-end ga-2 mt-5">
            <v-btn variant="text" @click="pwDialog = false">Cancelar</v-btn>
            <v-btn type="submit" color="primary" :loading="pwSaving" :disabled="!pw.current || pw.next.length < 10 || pw.next !== pw.confirm">Salvar</v-btn>
          </div>
        </v-form>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toastState.show" :color="toastState.color" timeout="4000" location="bottom right">
      {{ toastState.text }}
    </v-snackbar>
  </v-app>
</template>

<style>
.page-wrap {
  padding: 24px 28px 40px;
  max-width: 1480px;
}
@media (max-width: 600px) {
  .page-wrap {
    padding: 16px;
  }
}
.support-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #2d5b9a;
  color: #fff;
  font-size: 0.85rem;
  padding: 8px 28px;
}
.demo-bar {
  background: #fff4e0;
  color: #7a4b00;
  font-size: 0.82rem;
  padding: 8px 28px;
  border-bottom: 1px solid #f3dcb0;
}
.appbar {
  border-bottom: 1px solid var(--oo-border) !important;
}
.sidebar .nav-item {
  color: rgba(255, 255, 255, 0.82) !important;
  font-weight: 500;
}
.sidebar .nav-item .v-list-item-title {
  font-size: 0.9rem !important;
  font-weight: 500;
}
.sidebar .nav-active {
  background: var(--oo-sidebar-active) !important;
  color: #fff !important;
}
.sidebar .nav-active .v-icon {
  color: #2bc48a !important;
}
.sidebar-foot {
  color: rgba(255, 255, 255, 0.4);
}
</style>
