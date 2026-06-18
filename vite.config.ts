import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'node:child_process'

// <meta name="commit"> con el hash del commit del build: permite ver a simple
// vista (Ver código fuente / document.querySelector) qué versión sirve el
// dominio — clave para diagnosticar cachés viejas. Normado en CONVENCIONES-APPS.
function commitMeta (): Plugin {
  let hash = 'dev'
  try { hash = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* sin git */ }
  return {
    name: 'commit-meta',
    transformIndexHtml: (html) =>
      html.replace('</head>', `  <meta name="commit" content="${hash}" />\n  </head>`),
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('dotrino-'),
        },
      },
    }),
    // HTTPS autofirmado en desarrollo (contexto seguro para el vault de identidad,
    // portapapeles y Web Share). El navegador avisará del cert no confiable: aceptar.
    basicSsl(),
    commitMeta(),
    VitePWA({
      // DESARROLLO (command === 'serve'): SW autodestructivo. Limpia caché previa
      // y se desregistra para servir SIEMPRE contenido fresco desde la red.
      // PRODUCCIÓN (build): SW real y persistente — necesario para Web Push
      // (el timbre despierta este SW) y para que la PWA sea instalable.
      selfDestroying: command === 'serve',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Pronóstico Mundialista',
        short_name: 'Mundial',
        description: 'Arma tu pronóstico del Mundial 2026 y compártelo firmado por QR',
        theme_color: '#0a1730',
        background_color: '#060e20',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      // Sin precache: el SW existe para instalabilidad PWA + Web Push.
      workbox: {
        globPatterns: [],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
        navigateFallback: null,
        // Inyecta el handler de Web Push (push + notificationclick) en el SW de
        // Workbox. El archivo se sirve desde public/ (copia del paquete
        // @dotrino/proxy-client/sw/). No se registra un 2º SW.
        importScripts: ['dotrino-push-sw.js']
      }
    })
  ],
  base: './',
  server: {
    host: true,
    // Permite servir detrás de Tailscale (MagicDNS) y otros hosts de la LAN.
    // Vite 7 bloquea hosts desconocidos por protección de DNS rebinding.
    allowedHosts: ['.ts.net', '.local', 'localhost'],
  },
}))
