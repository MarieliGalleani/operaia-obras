<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import AppLogo from './components/AppLogo.vue'
import { cnpj } from './lib/format'
import { toastState } from './lib/toast'
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
  { title: 'Notas Fiscais', icon: 'mdi-file-document-outline', to: '/notas' },
  { title: 'Contas a Pagar', icon: 'mdi-calendar-check-outline', to: '/contas-a-pagar' },
  { title: 'Fornecedores', icon: 'mdi-truck-outline', to: '/fornecedores' },
  { title: 'Inteligência', icon: 'mdi-creation-outline', to: '/inteligencia' },
  { title: 'Integrações', icon: 'mdi-puzzle-outline', to: '/integracoes', admin: true },
]
const visibleNav = computed(() => nav.filter((n) => !n.admin || auth.me?.user.role === 'ADMIN'))
const isPublic = computed(() => !!route.meta.public)

function doSearch() {
  if (search.value.trim()) router.push({ name: 'documents', query: { q: search.value.trim(), tab: 'todas' } })
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
            <v-list-item prepend-icon="mdi-logout" title="Sair" @click="logout" />
          </v-list>
        </v-menu>
      </v-app-bar>

      <v-main>
        <div class="page-wrap">
          <router-view />
        </div>
      </v-main>
    </template>

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
