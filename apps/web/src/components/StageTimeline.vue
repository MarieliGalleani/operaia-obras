<script setup lang="ts">
/**
 * Etapas da obra na ordem em que acontecem, como uma régua.
 * Verde = pronta · amarelo = fazendo agora · cinza = ainda não começou.
 * É o jeito que o mestre e o proprietário já pensam a obra, melhor que uma lista de porcentagens.
 */
import { computed, ref } from 'vue'
import { date } from '@/lib/format'
import type { Schedule } from '@/lib/schedule'

const props = defineProps<{
  stages: { name: string; progress: number; updatedAt?: string | null; updatedByName?: string | null }[]
  schedule?: Schedule | null
  /** mostra o nome de cada etapa em pé embaixo da régua (telas largas) */
  labels?: boolean
}>()

type State = 'done' | 'doing' | 'todo'
const steps = computed(() =>
  props.stages.map((s) => ({ ...s, state: (s.progress >= 100 ? 'done' : s.progress > 0 ? 'doing' : 'todo') as State })),
)
const done = computed(() => steps.value.filter((s) => s.state === 'done').length)
const doing = computed(() => steps.value.filter((s) => s.state === 'doing'))
/** até onde a linha verde vai */
const filled = computed(() => {
  const n = steps.value.length
  if (!n) return 0
  const lastDone = steps.value.map((s) => s.state).lastIndexOf('done')
  const firstDoing = steps.value.findIndex((s) => s.state === 'doing')
  const idx = firstDoing >= 0 ? firstDoing : lastDone
  return n === 1 ? (idx >= 0 ? 100 : 0) : (Math.max(idx, 0) / (n - 1)) * 100
})
const doingLabel = computed(() => {
  const n = doing.value.map((d) => d.name)
  return n.length <= 2 ? n.join(', ') : `${n.slice(0, 2).join(', ')} e mais ${n.length - 2}`
})
const open = ref<number | null>(null)
const STATE_LABEL: Record<State, string> = { done: 'pronta', doing: 'fazendo agora', todo: 'ainda não começou' }
</script>

<template>
  <div v-if="steps.length" class="timeline">
    <div class="tl-head">
      <div class="tl-counts">
        <span class="state state-ok"><v-icon size="15">mdi-check-circle</v-icon>{{ done }} pronta(s)</span>
        <span v-if="doing.length" class="state state-attention"><v-icon size="15">mdi-progress-wrench</v-icon>{{ doingLabel }}</span>
        <span class="muted tl-rest">{{ steps.length - done - doing.length }} ainda não começaram</span>
      </div>
      <div v-if="schedule" class="tl-sched">
        <span class="muted">dia {{ schedule.elapsedDays }} de {{ schedule.totalDays }}</span>
        <span class="state" :class="`state-${schedule.state}`">
          <v-icon size="15">{{ schedule.state === 'ok' ? 'mdi-check-circle' : 'mdi-clock-alert' }}</v-icon>
          {{ schedule.daysBehind > 0 ? `${schedule.daysBehind} dias atrás do calendário` : 'no ritmo do calendário' }}
        </span>
      </div>
    </div>

    <div class="rail" :class="{ 'has-labels': labels }" role="list">
      <div class="rail-line"><span class="rail-fill" :style="{ width: filled + '%' }" /></div>
      <button
        v-for="(s, i) in steps"
        :key="s.name + i"
        type="button"
        class="dot-wrap"
        role="listitem"
        :aria-label="`${s.name}: ${STATE_LABEL[s.state]}`"
        @click="open = open === i ? null : i"
      >
        <span class="dot" :class="`dot-${s.state}`">
          <v-icon v-if="s.state === 'done'" size="13" color="#fff">mdi-check</v-icon>
        </span>
        <span v-if="labels" class="dot-label" :class="{ 'is-doing': s.state === 'doing' }">{{ s.name }}</span>
      </button>
    </div>

    <div v-if="open !== null && steps[open]" class="tl-card">
      <div>
        <div class="font-weight-bold">{{ steps[open].name }}</div>
        <div class="muted">
          {{ STATE_LABEL[steps[open].state] }} · {{ steps[open].progress }}% feito
          <template v-if="steps[open].updatedAt"> · atualizada em {{ date(steps[open].updatedAt) }}<template v-if="steps[open].updatedByName"> por {{ steps[open].updatedByName }}</template></template>
        </div>
      </div>
      <v-btn size="small" variant="text" icon="mdi-close" aria-label="Fechar" @click="open = null" />
    </div>
  </div>
  <div v-else class="muted">As etapas desta obra ainda não foram cadastradas.</div>
</template>

<style scoped>
.tl-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.tl-counts,
.tl-sched {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--oo-fs-micro);
}
.tl-rest {
  font-size: var(--oo-fs-micro);
}

.rail {
  position: relative;
  display: flex;
  justify-content: space-between;
  gap: 2px;
  padding-top: 2px;
}
.rail.has-labels {
  padding-bottom: 86px;
}
.rail-line {
  position: absolute;
  left: 9px;
  right: 9px;
  top: 10px;
  height: 4px;
  border-radius: 999px;
  background: var(--oo-track);
}
.rail-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--oo-primary);
}
.dot-wrap {
  position: relative;
  flex: 1 0 auto;
  min-width: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
}
.dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--oo-track);
  box-shadow: 0 0 0 3px var(--oo-surface);
  flex: none;
}
.dot-done {
  background: var(--oo-primary);
}
.dot-doing {
  background: var(--oo-orange);
  box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--oo-orange-soft);
}
.dot-label {
  position: absolute;
  top: 24px;
  right: 50%;
  transform: rotate(-45deg);
  transform-origin: top right;
  font-size: 0.6875rem;
  line-height: 1;
  color: var(--oo-muted);
  white-space: nowrap;
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot-label.is-doing {
  color: #7d4a00;
  font-weight: 700;
}
.tl-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--oo-r-inner);
  background: var(--oo-sunken);
  font-size: var(--oo-fs-micro);
}
</style>
