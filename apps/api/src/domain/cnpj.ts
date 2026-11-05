export function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

/**
 * CNPJ alfanumérico (IN RFB 2.229/2024, emitido desde julho de 2026): 12 posições com letras ou
 * números + 2 dígitos verificadores numéricos. Cada caractere vale o código ASCII − 48
 * (0–9 continuam 0–9; A = 17 … Z = 42); pesos e módulo 11 iguais aos do CNPJ numérico.
 * CNPJs antigos (só números) continuam válidos do mesmo jeito.
 */
export function normalizeCnpj(v: string | null | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

const charValue = (ch: string) => ch.charCodeAt(0) - 48

function cnpjDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = base.split('').reduce((acc, ch, i) => acc + charValue(ch) * weights[i], 0)
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const c = normalizeCnpj(value)
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(.)\1+$/.test(c)) return false
  const d1 = cnpjDigit(c.slice(0, 12))
  const d2 = cnpjDigit(c.slice(0, 12) + d1)
  return c.endsWith(`${d1}${d2}`)
}

/** Completa os 2 dígitos verificadores de uma base de 12 posições (útil para seeds e testes). */
export function cnpjWithDigits(base12: string): string {
  const b = normalizeCnpj(base12).padStart(12, '0').slice(0, 12)
  const d1 = cnpjDigit(b)
  const d2 = cnpjDigit(b + d1)
  return `${b}${d1}${d2}`
}

/** CPF (prestador pessoa física em NFS-e). */
export function isValidCpf(value: string | null | undefined): boolean {
  const c = onlyDigits(value)
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false
  const dv = (len: number) => {
    const sum = c
      .slice(0, len)
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * (len + 1 - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10])
}

/** Formata CNPJ (e CPF, quando o prestador é pessoa física). */
export function formatCnpj(value: string): string {
  const c = normalizeCnpj(value)
  if (/^\d{11}$/.test(c)) return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  if (c.length !== 14) return value
  return c.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5')
}

/**
 * Chave de acesso sem o prefixo do atributo Id ("NFe…", "NFS…"). Com CNPJ alfanumérico a chave
 * passa a ter letras nas posições do CNPJ (NT 2025.001), por isso não dá para tirar tudo que não é número.
 */
export function normalizeAccessKey(v: string | null | undefined): string {
  return normalizeCnpj((v ?? '').replace(/^\s*(NFE|NFS|CTE)/i, ''))
}

/** Valida o dígito verificador (módulo 11) da chave de acesso de 44 posições da NF-e. */
export function isValidAccessKey(key: string | null | undefined): boolean {
  const k = normalizeAccessKey(key)
  if (!/^[0-9A-Z]{43}\d$/.test(k)) return false
  return accessKeyDigit(k.slice(0, 43)) === Number(k[43])
}

export function accessKeyDigit(base43: string): number {
  let weight = 2
  let sum = 0
  for (let i = base43.length - 1; i >= 0; i--) {
    sum += charValue(base43[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}
