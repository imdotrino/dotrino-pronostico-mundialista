import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import '@dotrino/support'
import '@dotrino/install'
import '@dotrino/share'
import { createBackNav } from '@dotrino/nav'
import { i18n } from './i18n'
import { initAnalytics } from './lib/analytics'
import { registerSW } from 'virtual:pwa-register'

// SW con auto-actualización REAL: sin esto el plugin solo registra el SW y la
// versión nueva recién se ve en la SIGUIENTE visita (en la PWA instalada de
// móvil, nunca, porque no se "re-visita"). registerSW recarga la página cuando
// el SW nuevo toma control y además re-chequea actualizaciones cada 30 min.
registerSW({
  immediate: true,
  onRegisteredSW (_swUrl, reg) {
    if (!reg) return
    setInterval(() => { reg.update().catch(() => {}) }, 30 * 60_000)
  },
})

// Navegación "volver" unificada del ecosistema (botón físico de Android / gesto
// de iOS / atrás del navegador / chevron del header → cierra modal/panel; si no
// hay nada → dotrino.com).
createBackNav()

createApp(App).use(i18n).mount('#app')

// Analítica cookieless autohosteada (GoatCounter); solo en producción.
initAnalytics()

// Web Push: el SW (dotrino-push-sw.js, inyectado en el SW de Workbox)
// hace postMessage('cc-push-ring') al recibir el timbre. Si la app está abierta,
// nos aseguramos de estar conectados → identify drena la cola offline del proxy.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
    if (ev.data && ev.data.type === 'cc-push-ring') {
      import('./lib/connection').then(m => m.ensureConnected()).catch(() => {})
    }
  })
}
