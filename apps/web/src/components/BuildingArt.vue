<script setup lang="ts">
/**
 * Desenho de uma obra em perspectiva, feito de volumes (lajes, vidro, madeira),
 * com andaimes, grua e piso. É a ilustração da marca: aparece no login e nos destaques.
 */
const uid = Math.random().toString(36).slice(2, 7)
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
    glass: [`url(#g-top-${uid})`, `url(#g-glass-r-${uid})`, `url(#g-glass-l-${uid})`],
    wood: ['#f6d2a8', `url(#g-wood-r-${uid})`, `url(#g-wood-l-${uid})`],
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
</script>

<template>
  <svg class="building" aria-hidden="true" viewBox="-20 -34 720 540" fill="none">
  <defs>
    <linearGradient :id="`g-top-${uid}`" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f8f7" /><stop offset="1" stop-color="#e3ecea" /></linearGradient>
    <linearGradient :id="`g-glass-r-${uid}`" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef4f6" stop-opacity="0.9" /><stop offset="1" stop-color="#c9d6da" stop-opacity="0.75" /></linearGradient>
    <linearGradient :id="`g-glass-l-${uid}`" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8ea" stop-opacity="0.9" /><stop offset="1" stop-color="#b9c7cc" stop-opacity="0.75" /></linearGradient>
    <linearGradient :id="`g-wood-r-${uid}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e59a5a" /><stop offset="1" stop-color="#c9773c" /></linearGradient>
    <linearGradient :id="`g-wood-l-${uid}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8773d" /><stop offset="1" stop-color="#a95f2c" /></linearGradient>
    <filter :id="`f-shadow-${uid}`" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="16" /></filter>
    <radialGradient :id="`g-ground-${uid}`" cx="0.46" cy="0.86" r="0.5"><stop offset="0.25" stop-color="#fff" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient>
    <mask :id="`m-ground-${uid}`"><rect x="-20" y="-34" width="720" height="540" :fill="`url(#g-ground-${uid})`" /></mask>
  </defs>
  <path :d="GROUND" stroke="#33423e" stroke-width="0.5" opacity="0.16" :mask="`url(#m-ground-${uid})`" />
  <g stroke="#e07a1c" stroke-width="0.8" stroke-linejoin="round" opacity="0.85">
    <path :d="CRANE" />
    <polygon :points="CRANE_LOAD" fill="#f6d2a8" />
  </g>
  <ellipse cx="330" cy="438" rx="240" ry="15" fill="#2b2f2e" opacity="0.34" :filter="`url(#f-shadow-${uid})`" />
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
</template>

<style scoped>
.building {
  display: block;
  width: 100%;
  height: auto;
}
</style>
