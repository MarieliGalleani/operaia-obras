<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import GaugeArc from '@/components/GaugeArc.vue'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const email = ref(import.meta.env.DEV ? 'admin@alpha.com.br' : '')
const password = ref(import.meta.env.DEV ? 'operaia123' : '')
const loading = ref(false)
const error = ref('')
const showPass = ref(false)
// barras do desenho de apresentação (decorativo)
const BARS = [18, 24, 30, 22, 34, 40, 28, 46, 62, 55, 70, 64, 78, 58, 66, 50, 44, 56, 38, 30, 36, 26, 20, 28, 16]

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
      <span class="top-pill"><v-icon size="15">mdi-shield-check-outline</v-icon>Acesso seguro</span>
    </header>

    <main class="stage">
      <!-- apresentação: título grande e leve, obra em traço e cartões de vidro -->
      <section class="show" aria-hidden="true">
        <h1>Toda despesa <br />na obra certa.</h1>
        <p class="lede">Da nota fiscal ao custo de cada obra: notas, compras, contas e avanço em um só lugar.</p>

        <div class="scene">
          <svg class="building" viewBox="0 0 640 400" fill="none">
            <defs>
              <linearGradient id="lg-glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#dff3ea" /><stop offset="1" stop-color="#f4faf7" />
              </linearGradient>
              <linearGradient id="lg-wood" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#f3a04a" /><stop offset="1" stop-color="#f7c58d" />
              </linearGradient>
              <linearGradient id="lg-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0.55" stop-color="#fff" /><stop offset="1" stop-color="#fff" stop-opacity="0" />
              </linearGradient>
              <mask id="m-fade"><rect width="640" height="400" fill="url(#lg-fade)" /></mask>
            </defs>
            <g mask="url(#m-fade)" stroke="#20312c" stroke-linecap="round" stroke-linejoin="round">
              <!-- andaimes e estrutura ao fundo -->
              <g stroke-width="0.7" opacity="0.28">
                <path d="M380 40v300M420 40v300M460 40v300M500 40v300M540 40v300M580 60v280" />
                <path d="M380 70h200M380 110h200M380 150h200M380 190h200M380 230h200M380 270h200" />
                <path d="M380 70l40 40M420 110l40 40M460 150l40 40M500 190l40 40M540 110l40-40M460 70l40 40" />
                <path d="M120 60v100M160 50v110M200 60v100M120 90h80M120 60l80 30" />
              </g>
              <!-- lajes -->
              <g stroke-width="1.6">
                <path d="M70 330h520" />
                <path d="M96 252h436v10H96z" fill="#fff" />
                <path d="M150 170h330v10H150z" fill="#fff" />
                <path d="M230 96h210v9H230z" fill="#fff" />
              </g>
              <!-- térreo -->
              <g stroke-width="1.1">
                <rect x="112" y="262" width="150" height="68" fill="url(#lg-wood)" opacity="0.85" />
                <path d="M132 262v68M152 262v68M172 262v68M192 262v68M212 262v68M232 262v68" opacity="0.35" />
                <rect x="262" y="262" width="150" height="68" fill="url(#lg-glass)" />
                <path d="M312 262v68M362 262v68" />
                <rect x="412" y="262" width="104" height="68" fill="#fff" />
                <path d="M440 284h48v46h-48z" fill="url(#lg-glass)" />
              </g>
              <!-- primeiro andar -->
              <g stroke-width="1.1">
                <rect x="166" y="180" width="120" height="72" fill="url(#lg-glass)" />
                <path d="M206 180v72M246 180v72M166 216h120" />
                <rect x="286" y="180" width="96" height="72" fill="url(#lg-wood)" opacity="0.8" />
                <path d="M302 180v72M318 180v72M334 180v72M350 180v72M366 180v72" opacity="0.35" />
                <rect x="382" y="180" width="84" height="72" fill="#fff" />
                <path d="M96 252v-34h54M96 218v34M110 218v34M124 218v34M138 218v34" opacity="0.6" />
              </g>
              <!-- cobertura -->
              <g stroke-width="1.1">
                <rect x="246" y="105" width="90" height="65" fill="url(#lg-glass)" />
                <path d="M276 105v65M306 105v65" />
                <rect x="336" y="105" width="90" height="65" fill="#fff" />
                <path d="M440 170v-40h40v40M150 170v-28h80" opacity="0.6" />
              </g>
              <!-- cotas, como numa prancha de projeto -->
              <g stroke-width="0.8" opacity="0.5">
                <path d="M96 352h436M96 346v12M532 346v12M56 262v68M50 262h12M50 330h12" />
              </g>
            </g>
          </svg>

          <div class="glass g-obra">
            <div class="g-row"><b>Residencial Aurora</b><span class="g-corner"><v-icon size="14">mdi-arrow-top-right</v-icon></span></div>
            <div class="g-sub">dia 160 de 270</div>
            <div class="g-big">69%</div>
            <div class="g-sub">da obra pronta</div>
          </div>

          <div class="glass-white g-gauge">
            <GaugeArc :value="77" :size="112" label="Orçamento usado" />
          </div>

          <div class="glass-white g-bars">
            <div class="g-row"><span class="g-title">Gasto por semana</span><span class="delta delta-down"><v-icon size="13">mdi-trending-down</v-icon>2,4%</span></div>
            <div class="bars">
              <span v-for="(h, i) in BARS" :key="i" :class="{ hot: i > 6 && i < 18 }" :style="{ height: h + '%' }" />
            </div>
          </div>
        </div>
      </section>

      <!-- formulário -->
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
            <v-btn type="submit" color="primary" variant="flat" block size="large" :loading="loading" append-icon="mdi-arrow-right">Entrar</v-btn>
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
  background:
    radial-gradient(900px 520px at 12% 8%, #fff4e4 0%, transparent 60%),
    radial-gradient(820px 560px at 88% 0%, #e2f6ee 0%, transparent 62%),
    radial-gradient(700px 500px at 60% 100%, #eaf2fe 0%, transparent 60%),
    #f6f8f8;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px clamp(20px, 4vw, 48px) 0;
}
.top-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  box-shadow: var(--oo-shadow);
  font-size: var(--oo-fs-micro);
  font-weight: 600;
  color: var(--oo-muted);
}
.stage {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(340px, 440px);
  gap: clamp(20px, 4vw, 56px);
  align-items: center;
  padding: 16px clamp(20px, 4vw, 48px) 32px;
  max-width: 1360px;
  width: 100%;
  margin: 0 auto;
}

/* ---- apresentação */
.show {
  min-width: 0;
}
.show h1 {
  font-size: clamp(2.3rem, 4.6vw, 3.7rem);
  font-weight: 500;
  letter-spacing: -0.045em;
  line-height: 1.02;
  color: var(--oo-text);
}
.lede {
  margin-top: 14px;
  max-width: 40ch;
  color: var(--oo-muted);
  font-size: var(--oo-fs-lead);
  line-height: 1.5;
}
.scene {
  position: relative;
  margin-top: 8px;
  max-width: 700px;
}
.building {
  display: block;
  width: 100%;
  height: auto;
}
.glass,
.glass-white {
  position: absolute;
  border-radius: 20px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.glass {
  background: rgba(24, 38, 34, 0.62);
  color: #fff;
  box-shadow: 0 18px 40px -18px rgba(16, 32, 28, 0.55);
}
.glass-white {
  background: rgba(255, 255, 255, 0.82);
  box-shadow: var(--oo-shadow-lift);
}
.g-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.g-obra {
  left: 30%;
  top: 14%;
  padding: 14px 16px 15px;
  min-width: 190px;
}
.g-obra b {
  font-size: var(--oo-fs-body);
  font-weight: 600;
}
.g-corner {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.16);
}
.g-sub {
  font-size: 0.75rem;
  opacity: 0.75;
}
.g-big {
  font-size: 1.9rem;
  font-weight: 500;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin-top: 10px;
}
.g-gauge {
  right: 0;
  top: 2%;
  padding: 16px 14px 14px;
}
.g-bars {
  left: 0;
  right: 22%;
  bottom: -13%;
  padding: 14px 16px 12px;
}
.g-title {
  font-size: var(--oo-fs-micro);
  font-weight: 600;
  color: var(--oo-text);
}
.bars {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 64px;
  margin-top: 10px;
}
.bars span {
  flex: 1;
  border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, #dfe5e6, rgba(223, 229, 230, 0.15));
}
.bars span.hot {
  background: linear-gradient(180deg, var(--oo-orange), rgba(240, 135, 26, 0.18));
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
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 28px;
  box-shadow: var(--oo-shadow-lift);
  padding: clamp(24px, 3vw, 36px);
}
.f-title {
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.1;
}
.f-sub {
  color: var(--oo-muted);
  margin: 4px 0 24px;
}
.f-label {
  display: block;
  font-size: var(--oo-fs-micro);
  font-weight: 600;
  margin-bottom: 6px;
}
.f-foot {
  margin-top: 18px;
  font-size: var(--oo-fs-micro);
  color: var(--oo-muted);
  text-align: center;
  line-height: 1.45;
}
.copy {
  font-size: 0.75rem;
  color: var(--oo-faint);
}

@media (max-width: 900px) {
  .stage {
    grid-template-columns: 1fr;
    align-items: start;
    align-content: start;
    gap: 20px;
  }
  .scene,
  .lede {
    display: none;
  }
  .show h1 {
    font-size: 2rem;
    margin-top: 8px;
  }
  .show h1 br {
    display: none;
  }
}
</style>
