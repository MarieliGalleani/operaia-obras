import { reactive } from 'vue'

export const toastState = reactive({ show: false, text: '', color: 'success' as string })

export function toast(text: string, color: 'success' | 'error' | 'warning' | 'info' = 'success') {
  toastState.text = text
  toastState.color = color
  toastState.show = true
}

export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : 'Erro inesperado', 'error')
}
