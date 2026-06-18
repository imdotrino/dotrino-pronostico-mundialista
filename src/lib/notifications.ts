// Web Push del pronosticador, ahora sobre el paquete compartido del ecosistema
// (@dotrino/notifications): `createVaultPushProvider` encapsula
// el opt-in firmado por el vault contra el proxy (antes estaba reimplementado
// acá). Conservamos la misma API `useNotifications()` (refs reactivos para el
// toggle del IdentityPanel) para no tocar la UI ni connection.ts.
//
// El timbre NO transporta contenido; el Service Worker despierta, la app
// reconecta e `identify()` drena la cola cifrada del proxy.

import { ref, computed } from 'vue'
import { createVaultPushProvider, createNotifications, type PushProvider } from '@dotrino/notifications'
import { getProxyClient } from './connection'
import { getIdentity } from './identity'

// Migra el flag legacy ('mundial_push_enabled') a la clave del paquete ('cc-push:mundial').
try {
  if (localStorage.getItem('cc-push:mundial') == null && localStorage.getItem('mundial_push_enabled') === '1') {
    localStorage.setItem('cc-push:mundial', '1')
  }
} catch { /* ignore */ }

// Forma real (runtime) del provider: todos los miembros son funciones. (Los
// tipos publicados en 0.1.0 declaran busy/error como unión no-llamable; corregido
// en el paquete, este narrowing cubre el build contra 0.1.0.)
interface VaultPush {
  supported(): boolean
  isEnabled(): boolean
  busy(): boolean
  error(): string
  enable(): Promise<boolean>
  disable(): Promise<boolean>
  ensureSubscribed(): Promise<void>
}
const provider = createVaultPushProvider({
  proxyClient: () => getProxyClient(),
  identity: () => getIdentity(),
  storageKey: 'mundial',
}) as unknown as VaultPush

// Controlador de notificaciones LOCALES (permiso + prefs por categoría + disparo),
// con el provider de push integrado. Lo consumen el motor de acuses (receipts.ts)
// y el panel de ajustes <dotrino-notifications>. Singleton.
const controller = createNotifications({
  storageKey: 'mundial',
  categories: [
    {
      key: 'shareOpened',
      label: { es: 'Aperturas de lo que compartí', en: 'Opens of what I shared' },
      hint: {
        es: 'Avisame cuando alguien abre un pronóstico que compartí.',
        en: 'Notify me when someone opens a prediction I shared.',
      },
    },
  ],
  push: provider as unknown as PushProvider,
})

/** Controlador de notificaciones compartido (singleton). */
export function getNotificationsController () { return controller }

const enabled = ref(provider.isEnabled())
const permission = ref<NotificationPermission>(
  typeof Notification !== 'undefined' ? Notification.permission : 'default'
)
const busy = ref(false)
const error = ref('')
const supported = computed(() => provider.supported())

function sync () {
  enabled.value = provider.isEnabled()
  busy.value = provider.busy()
  error.value = provider.error()
  if (typeof Notification !== 'undefined') permission.value = Notification.permission
}

async function enable (): Promise<boolean> {
  busy.value = true
  const r = await provider.enable()
  sync()
  return r
}

async function disable (): Promise<boolean> {
  busy.value = true
  const r = await provider.disable()
  sync()
  return r
}

// Re-registra la subscription tras cada identify (los endpoints rotan). Silencioso.
async function ensureSubscribed (): Promise<void> {
  await provider.ensureSubscribed()
  sync()
}

export function useNotifications () {
  return { supported, enabled, permission, busy, error, enable, disable, ensureSubscribed }
}

// Acceso directo (no-componente) para connection.identifyWithVault.
export { ensureSubscribed }
