/**
 * Prazo da obra: em que dia ela está, e se o avanço físico acompanha o calendário.
 * Sem datas na obra, devolve null — a tela simplesmente não mostra a régua de prazo.
 */
export interface Schedule {
  totalDays: number
  elapsedDays: number
  /** quanto do prazo já passou, 0–100 */
  timePct: number
  /** quanto da obra está pronto, 0–100 */
  physicalPct: number
  /** positivo = atrás do calendário */
  daysBehind: number
  state: 'late' | 'attention' | 'ok'
}

const day = (iso: string) => new Date((iso.length > 10 ? iso.slice(0, 10) : iso) + 'T00:00:00').getTime()

export function schedule(startDate?: string | null, endDate?: string | null, physicalPct?: number | null): Schedule | null {
  if (!startDate || !endDate || physicalPct == null) return null
  const start = day(startDate)
  const end = day(endDate)
  const today = day(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))
  const totalDays = Math.max(Math.round((end - start) / 86_400_000), 1)
  const elapsedDays = Math.min(Math.max(Math.round((today - start) / 86_400_000), 0), totalDays)
  const timePct = (elapsedDays / totalDays) * 100
  const daysBehind = Math.round(((timePct - physicalPct) / 100) * totalDays)
  return {
    totalDays,
    elapsedDays,
    timePct,
    physicalPct,
    daysBehind,
    state: daysBehind > 15 ? 'late' : daysBehind > 5 ? 'attention' : 'ok',
  }
}
