// Conexión única al proxy del ecosistema usando el cliente ESTÁNDAR
// `@dotrino/proxy-client` (igual que el messenger). Una sola
// instancia compartida para toda la app: canales de sala, buzón de invitaciones
// y cola offline.
//
// Al conectar, nos IDENTIFICAMOS con la clave del **vault** (no la del cliente):
// firmamos `{op,publickey,token,ts}` con `id.signData` y llamamos `identify()`.
// Así el proxy mapea token↔clave-del-vault y habilita `sendByPubkey` (cola
// offline 24 h), unificando la identidad de transporte con la de firma.
//
// TODO LO DIRIGIDO VA SELLADO (CONVENCIONES §4.1). El proxio enruta por pubkey y
// NO cifra el contenido: lo que saliera por aquí sin sellar lo leería quien opera
// el proxio, que corre en un VPS alquilado — y por aquí sale el PRONÓSTICO de la
// gente y las invitaciones a sus salas. El cliente se crea con
// `requireSealed: true`, así que el camino en claro no existe: mandar sin sellar
// lanza, y lo que llegue sin sellar se descarta. Sellar solo de salida no serviría
// de nada.
//
// Quien sella es la BÓVEDA, no la app: la llave privada de cifrado vive dentro del
// iframe de `id.dotrino.com` y no sale de ahí. El puente es `identitySealing` del
// propio pilar (0.21.0+); aquí no se escribe cripto.

import { getWebSocketProxyClient, identitySealing, type WebSocketProxyClient } from '@dotrino/proxy-client'
import { getIdentity } from './identity'

const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) || 'wss://proxy.dotrino.com'

/** La marca de nuestros sobres: lo que no la lleva, no es nuestro. Estable. */
export const SEAL_APP = 'mundial'

let client: WebSocketProxyClient | null = null
let connecting: Promise<WebSocketProxyClient> | null = null
let handlersReady = false
let myPublickey: string | null = null
let sealingReady = false

export function getProxyClient (): WebSocketProxyClient {
  if (!client) {
    // `requireSealed` DESDE EL PRIMER INSTANTE, y no cuando la bóveda conteste: si se
    // encendiera después, lo que saliera mientras tanto saldría en claro y nadie se
    // enteraría. Fallar cerrado es lo correcto — sin bóveda no hay nada que mandar.
    client = getWebSocketProxyClient({ url: WS_URL, requireSealed: true })
  }
  return client
}

export function getMyPublickey (): string | null { return myPublickey }

/** ¿Ya tiene el cliente con qué sellar y abrir? Sin esto no sale ni entra nada. */
export function canSeal (): boolean { return sealingReady }

// Identificarse con la pubkey del vault para activar la cola offline y que los
// contactos puedan enrutarnos por nuestra identidad estable.
async function identifyWithVault (c: WebSocketProxyClient) {
  const id = await getIdentity()
  const publickey = id?.me?.publickey
  if (!id || !publickey || !c.token) return
  try {
    // LA LLAVE DE CIFRADO, ANTES DEL IDENTIFY. El `identify` la anuncia solo y por
    // detrás (firmada con la misma llave), y ese anuncio es lo que permite que alguien
    // que no nos ha emparejado nunca —un miembro nuevo de una sala— nos selle algo. Si
    // se pusiera después, el anuncio de esta conexión no saldría.
    c.updateConfig({
      myEncPub: await id.getEncryptionPubkey(),
      sealing: identitySealing(id, { app: SEAL_APP }),
    })
    sealingReady = true
    // El sobre lo arma el pilar (`identifyAs`), que le pone el destinatario.
    await c.identifyAs({ publickey, sign: (d: any) => id.signData(d) })
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
  // Lo que llega sin sellar el pilar lo tira, y lo dice por aquí. Se deja visible en
  // vez de mudo: es el síntoma de que alguien enfrente tiene una versión vieja.
  c.on('error', (e: any) => {
    if (e?.type === 'unsealed') console.warn('mensaje SIN SELLAR descartado:', e.reason)
    else if (e?.type === 'encpub_announce_failed') console.warn('no se pudo anunciar la llave de cifrado (' + (e.code || 'sin code') + '): nadie podrá sellarnos nada', e.error)
  })
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
