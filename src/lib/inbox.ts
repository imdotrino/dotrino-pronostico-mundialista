// Invitaciones a salas por CONTACTO usando el cliente estándar del ecosistema.
//
// Gracias a `identify` (connection.ts mapea token↔clave-del-vault), podemos
// enrutar por la identidad estable del contacto con `sendByPubkey`, que el proxy
// ENCOLA hasta 24 h: la invitación llega aunque el contacto no esté online en
// ese momento (se entrega cuando abra la app y se identifique). Recibir es solo
// escuchar mensajes `ROOM_INVITE` en la conexión compartida.

import { ensureConnected, getProxyClient } from './connection'
import { getIdentity } from './identity'

export interface IncomingInvite { url: string; nick?: string }

interface InviteMsg { type?: string; url?: string; nick?: string; env?: string }

/**
 * Escucha mensajes de salas mientras la app está abierta: invitaciones
 * (`ROOM_INVITE`) y aportes de pronóstico (`ROOM_PREDICTION`). Al ser GLOBAL
 * (no atado a la sala abierta), recibe lo que el proxy entregó por la cola
 * offline al reconectar, aunque no estés mirando esa sala.
 */
export class RoomInbox {
  private onInvite: (inv: IncomingInvite) => void
  private onPrediction?: (env: string) => void
  private off: (() => void) | null = null
  private seen = new Set<string>()

  constructor (onInvite: (inv: IncomingInvite) => void, onPrediction?: (env: string) => void) {
    this.onInvite = onInvite
    this.onPrediction = onPrediction
  }

  async start () {
    const c = await ensureConnected()
    this.off = c.on('message', (_from: string, payload: unknown) => {
      const msg = (typeof payload === 'object' && payload ? payload : {}) as InviteMsg
      if (msg.type === 'ROOM_INVITE' && msg.url && !this.seen.has(msg.url)) {
        this.seen.add(msg.url)
        this.onInvite({ url: msg.url, nick: msg.nick })
      } else if (msg.type === 'ROOM_PREDICTION' && msg.env) {
        // Sin dedup por `seen`: un aporte puede actualizarse (last-write-wins).
        this.onPrediction?.(msg.env)
      }
    })
  }

  stop () {
    if (this.off) { this.off(); this.off = null }
  }
}

/**
 * Envía una invitación (URL de sala) a contactos por su clave pública. Usa la
 * cola offline del proxy (`sendByPubkey`): se entrega ahora si están online, o
 * cuando abran la app (hasta 24 h). Devuelve cuántos contactos se encolaron.
 */
export async function sendRoomInvites (targetPubkeys: string[], roomUrl: string): Promise<number> {
  if (!targetPubkeys.length) return 0
  await ensureConnected()
  const id = await getIdentity()
  const nick = id?.me?.nickname
  getProxyClient().sendByPubkey(targetPubkeys, { type: 'ROOM_INVITE', url: roomUrl, nick })
  return targetPubkeys.length
}
