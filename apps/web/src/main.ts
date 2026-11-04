import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import vuetify from './plugins/vuetify'
import router from './router'
import './styles/main.css'

import { DEMO } from './lib/demo'
import { startBackgroundSync } from './lib/offline'

if (DEMO) router.replace('/')
createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app')

if (!DEMO) {
  // envia a fila do app de obra quando houver sinal
  startBackgroundSync()
  // app de obra sem internet: o service worker guarda as telas para abrir sem sinal
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => {
          // baixa já as telas do app de obra (ficam guardadas para abrir sem internet)
          void import('./views/FieldHomeView.vue')
          void import('./views/FieldProjectView.vue')
        })
        .catch(() => {})
    })
  }
}
