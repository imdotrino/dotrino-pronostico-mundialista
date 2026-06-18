// Conexión única al proxy del ecosistema usando el cliente ESTÁNDAR
// `@dotrino/proxy-client` (igual que el messenger). Una sola
// instancia compartida para toda la app: canales de sala, buzón de invitaciones
// y cola offline.
//
// Al conectar, nos IDENTIFICAMOS con la clave del **vault** (no la del cliente):
// firmamos `{op,publickey,token,ts}` con `id.signData` y llamamos `identify()`.
// Así el proxy mapea token↔clave-del-vault y habilita `sendByPubkey` (cola
// offline 24 h), unificando la identidad de transporte con la de firma.

import { getWebSocketProxyClient, type WebSocketProxyClient } from '@dotrino/proxy-client'
import { getIdentity } from './identity'

const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) || 'wss://proxy.dotrino.com'

let client: WebSocketProxyClient | null = null
let connecting: Promise<WebSocketProxyClient> | null = null
let handlersReady = false
let myPublickey: string | null = null

export function getProxyClient (): WebSocketProxyClient {
  if (!client) {
    client = getWebSocketProxyClient({ url: WS_URL })
  }
  return client
}

export function getMyPublickey (): string | null { return myPublickey }

// Identificarse con la pubkey del vault para activar la cola offline y que los
// contactos puedan enrutarnos por nuestra identidad estable.
async function identifyWithVault (c: WebSocketProxyClient) {
  const id = await getIdentity()
  const publickey = id?.me?.publickey
  if (!id || !publickey || !c.token) return
  try {
    const data = { op: 'identify', publickey, token: c.token, ts: Date.now() }
    const { signature } = await id.signData(data)
    await c.identify({ data, signature })
    myPublickey = publickey
    // Si el usuario activó notificaciones, re-registrar la push subscription
    // (los endpoints pueden rotar). Import dinámico para evitar ciclo de módulos.
    import('./notifications').then(m => m.ensureSubscribed()).catch(() => {})
  } catch (e) {
    console.warn('identify (vault) falló:', e)
  }
}

function setupHandlers (c: WebSocketProxyClient) {
  if (handlersReady) return
  handlersReady = true
  // Al (re)conectar el proxy asigna un token nuevo: re-identificarse.
  c.on('connect', () => { identifyWithVault(c).catch(() => {}) })
  c.on('token', () => { identifyWithVault(c).catch(() => {}) })
}

/** Conecta (una sola vez) y se identifica con el vault. Idempotente. */
export function ensureConnected (): Promise<WebSocketProxyClient> {
  const c = getProxyClient()
  if (c.isConnected) return Promise.resolve(c)
  if (connecting) return connecting
  setupHandlers(c)
  connecting = c.connect()
    .then(async () => { await identifyWithVault(c); return c })
    .catch((e) => { console.warn('No se pudo conectar al proxy:', e); return c })
    .finally(() => { connecting = null })
  return connecting
}
