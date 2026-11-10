<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import AppLogo from './components/AppLogo.vue'
import { DEMO } from './lib/demo'
import { cnpj } from './lib/format'
import { api } from './lib/api'
import { net, queue, syncNow } from './lib/offline'
import { SCREEN_INFO } from './lib/permissions'
import { toast, toastError, toastState } from './lib/toast'
import { useAuth } from './stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const { mdAndUp } = useDisplay()
const drawer = ref<boolean | null>(null)
const search = ref('')

const ADMIN_NAV = [
  { title: 'Integrações', icon: 'mdi-puzzle-outline', to: '/integracoes' },
  { title: 'Configurações', icon: 'mdi-cog-outline', to: '/configuracoes' },
]
const visibleNav = computed(() => {
  // telas liberadas pelo administrador; integrações e configurações são só do administrador
  const items = [...SCREEN_INFO.filter((s) => auth.can(s.key)), ...(auth.isAdmin ? ADMIN_NAV : [])]
  return auth.isPlatformOwner && !auth.impersonating && !auth.viewingAs
    ? [{ title: 'Plataforma', icon: 'mdi-shield-crown-outline', to: '/plataforma' }, ...items]
    : items
})
const ROLE_TITLE: Record<string, string> = { ADMIN: 'Administrador', FINANCEIRO: 'Financeiro', GESTOR_OBRA: 'Gestor de obra', MESTRE: 'Mestre de obra', PROPRIETARIO: 'Proprietário' }
const exiting = ref(false)
async function exitViewAs() {
  exiting.value = true
  try {
    await auth.exitViewAs()
    router.push('/configuracoes')
  } catch (e) {
    toastError(e)
  } finally {
    exiting.value = false
  }
}

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
/** medição para imprimir: sem menu */
const isPrint = computed(() => !!route.meta.print)
/** dono da obra: portal sem o menu da construtora */
// (na demonstração o administrador também abre o portal, para mostrar o que o proprietário vê)
const isPortal = computed(() => auth.isProprietario || (DEMO && !!route.meta.portal))

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
    <template v-if="isPublic || isPrint">
      <router-view />
    </template>
    <template v-else-if="isPortal">
      <v-app-bar flat height="64" color="transparent" class="appbar">
        <div class="d-flex align-center ml-4 ga-3" style="min-width: 0">
          <router-link to="/proprietario" class="d-flex align-center" style="text-decoration: none; color: inherit" aria-label="Minhas obras"><AppLogo /></router-link>
          <v-divider vertical class="my-4" />
          <div style="min-width: 0">
            <div class="text-caption muted" style="line-height: 1.1">Portal do proprietário</div>
            <div class="font-weight-bold text-truncate" style="line-height: 1.2">{{ auth.me?.company.name }}</div>
          </div>
        </div>
        <v-spacer />
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" class="mr-2 px-2" aria-label="Minha conta">
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
        <div v-if="auth.viewingAs" class="support-bar view-as-bar">
          <v-icon size="18" class="mr-2">mdi-eye-outline</v-icon>
          <span>Você está vendo o portal como <strong>{{ auth.me?.user.name }}</strong> (proprietário), só leitura.</span>
          <v-spacer />
          <v-btn size="small" variant="flat" color="white" class="text-secondary" :loading="exiting" prepend-icon="mdi-arrow-left" @click="exitViewAs">Voltar ao meu acesso</v-btn>
        </div>
        <div v-if="DEMO" class="demo-bar">
          <v-icon size="16" class="mr-1">mdi-eye-outline</v-icon>
          Demonstração: o que o proprietário de uma obra por administração vê. Dados fictícios.
          <router-link to="/obras" class="ml-2" style="color: inherit">Voltar à construtora</router-link>
        </div>
        <div class="page-wrap portal-wrap">
          <router-view />
        </div>
      </v-main>
    </template>
    <template v-else>
      <v-navigation-drawer v-model="drawer" color="transparent" width="236" :permanent="mdAndUp" class="sidebar" border="0">
        <div class="pa-5 pb-4"><AppLogo /></div>
        <v-list nav density="comfortable" class="px-3">
          <v-list-item
            v-for="item in visibleNav"
            :key="item.to"
            :to="item.to"
            :exact="item.to === '/'"
            :prepend-icon="item.icon"
            :title="item.title"
            rounded="pill"
            class="nav-item mb-1"
            active-class="nav-active"
          />
        </v-list>
        <template #append>
          <div class="pa-4 text-caption sidebar-foot">OperaIA Obras · MVP 0.1</div>
        </template>
      </v-navigation-drawer>

      <v-app-bar flat height="64" color="transparent" class="appbar">
        <v-app-bar-nav-icon v-if="!mdAndUp" @click="drawer = !drawer" />
        <div class="d-flex align-center ml-4" style="min-width: 0">
          <v-icon v-if="mdAndUp" color="primary" class="mr-2">mdi-domain</v-icon>
          <div style="min-width: 0">
            <div class="font-weight-bold text-truncate" style="line-height: 1.1">{{ auth.me?.company.name }}</div>
            <div v-if="mdAndUp" class="text-caption muted" style="line-height: 1.1">{{ cnpj(auth.me?.company.cnpj) }}</div>
          </div>
        </div>
        <v-spacer />
        <v-chip v-if="!net.online" color="warning" variant="flat" size="small" class="mr-2 flex-shrink-0" :aria-label="'Sem internet'">
          <v-icon size="16" :class="{ 'mr-1': mdAndUp }">mdi-wifi-off</v-icon><template v-if="mdAndUp">Sem internet</template>
        </v-chip>
        <v-chip
          v-if="queue.items.length"
          :color="queue.items.some((i) => i.status === 'ERRO') ? 'error' : 'info'"
          variant="tonal"
          size="small"
          class="mr-2 flex-shrink-0"
          :aria-label="`${queue.items.length} registro(s) guardado(s) no celular`"
          @click="syncNow()"
        >
          <v-icon size="16" class="mr-1">{{ queue.syncing ? 'mdi-sync' : 'mdi-cloud-upload-outline' }}</v-icon>{{ queue.items.length }}<template v-if="mdAndUp">&nbsp;na fila</template>
        </v-chip>
        <v-text-field
          v-if="mdAndUp && auth.can('notas')"
          v-model="search"
          placeholder="Buscar nota, fornecedor, número…"
          prepend-inner-icon="mdi-magnify"
          style="max-width: 360px"
          class="mr-4"
          bg-color="#F7F9F8"
          @keyup.enter="doSearch"
        />
        <v-btn v-if="auth.can('inteligencia')" icon variant="text" to="/inteligencia" aria-label="Alertas"><v-icon>mdi-bell-outline</v-icon></v-btn>
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
        <div v-if="auth.viewingAs" class="support-bar view-as-bar">
          <v-icon size="18" class="mr-2">mdi-eye-outline</v-icon>
          <span>
            Você está vendo o sistema como <strong>{{ auth.me?.user.name }}</strong> ({{ ROLE_TITLE[auth.me?.user.role ?? ''] }}), só leitura. Nada do que fizer aqui é gravado.
          </span>
          <v-spacer />
          <v-btn size="small" variant="flat" color="white" class="text-secondary" :loading="exiting" prepend-icon="mdi-arrow-left" @click="exitViewAs">Voltar ao meu acesso</v-btn>
        </div>
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
.view-as-bar {
  background: #6b4bd6 !important;
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
  background: rgba(247, 248, 248, 0.6) !important;
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-bottom: 0 !important;
}
/* barra lateral de vidro: o item ativo é uma pílula preta */
.sidebar {
  background: rgba(255, 255, 255, 0.5) !important;
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-right: 1px solid rgba(255, 255, 255, 0.9) !important;
}
.sidebar .nav-item {
  color: #46544f !important;
  font-weight: 500;
  margin-bottom: 3px;
  min-height: 42px;
}
.sidebar .nav-item .v-list-item-title {
  font-size: 0.97rem !important;
  font-weight: 500;
}
.sidebar .nav-item:hover {
  background: rgba(255, 255, 255, 0.8);
}
.sidebar .nav-active {
  background: var(--oo-ink) !important;
  color: #fff !important;
  box-shadow: 0 10px 22px -12px rgba(17, 25, 23, 0.6);
}
.sidebar .nav-active .v-icon {
  color: #fff !important;
  opacity: 1;
}
.sidebar .nav-active .v-list-item__overlay {
  opacity: 0 !important;
}
.sidebar-foot {
  color: var(--oo-faint);
}
</style>
