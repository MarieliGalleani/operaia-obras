<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import BuildingArt from '@/components/BuildingArt.vue'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const email = ref(import.meta.env.DEV ? 'admin@alpha.com.br' : '')
const password = ref(import.meta.env.DEV ? 'operaia123' : '')
const loading = ref(false)
const error = ref('')
const showPass = ref(false)
const BARS = [22, 30, 26, 38, 34, 46, 70, 58, 84, 66, 76, 92, 62, 50, 40, 46, 32, 38, 26, 30]
const HOT_FROM = 6
const HOT_TO = 12
const NAV = ['Notas', 'Obras', 'Compras', 'Medição']

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
    <header class="top">
      <AppLogo />
      <nav class="pills" aria-hidden="true">
        <span v-for="n in NAV" :key="n" class="pill" :class="{ on: n === 'Obras' }"><v-icon v-if="n === 'Obras'" size="15">mdi-chart-timeline-variant</v-icon>{{ n }}</span>
      </nav>
      <div class="top-right">
        <span class="round"><v-icon size="17">mdi-shield-check-outline</v-icon></span>
        <span class="round"><v-icon size="17">mdi-help</v-icon></span>
      </div>
    </header>

    <main class="stage">
      <section class="show" aria-hidden="true">
        <div class="rail">
          <span class="round"><v-icon size="16">mdi-layers-outline</v-icon></span>
          <span class="round on"><v-icon size="16">mdi-home-city-outline</v-icon></span>
          <span class="round"><v-icon size="16">mdi-file-document-outline</v-icon></span>
          <span class="round"><v-icon size="16">mdi-cart-outline</v-icon></span>
          <span class="round"><v-icon size="16">mdi-cog-outline</v-icon></span>
        </div>

        <div class="headline">
          <h1>Toda despesa <br />na obra certa.</h1>
          <p class="lede">Da nota fiscal ao custo de cada obra: notas, compras, contas e avanço em um só lugar.</p>
        </div>

        <div class="scene">
          <BuildingArt class="building" />

          <div class="glass g-obra">
            <div class="g-row"><b>Residencial Aurora</b><span class="g-corner"><v-icon size="13">mdi-arrow-top-right</v-icon></span></div>
            <div class="g-sub">dia 160 de 270</div>
            <div class="g-row" style="margin-top: 14px">
              <div class="g-big">69%</div>
              <div class="avatars"><i style="background: #f0871a">ZC</i><i style="background: #2e7df6">MA</i><i style="background: #0d9b6c">JS</i><i class="more">+3</i></div>
            </div>
          </div>
        </div>

        <div class="glass-white g-note">
          <span class="note-ic"><v-icon size="16">mdi-check</v-icon></span>
          <div>
            <div class="note-t">Nota aprovada</div>
            <div class="note-s">Concremax · R$ 10.080,00</div>
          </div>
        </div>

        <div class="glass-white g-bars">
          <div class="g-row"><span class="g-title">Gasto do orçamento</span><span class="g-corner light"><v-icon size="13">mdi-arrow-top-right</v-icon></span></div>
          <div class="g-num">77%<small><v-icon size="12">mdi-menu-down</v-icon>2,4%</small></div>
          <div class="bars">
            <span v-for="(h, i) in BARS" :key="i" :class="{ hot: i >= HOT_FROM && i <= HOT_TO }" :style="{ height: h + '%' }" />
          </div>
        </div>
      </section>

      <section class="form-side">
        <div class="form-card">
          <div class="f-title">Entrar</div>
          <div class="f-sub">Acesse o painel da sua construtora.</div>
          <v-form @submit.prevent="submit">
            <label class="f-label" for="login-email">E-mail</label>
            <v-text-field id="login-email" v-model="email" type="email" autocomplete="username" placeholder="voce@construtora.com.br" prepend-inner-icon="mdi-email-outline" density="comfortable" class="mb-4" />
            <label class="f-label" for="login-pass">Senha</label>
            <v-text-field
              id="login-pass"
              v-model="password"
              :type="showPass ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="Sua senha"
              prepend-inner-icon="mdi-lock-outline"
              :append-inner-icon="showPass ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
              density="comfortable"
              class="mb-4"
              @click:append-inner="showPass = !showPass"
            />
            <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
            <v-btn type="submit" color="#111917" variant="flat" block size="large" :loading="loading" append-icon="mdi-arrow-right" class="enter">Entrar</v-btn>
          </v-form>
          <div class="f-foot">Esqueceu a senha? Peça uma nova ao administrador da sua construtora.</div>
        </div>
        <div class="copy">© OperaIA Obras</div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Urbanist Variable', 'Urbanist', system-ui, sans-serif;
  background:
    radial-gradient(760px 460px at 8% 4%, #fbf3df 0%, transparent 62%),
    radial-gradient(900px 600px at 96% 10%, #e8eef6 0%, transparent 60%),
    radial-gradient(700px 480px at 40% 100%, #f1f3f4 0%, transparent 60%),
    #f7f8f8;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px clamp(20px, 4vw, 44px) 0;
}
.pills {
  display: flex;
  gap: 2px;
  padding: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 10px 30px -18px rgba(16, 32, 28, 0.25);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #2c3936;
}
.pill.on {
  background: #111917;
  color: #fff;
}
.top-right {
  display: flex;
  gap: 8px;
}
.round {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 20px -12px rgba(16, 32, 28, 0.3);
  color: #46544f;
}
.round.on {
  background: #111917;
  border-color: #111917;
  color: #fff;
}
.stage {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(330px, 410px);
  gap: clamp(16px, 3vw, 40px);
  align-items: center;
  padding: 8px clamp(20px, 4vw, 44px) 28px;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}

/* ---- apresentação */
.show {
  position: relative;
  min-width: 0;
  min-height: 640px;
}
.rail {
  position: absolute;
  left: 0;
  top: 46%;
  display: grid;
  gap: 10px;
  z-index: 2;
}
.headline {
  position: absolute;
  left: 64px;
  top: 34px;
  z-index: 2;
}
.headline h1 {
  font-size: clamp(2.2rem, 3.6vw, 3.1rem);
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1.02;
  color: #111917;
}
.lede {
  margin-top: 12px;
  max-width: 26ch;
  color: #5d6b67;
  font-size: 0.875rem;
  line-height: 1.45;
}
.scene {
  position: absolute;
  left: 22%;
  right: -3%;
  top: 0;
}
.building {
  display: block;
  width: 100%;
  height: auto;
  max-height: 640px;
}

/* vidro: pouco preenchimento, desfoque forte, fio de luz na borda */
.glass,
.glass-white {
  border-radius: 20px;
  backdrop-filter: blur(18px) saturate(1.5);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
}
.glass {
  position: absolute;
  background: linear-gradient(135deg, rgba(52, 58, 56, 0.56), rgba(52, 58, 56, 0.36));
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.24);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 20px 44px -18px rgba(16, 24, 22, 0.55);
}
.glass-white {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.3));
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 20px 44px -22px rgba(16, 32, 28, 0.3);
}
.g-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.g-obra {
  left: 31%;
  top: 43%;
  padding: 14px 16px 16px;
  animation: float 7s ease-in-out infinite alternate;
  min-width: 214px;
}
.g-obra b {
  font-size: 1rem;
  font-weight: 500;
}
.g-corner {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  flex: none;
}
.g-corner.light {
  background: rgba(255, 255, 255, 0.85);
  color: #46544f;
  box-shadow: 0 6px 14px -8px rgba(16, 32, 28, 0.4);
}
.g-sub {
  font-size: 0.72rem;
  opacity: 0.7;
}
.g-big {
  font-size: 1.9rem;
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1;
}
.avatars {
  display: flex;
}
.avatars i {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-left: -7px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  font-style: normal;
  font-size: 0.6rem;
  font-weight: 600;
  color: #fff;
}
.avatars .more {
  background: rgba(255, 255, 255, 0.22);
}

