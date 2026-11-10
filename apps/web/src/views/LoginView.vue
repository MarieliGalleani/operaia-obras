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
const showPass = ref(false)
// ---------- desenho de apresentação (decorativo): obra em perspectiva, feita de caixas
const U = 24
const OX = 262
const OY = 262
const pt = (x: number, y: number, z: number) => `${(OX + (x - y) * 0.866 * U).toFixed(1)},${(OY + (x + y) * 0.3 * U - z * U).toFixed(1)}`
type Kind = 'slab' | 'glass' | 'wood' | 'wall' | 'panel'
interface Face { points: string; fill: string; lines: string[] }
function box(x: number, y: number, z: number, w: number, d: number, h: number, kind: Kind): Face[] {
  const top = [pt(x, y, z + h), pt(x + w, y, z + h), pt(x + w, y + d, z + h), pt(x, y + d, z + h)].join(' ')
  const right = [pt(x + w, y, z), pt(x + w, y + d, z), pt(x + w, y + d, z + h), pt(x + w, y, z + h)].join(' ')
  const left = [pt(x, y + d, z), pt(x + w, y + d, z), pt(x + w, y + d, z + h), pt(x, y + d, z + h)].join(' ')
  const step = kind === 'wood' ? 0.45 : kind === 'glass' ? 1.3 : 0
  const rl: string[] = []
  const ll: string[] = []
  if (step) {
    for (let t = step; t < d - 0.05; t += step) rl.push(`M${pt(x + w, y + t, z)}L${pt(x + w, y + t, z + h)}`)
    for (let t = step; t < w - 0.05; t += step) ll.push(`M${pt(x + t, y + d, z)}L${pt(x + t, y + d, z + h)}`)
    if (kind === 'glass') {
      rl.push(`M${pt(x + w, y, z + h * 0.55)}L${pt(x + w, y + d, z + h * 0.55)}`)
      ll.push(`M${pt(x, y + d, z + h * 0.55)}L${pt(x + w, y + d, z + h * 0.55)}`)
    }
  }
  const F = {
    slab: ['#ffffff', '#f1f3f3', '#e4e8e8'],
    wall: ['#ffffff', '#f4f5f5', '#e9ecec'],
    glass: ['url(#g-top)', 'url(#g-glass-r)', 'url(#g-glass-l)'],
    wood: ['#f6d2a8', 'url(#g-wood-r)', 'url(#g-wood-l)'],
    panel: ['#40536a', '#2d3a4a', '#243040'],
  }[kind]
  return [
    { points: top, fill: F[0], lines: [] },
    { points: right, fill: F[1], lines: rl },
    { points: left, fill: F[2], lines: ll },
  ]
}
// de trás para a frente, de baixo para cima
const col = (x: number, y: number, z: number, h: number) => box(x, y, z, 0.22, 0.22, h, 'wall')
const FACES: Face[] = [
  ...box(0, 0, 0, 13, 9, 0.25, 'slab'),
  ...col(12.7, -0.1, 0.25, 2.6),
  ...box(0.6, 0.6, 0.25, 5, 7.4, 2.6, 'wood'),
  ...box(5.6, 1.4, 0.25, 6.4, 6.6, 2.6, 'glass'),
  ...col(-0.3, 9, 0.25, 2.6),
  ...col(6.2, 9, 0.25, 2.6),
  ...col(12.7, 9, 0.25, 2.6),
  ...box(-0.6, -0.4, 2.85, 13.8, 9.9, 0.3, 'slab'),
  ...box(1, 1, 3.15, 6, 6.6, 2.6, 'glass'),
  ...box(7, 2.2, 3.15, 4.6, 5.4, 2.6, 'wood'),
  ...col(12, 8, 3.15, 2.6),
  ...col(0.6, 8, 3.15, 2.6),
  ...box(0.4, 0.6, 5.75, 12, 7.8, 0.3, 'slab'),
  ...box(2, 2, 6.05, 5, 4, 2.3, 'wall'),
  ...box(7, 3, 6.05, 3.6, 3, 2.3, 'glass'),
  ...box(1.4, 1.5, 8.35, 9.8, 5.2, 0.25, 'slab'),
  // placas solares e caixa d'água na cobertura
  ...box(2, 2.1, 8.6, 1.7, 1.1, 0.07, 'panel'),
  ...box(4, 2.1, 8.6, 1.7, 1.1, 0.07, 'panel'),
  ...box(6, 2.1, 8.6, 1.7, 1.1, 0.07, 'panel'),
  ...box(8.6, 3.6, 8.6, 1.4, 1.4, 1, 'wall'),
]
// guarda-corpos de vidro nos terraços
function rail(z: number, x0: number, x1: number, y0: number, y1: number) {
  const h = 0.85
  const l: string[] = [`M${pt(x0, y1, z + h)}L${pt(x1, y1, z + h)}L${pt(x1, y0, z + h)}`]
  for (let x = x0; x <= x1 + 0.01; x += 1.1) l.push(`M${pt(x, y1, z)}L${pt(x, y1, z + h)}`)
  for (let y = y0; y <= y1 + 0.01; y += 1.1) l.push(`M${pt(x1, y, z)}L${pt(x1, y, z + h)}`)
  return l.join('')
}
const RAILS = rail(3.15, -0.6, 13.2, -0.4, 9.5) + rail(6.05, 0.4, 12.4, 0.6, 8.4)
// piso: malha que some nas bordas
const GROUND = (() => {
  const l: string[] = []
  for (let x = -6; x <= 20; x += 1.5) l.push(`M${pt(x, -5, 0)}L${pt(x, 15, 0)}`)
  for (let y = -5; y <= 15; y += 1.5) l.push(`M${pt(-6, y, 0)}L${pt(20, y, 0)}`)
  return l.join('')
})()
// grua ao fundo
const CRANE = (() => {
  const cx = 14.4
  const cy = -2.6
  const top = 11.8
  const l: string[] = [`M${pt(cx, cy, 0)}L${pt(cx, cy, top + 1.6)}`, `M${pt(cx + 0.55, cy, 0)}L${pt(cx + 0.55, cy, top)}`]
  for (let z = 0; z < top; z += 1.1) l.push(`M${pt(cx, cy, z)}L${pt(cx + 0.55, cy, z + 0.55)}L${pt(cx, cy, z + 1.1)}`)
  l.push(`M${pt(3.5, cy, top)}L${pt(16.8, cy, top)}`, `M${pt(3.5, cy, top + 0.45)}L${pt(cx, cy, top + 0.45)}`)
  for (let x = 3.5; x < cx - 0.4; x += 0.9) l.push(`M${pt(x, cy, top)}L${pt(x + 0.45, cy, top + 0.45)}L${pt(x + 0.9, cy, top)}`)
  l.push(`M${pt(cx, cy, top + 1.6)}L${pt(5.5, cy, top + 0.45)}`, `M${pt(cx, cy, top + 1.6)}L${pt(16.8, cy, top)}`)
  l.push(`M${pt(7.2, cy, top)}L${pt(7.2, cy, 9.9)}`)
  return l.join('')
})()
const CRANE_LOAD = [pt(6.7, -2.6, 9.9), pt(7.7, -2.6, 9.9), pt(7.7, -2.6, 9.3), pt(6.7, -2.6, 9.3)].join(' ')
// andaimes: malha fina atrás e na quina da direita
const SCAFFOLD = (() => {
  const l: string[] = []
  for (let x = -1.5; x <= 15; x += 1.5) l.push(`M${pt(x, -1.6, 0)}L${pt(x, -1.6, 10.4)}`)
  for (let y = -1.6; y <= 9.5; y += 1.5) l.push(`M${pt(-1.6, y, 0)}L${pt(-1.6, y, 10.4)}`)
  for (let z = 1.3; z <= 10.4; z += 1.3) {
    l.push(`M${pt(-1.5, -1.6, z)}L${pt(15, -1.6, z)}`)
    l.push(`M${pt(-1.6, -1.6, z)}L${pt(-1.6, 9.4, z)}`)
  }
  for (let x = -1.5; x < 14; x += 3) l.push(`M${pt(x, -1.6, 1.3)}L${pt(x + 1.5, -1.6, 2.6)}M${pt(x + 1.5, -1.6, 5.2)}L${pt(x + 3, -1.6, 6.5)}`)
  return l.join('')
})()
const SCAFFOLD_FRONT = (() => {
  const l: string[] = []
  for (let y = 1; y <= 10; y += 1.5) l.push(`M${pt(14.2, y, 0)}L${pt(14.2, y, 7.8)}`)
  for (let z = 1.3; z <= 7.8; z += 1.3) l.push(`M${pt(14.2, 1, z)}L${pt(14.2, 10, z)}`)
  l.push(`M${pt(14.2, 1, 0)}L${pt(14.2, 2.5, 1.3)}M${pt(14.2, 4, 2.6)}L${pt(14.2, 5.5, 3.9)}M${pt(14.2, 7, 1.3)}L${pt(14.2, 8.5, 2.6)}`)
  return l.join('')
})()
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
          <svg class="building" viewBox="-20 -34 720 540" fill="none">
            <defs>
              <linearGradient id="g-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f8f7" /><stop offset="1" stop-color="#e3ecea" /></linearGradient>
              <linearGradient id="g-glass-r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef4f6" stop-opacity="0.9" /><stop offset="1" stop-color="#c9d6da" stop-opacity="0.75" /></linearGradient>
              <linearGradient id="g-glass-l" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8ea" stop-opacity="0.9" /><stop offset="1" stop-color="#b9c7cc" stop-opacity="0.75" /></linearGradient>
              <linearGradient id="g-wood-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e59a5a" /><stop offset="1" stop-color="#c9773c" /></linearGradient>
              <linearGradient id="g-wood-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8773d" /><stop offset="1" stop-color="#a95f2c" /></linearGradient>
              <filter id="f-shadow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="16" /></filter>
              <radialGradient id="g-ground" cx="0.46" cy="0.86" r="0.5"><stop offset="0.25" stop-color="#fff" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient>
              <mask id="m-ground"><rect x="-20" y="-34" width="720" height="540" fill="url(#g-ground)" /></mask>
            </defs>
            <path :d="GROUND" stroke="#33423e" stroke-width="0.5" opacity="0.16" mask="url(#m-ground)" />
            <g stroke="#e07a1c" stroke-width="0.8" stroke-linejoin="round" opacity="0.85">
              <path :d="CRANE" />
              <polygon :points="CRANE_LOAD" fill="#f6d2a8" />
            </g>
            <ellipse cx="330" cy="438" rx="240" ry="15" fill="#2b2f2e" opacity="0.34" filter="url(#f-shadow)" />
            <path :d="SCAFFOLD" stroke="#33423e" stroke-width="0.55" opacity="0.3" />
            <g stroke="#2a3835" stroke-width="0.75" stroke-linejoin="round">
              <g v-for="(f, i) in FACES" :key="i">
                <polygon :points="f.points" :fill="f.fill" />
                <path v-if="f.lines.length" :d="f.lines.join('')" stroke-width="0.5" opacity="0.5" />
              </g>
            </g>
            <path :d="RAILS" stroke="#2a3835" stroke-width="0.55" opacity="0.55" />
            <path :d="SCAFFOLD_FRONT" stroke="#33423e" stroke-width="0.6" opacity="0.4" />
          </svg>

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
  font-family: 'Urbanist', 'Plus Jakarta Sans', system-ui, sans-serif;
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
  font-family: 'Urbanist', sans-serif;
}
.enter {
  color: #fff !important;
  box-shadow: 0 12px 24px -12px rgba(17, 25, 23, 0.6) !important;
  font-family: 'Urbanist', sans-serif;
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
