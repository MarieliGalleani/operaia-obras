<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const email = ref(import.meta.env.DEV ? 'admin@alpha.com.br' : '')
const password = ref(import.meta.env.DEV ? 'operaia123' : '')
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await auth.login(email.value.trim(), password.value)
    router.replace((route.query.next as string) || '/')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="side">
      <AppLogo light />
      <div>
        <h1>Toda despesa na obra certa.</h1>
        <p>Da nota fiscal à margem da obra: documentos, custos, contas a pagar e alertas em um só lugar.</p>
      </div>
      <div class="text-caption" style="opacity: 0.5">© OperaIA</div>
    </div>
    <div class="form-wrap">
      <v-card class="pa-8" max-width="400" width="100%">
        <div class="text-h6 font-weight-bold mb-1">Entrar</div>
        <div class="muted text-body-2 mb-6">Acesse o painel da sua construtora.</div>
        <v-form @submit.prevent="submit">
          <v-text-field v-model="email" label="E-mail" type="email" autocomplete="username" class="mb-4" />
          <v-text-field v-model="password" label="Senha" type="password" autocomplete="current-password" class="mb-4" />
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
          <v-btn type="submit" color="primary" block size="large" :loading="loading">Entrar</v-btn>
        </v-form>
      </v-card>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(320px, 520px) 1fr;
  min-height: 100vh;
  background: var(--oo-bg);
}
.side {
  background: var(--oo-sidebar);
  color: #fff;
  padding: 40px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.side h1 {
  font-size: 2rem;
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}
.side p {
  opacity: 0.75;
  max-width: 380px;
}
.form-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
@media (max-width: 800px) {
  .login {
    grid-template-columns: 1fr;
  }
  .side {
    gap: 24px;
  }
}
</style>
