// Invitaciones a salas por CONTACTO usando el cliente estándar del ecosistema.
//
// Gracias a `identify` (connection.ts mapea token↔clave-del-vault), podemos
// enrutar por la identidad estable del contacto con `sendSealed`, que el proxy
// ENCOLA hasta 24 h: la invitación llega aunque el contacto no esté online en
// ese momento (se entrega cuando abra la app y se identifique). Recibir es solo
// escuchar mensajes `ROOM_INVITE` en la conexión compartida.
//
// LA INVITACIÓN VA SELLADA (CONVENCIONES §4.1). Lleva la URL de la sala —que es la
// llave para entrar, con el nombre de la sala firmado dentro— y el apodo de quien
// invita. El proxio no cifra: iba tal cual, así que quien lo opera veía quién
// invita a quién y a qué sala. Y justamente aquí el destinatario suele estar
// APAGADO, que es para lo que existe la cola: por eso hace falta que la llave de
// cifrado del otro se pueda AVERIGUAR (@dotrino/proxy-client >= 0.20.0) y no
// dependa de tenerlo conectado.

import { ensureConnected, getProxyClient } from './connection'
import { getIdentity } from './identity'

export interface IncomingInvite { url: string; nick?: string }

interface InviteMsg { type?: string; url?: string; nick?: string; env?: string }

/** A quién no se le pudo mandar la invitación, y por qué. */
export interface InviteOutcome { sent: number; failed: Array<{ pubkey: string; code: string }> }

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
    // ESCUCHAR ANTES DE CONECTAR. La cola de 24 h se drena en cuanto el proxio acepta el
    // `identify`, o sea DENTRO de `ensureConnected`: engancharse después es llegar tarde
    // a lo que se estaba esperando, y perderlo sin que nada lo diga.
    const c = getProxyClient()
    this.off = c.on('message', (_from: string, payload: unknown, meta: any) => {
      // Sin la marca del pilar no entra. Una invitación en claro es una invitación que
      // pudo escribir cualquiera que mire el cable, y lleva a la sala que ella diga.
      if (!meta?.sealed) return
      const msg = (typeof payload === 'object' && payload ? payload : {}) as InviteMsg
      if (msg.type === 'ROOM_INVITE' && msg.url && !this.seen.has(msg.url)) {
        this.seen.add(msg.url)
        this.onInvite({ url: msg.url, nick: msg.nick })
      } else if (msg.type === 'ROOM_PREDICTION' && msg.env) {
        // Sin dedup por `seen`: un aporte puede actualizarse (last-write-wins).
        this.onPrediction?.(msg.env)
      }
    })
    await ensureConnected()
  }

  stop () {
    if (this.off) { this.off(); this.off = null }
  }
}

/**
 * Envía una invitación (URL de sala) a contactos por su clave pública, SELLADA.
 * Usa la cola offline del proxy: se entrega ahora si están online, o cuando abran
 * la app (hasta 24 h).
 *
 * UNA POR CONTACTO, y el que no se pueda sellar se dice por su nombre: un contacto
 * que todavía no anunció su llave de cifrado no puede dejar sin invitación a los
 * demás. A ese no se le manda — nunca en claro — y se devuelve en `failed` para que
 * la pantalla lo enseñe.
 */
export async function sendRoomInvites (targetPubkeys: string[], roomUrl: string): Promise<InviteOutcome> {
  const out: InviteOutcome = { sent: 0, failed: [] }
  if (!targetPubkeys.length) return out
  const c = await ensureConnected()
  const id = await getIdentity()
  const nick = id?.me?.nickname
  for (const pk of targetPubkeys) {
    try {
      await c.sendSealed(pk, { type: 'ROOM_INVITE', url: roomUrl, nick })
      out.sent++
    } catch (e: any) {
      const code = e?.code || 'unknown'
      out.failed.push({ pubkey: pk, code })
      console.warn('no se pudo sellar la invitación (' + code + '): no se manda en claro')
    }
  }
  return out
}
