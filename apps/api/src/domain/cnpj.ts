export function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

function cnpjDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0)
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const c = onlyDigits(value)
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false
  const d1 = cnpjDigit(c.slice(0, 12))
  const d2 = cnpjDigit(c.slice(0, 12) + d1)
  return c.endsWith(`${d1}${d2}`)
}

/** Completa os 2 dígitos verificadores de uma base de 12 dígitos (útil para seeds e testes). */
export function cnpjWithDigits(base12: string): string {
  const b = onlyDigits(base12).padStart(12, '0').slice(0, 12)
  const d1 = cnpjDigit(b)
  const d2 = cnpjDigit(b + d1)
  return `${b}${d1}${d2}`
}

export function formatCnpj(value: string): string {
  const c = onlyDigits(value)
  if (c.length !== 14) return value
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

/** Valida o dígito verificador (módulo 11) da chave de acesso de 44 dígitos da NF-e. */
export function isValidAccessKey(key: string | null | undefined): boolean {
  const k = onlyDigits(key)
  if (k.length !== 44) return false
  return accessKeyDigit(k.slice(0, 43)) === Number(k[43])
}

export function accessKeyDigit(base43: string): number {
  let weight = 2
  let sum = 0
  for (let i = base43.length - 1; i >= 0; i--) {
    sum += Number(base43[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}
