// Sincronización EN VIVO de una sala usando el cliente ESTÁNDAR del ecosistema
// (`@dotrino/proxy-client`, vía connection.ts). Cada sala es un
// canal público `mundial-room-<roomId>`: los miembros conectados se publican,
// se descubren (list / channel_joined) y se intercambian sus pronósticos
// firmados con `client.send` (que usa WebRTC con fallback al proxy).
//
// Los mensajes son objetos JSON con un campo `type`:
//   { type:'ROOM_PREDICTION', roomId, frag }   pronóstico firmado de un miembro
//   { type:'ROOM_REQUEST', roomId }            pedir el pronóstico a un peer

import type { WebSocketProxyClient } from '@dotrino/proxy-client'
import { ensureConnected, getProxyClient } from './connection'

const CHANNEL_PREFIX = 'mundial-room-'

export interface RoomSyncHandlers {
  onPrediction: (env: string) => void
  onPeerCount?: (n: number) => void
  onStatus?: (s: 'connecting' | 'online' | 'offline') => void
  /** Pubkeys de los miembros conocidos de la sala (sin la mía), para entrega
   *  por identidad estable: online inmediato + cola offline 24h del proxy. */
  memberPubkeys?: () => string[]
  /** Todos los sobres firmados que conozco (de todos los miembros, incluidas
   *  lápidas), para REENVIARLOS a otros peers (gossip): así la sala converge sin
   *  que cada autor esté online. Reenviar es seguro: van firmados, no se alteran. */
  allEnvelopes?: () => string[]
}

interface RoomMsg { type?: string; roomId?: string; env?: string }

/** Mantiene viva la sincronización de UNA sala mientras está en pantalla. */
export class RoomSync {
  private roomId: string
  private myEnv: string | null
  private handlers: RoomSyncHandlers
  private peers = new Set<string>()
  private offFns: Array<() => void> = []
  private stopped = false

  constructor (roomId: string, myEnv: string | null, handlers: RoomSyncHandlers) {
    this.roomId = roomId
    this.myEnv = myEnv
    this.handlers = handlers
  }

  private get channelName () { return CHANNEL_PREFIX + this.roomId }

  async start () {
    this.stopped = false
    this.handlers.onStatus?.('connecting')
    const c = await ensureConnected()
    if (this.stopped) return
    this.registerHandlers(c)
    try {
      await c.publish(this.channelName)
      const tokens = await c.list(this.channelName)
      for (const tk of tokens) if (tk !== c.token) this.peers.add(tk)
      this.handlers.onStatus?.('online')
      this.emitCount()
      const list = [...this.peers]
      this.relayAll(list)        // les paso TODO lo que conozco (gossip)
      this.broadcastByPubkey()   // encolo lo MÍO para los miembros offline (24h)
      this.requestPredictions(list)
    } catch (e) {
      console.warn('No se pudo publicar/listar el canal de la sala:', e)
      this.handlers.onStatus?.(c.isConnected ? 'online' : 'offline')
    }
  }

  stop () {
    this.stopped = true
    const c = getProxyClient()
    try { c.unpublish(this.channelName).catch(() => {}) } catch { /* */ }
    for (const off of this.offFns) { try { off() } catch { /* */ } }
    this.offFns = []
    this.peers.clear()
    this.handlers.onStatus?.('offline')
  }

  /** Re-difunde MI sobre (al aportar, cambiar o BORRAR). */
  updateMyEnv (env: string | null) {
    this.myEnv = env
    this.broadcastMine([...this.peers]) // online ahora (entrega inmediata)
    this.broadcastByPubkey()            // miembros offline: queda encolado 24h
  }

  /** Difunde un sobre puntual (p.ej. el REENVÍO del pronóstico de un amigo) sin
   *  reemplazar `myEnv` (mi aporte propio se sigue re-difundiendo como siempre). */
  broadcastEnv (env: string) {
    this.sendEnv([...this.peers], env)
    const pks = (this.handlers.memberPubkeys?.() ?? []).filter(Boolean)
    if (!pks.length) return
    try { getProxyClient().sendByPubkey(pks, { type: 'ROOM_PREDICTION', roomId: this.roomId, env }) } catch { /* */ }
  }

  private emitCount () { this.handlers.onPeerCount?.(this.peers.size + 1) }

  private send (tokens: string[], msg: RoomMsg) {
    if (!tokens.length) return
    getProxyClient().send(tokens, msg)
  }
  private sendEnv (tokens: string[], env: string) {
    this.send(tokens, { type: 'ROOM_PREDICTION', roomId: this.roomId, env })
  }
  private broadcastMine (tokens: string[]) {
    if (this.myEnv) this.sendEnv(tokens, this.myEnv)
  }
  // Reenvía TODOS los sobres que conozco (gossip): online inmediato a esos tokens.
  private relayAll (tokens: string[]) {
    if (!tokens.length) return
    const envs = this.handlers.allEnvelopes?.() ?? []
    for (const env of envs) if (env) this.sendEnv(tokens, env)
    if (this.myEnv && !envs.includes(this.myEnv)) this.sendEnv(tokens, this.myEnv)
  }
  // Difunde MI sobre por la IDENTIDAD de los miembros (no por token): el proxy lo
  // entrega online y lo encola hasta 24h para los que estén offline.
  private broadcastByPubkey () {
    if (!this.myEnv) return
    const pks = (this.handlers.memberPubkeys?.() ?? []).filter(Boolean)
    if (!pks.length) return
    try { getProxyClient().sendByPubkey(pks, { type: 'ROOM_PREDICTION', roomId: this.roomId, env: this.myEnv }) } catch { /* */ }
  }
  private requestPredictions (tokens: string[]) {
    this.send(tokens, { type: 'ROOM_REQUEST', roomId: this.roomId })
  }

  private registerHandlers (c: WebSocketProxyClient) {
    this.offFns.push(c.on('message', (from: string, payload: unknown) => {
      const msg = (typeof payload === 'object' && payload ? payload : {}) as RoomMsg
      if (msg.roomId !== this.roomId) return
      if (msg.type === 'ROOM_PREDICTION' && typeof msg.env === 'string') {
        this.handlers.onPrediction(msg.env)
      } else if (msg.type === 'ROOM_REQUEST' && from) {
        this.relayAll([from]) // le paso TODO lo que conozco, no solo lo mío
      }
    }))
    this.offFns.push(c.on('channel_joined', (channel: string, token: string) => {
      if (channel !== this.channelName || token === c.token) return
      this.peers.add(token)
      this.emitCount()
      this.relayAll([token])
      this.requestPredictions([token])
    }))
    const drop = (channel: string, token: string) => {
      if (channel && channel !== this.channelName) return
      if (this.peers.delete(token)) this.emitCount()
    }
    this.offFns.push(c.on('channel_left', drop))
    this.offFns.push(c.on('peer_disconnected', (token: string, channel?: string) => drop(channel ?? '', token)))
  }
}