.g-bars {
  position: absolute;
  right: 1%;
  bottom: 5%;
  width: 214px;
  padding: 14px 16px 14px;
  z-index: 2;
  animation: float 8s ease-in-out -3s infinite alternate;
}
.g-note {
  position: absolute;
  left: 60px;
  bottom: 9%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 16px 11px 11px;
  border-radius: 999px;
  z-index: 2;
  animation: float 6.5s ease-in-out -1.5s infinite alternate;
}
.note-ic {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--oo-primary);
  color: #fff;
  flex: none;
}
.note-t {
  font-size: 0.875rem;
  font-weight: 600;
  color: #111917;
  line-height: 1.15;
}
.note-s {
  font-size: 0.75rem;
  color: #5d6b67;
}
@keyframes float {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-7px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .g-obra,
  .g-bars,
  .g-note {
    animation: none;
  }
}
.g-title {
  font-size: 0.8125rem;
  color: #46544f;
}
.g-num {
  font-size: 1.9rem;
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: #111917;
}
.g-num small {
  font-size: 0.75rem;
  margin-left: 6px;
  color: #46544f;
  letter-spacing: 0;
}
.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 46px;
  margin-top: 10px;
}
.bars span {
  position: relative;
  flex: 1;
  border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, rgba(60, 72, 68, 0.2), rgba(60, 72, 68, 0.04));
}
.bars span.hot {
  background: linear-gradient(180deg, #f0871a, rgba(240, 135, 26, 0.28));
}
/* ---- formulário */
.form-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.form-card {
  width: 100%;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.46));
  backdrop-filter: blur(22px) saturate(1.5);
  -webkit-backdrop-filter: blur(22px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 28px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 24px 50px -24px rgba(16, 32, 28, 0.3);
  padding: clamp(24px, 3vw, 34px);
}
.f-title {
  font-size: 1.9rem;
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: #111917;
}
.f-sub {
  color: #5d6b67;
  margin: 4px 0 22px;
}
.f-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  margin-bottom: 6px;
}
.form-card :deep(.v-field) {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
}
.form-card :deep(input) {
  font-family: 'Urbanist Variable', 'Urbanist', sans-serif;
}
.enter {
  color: #fff !important;
  box-shadow: 0 12px 24px -12px rgba(17, 25, 23, 0.6) !important;
  font-family: 'Urbanist Variable', 'Urbanist', sans-serif;
  font-size: 1rem;
}
.f-foot {
  margin-top: 16px;
  font-size: 0.8125rem;
  color: #5d6b67;
  text-align: center;
  line-height: 1.45;
}
.copy {
  font-size: 0.75rem;
  color: var(--oo-faint);
}

@media (max-width: 1000px) {
  .pills {
    display: none;
  }
  .stage {
    grid-template-columns: 1fr;
    align-items: start;
    align-content: start;
    gap: 18px;
  }
  .show {
    min-height: 0;
  }
  .scene,
  .rail,
  .g-bars,
  .g-note,
  .lede {
    display: none;
  }
  .headline {
    position: static;
  }
  .headline h1 {
    font-size: 2.1rem;
    margin-top: 10px;
  }
  .headline h1 br {
    display: none;
  }
}
</style>
