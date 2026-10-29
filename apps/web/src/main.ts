import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import vuetify from './plugins/vuetify'
import router from './router'
import './styles/main.css'

import { DEMO } from './lib/demo'

if (DEMO) router.replace('/')
createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app')
