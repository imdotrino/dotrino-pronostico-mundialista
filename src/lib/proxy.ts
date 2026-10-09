// Resolver un CÓDIGO CORTO (una «cita») a la identidad real de quien lo compartió.
//
// Va por el pilar (`@dotrino/proxy-client`), por la MISMA conexión identificada que usa
// el resto de la app. Antes este archivo abría su propio WebSocket y mandaba un reto en
// claro, que ya nadie contesta: todo el ecosistema descarta lo dirigido sin sellar.
//
// Dos pasos, y ninguno manda nada a la otra persona:
//   1. `redeemPairingCode(code)` — el proxio dice a qué identidad apunta la cita. Esa
//      pubkey es la que la otra conexión presentó en su `identify` firmado.
//   2. `encPubOf(publickey)` — su llave de cifrado, VERIFICADA contra esa pubkey: la
//      firma de quien la anunció se comprueba aquí, así que el proxio no puede cambiarla
//      por la suya. Sin ella no se le podría sellar una invitación, y un contacto al que
//      no se le puede escribir no sirve.
import { ensureConnected } from './connection'

export interface ResolveCodeResult {
  publickey: string
  encryptionPubkey: string
}

/**
 * Por qué no se pudo resolver, por código y no por frase (la copy la pone quien llama):
 *   · `not-connected`   no hay conexión identificada con el proxio
 *   · `invalid-code`    la cita no existe, caducó o ya se usó
 *   · `no-identity`     esa conexión no se identificó: no hay pubkey que guardar
 *   · `no-encpub` / `encpub-unverified` / `no-encpub-support`  los del pilar, tal cual
 */
export class ProxyTokenError extends Error {
  code: string
  constructor (code: string, message?: string) {
    super(message || code)
    this.name = 'ProxyTokenError'
    this.code = code
  }
}

export async function resolveCodeToIdentity (code: string): Promise<ResolveCodeResult> {
  const c = await ensureConnected()
  if (!c.isConnected) throw new ProxyTokenError('not-connected')
  const r = await c.redeemPairingCode(code)
  if (!r || !r.ok) throw new ProxyTokenError('invalid-code', r?.error)
  if (!r.publickey) throw new ProxyTokenError('no-identity')
  try {
    return { publickey: r.publickey, encryptionPubkey: await c.encPubOf(r.publickey) }
  } catch (e: any) {
    throw new ProxyTokenError(e?.code || 'unknown', e?.message)
  }
}
