import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { pt } from 'vuetify/locale'

/** Tokens visuais do OperaIA Obras (seguem o protótipo aprovado). */
export const tokens = {
  sidebar: '#FFFFFF',
  primary: '#0D9B6C',
  primaryBright: '#12B77E',
  accent: '#F0871A',
  danger: '#D93A4C',
  info: '#2E7DF6',
  surface: '#FFFFFF',
  background: '#F3F6F7',
  border: '#EAEEF0',
  text: '#101C1A',
  muted: '#6E7E7B',
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
    VCard: { rounded: 'xl', elevation: 0, border: false },
    VBtn: { rounded: 'pill', style: 'text-transform:none;letter-spacing:0;font-weight:600' },
    VTextField: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VAutocomplete: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VChip: { size: 'small', rounded: 'pill' },
    VDataTable: { density: 'comfortable', hover: true },
  },
})
