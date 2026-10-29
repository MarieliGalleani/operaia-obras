/** Converte "12500.5" / "12500,50" / 12500.5 em centavos inteiros, sem erro de ponto flutuante. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Math.round(value * 100)
  const s = value.trim().replace(/\s/g, '')
  // aceita formato brasileiro 1.234,56 e formato XML 1234.56
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const negative = normalized.startsWith('-')
  const [intPart, decPart = ''] = normalized.replace('-', '').split('.')
  const dec = (decPart + '00').slice(0, 3)
  let cents = Number(intPart || '0') * 100 + Number(dec.slice(0, 2))
  if (Number(dec[2] ?? '0') >= 5) cents += 1
  return negative ? -cents : cents
}

export function fromCents(cents: number): number {
  return cents / 100
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Divide um valor em partes proporcionais, garantindo que a soma bata exatamente (resto vai para a última). */
export function splitProportional(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)
  const parts = weights.map((w) => Math.floor((totalCents * w) / sum))
  const diff = totalCents - parts.reduce((a, b) => a + b, 0)
  parts[parts.length - 1] += diff
  return parts
}
