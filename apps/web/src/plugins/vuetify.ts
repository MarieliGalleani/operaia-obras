import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { pt } from 'vuetify/locale'

/** Tokens visuais do OperaIA Obras (seguem o protótipo aprovado). */
export const tokens = {
  sidebar: '#0B2E26',
  primary: '#0E6B53',
  primaryBright: '#1FA77A',
  accent: '#F2A93B',
  danger: '#E5484D',
  info: '#3B6FD4',
  surface: '#FFFFFF',
  background: '#F4F6F5',
  border: '#E6EAE8',
  text: '#16211D',
  muted: '#6B7A74',
}

export default createVuetify({
  locale: { locale: 'pt', messages: { pt } },
  theme: {
    defaultTheme: 'operaia',
    themes: {
      operaia: {
        dark: false,
        colors: {
          primary: tokens.primary,
          secondary: tokens.sidebar,
          accent: tokens.accent,
          success: tokens.primaryBright,
          warning: tokens.accent,
          error: tokens.danger,
          info: tokens.info,
          background: tokens.background,
          surface: tokens.surface,
          'on-background': tokens.text,
          'on-surface': tokens.text,
        },
      },
    },
  },
  defaults: {
    VCard: { rounded: 'lg', elevation: 0, border: true },
    VBtn: { rounded: 'lg', style: 'text-transform:none;letter-spacing:0;font-weight:600' },
    VTextField: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VAutocomplete: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VChip: { size: 'small', rounded: 'md' },
    VDataTable: { density: 'comfortable', hover: true },
  },
})
