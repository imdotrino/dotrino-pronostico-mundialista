// Sincronización EN VIVO de una sala usando el cliente ESTÁNDAR del ecosistema
// (`@dotrino/proxy-client`, vía connection.ts).
//
// EL PRONÓSTICO DE ALGUIEN ES SUYO, Y VA SELLADO (CONVENCIONES §4.1). El sobre de
// un miembro va FIRMADO —eso prueba quién lo escribió y que nadie lo tocó—, pero
// firmar no es cifrar: el proxio enruta y manda el payload tal cual, así que hasta
// ahora quien opera el proxio leía el pronóstico entero de cada miembro de cada
// sala. Desde ahora todo lo dirigido sale con `sendSealed` y lo que llegue sin
// sellar se descarta (el cliente ya viene con `requireSealed`, ver connection.ts).
//
// POR IDENTIDAD, NO POR TOKEN. Antes se mandaba por las dos vías: por token a los
// que estuvieran en el canal, y por pubkey a los miembros conocidos. El token no
// dice de quién es —el canal solo lista direcciones—, así que no hay a quién
// sellarle: por eso lo dirigido va ahora SOLO por pubkey, que además es la vía que
// entrega online Y encola 24 h para el que está apagado. El canal público se queda
// para lo que siempre fue, presencia (cuánta gente hay mirando), y ahí no hay nada
// que ocultar: es público por diseño y §4.1 lo exime.
//
// Y DE QUIÉN ES CADA TOKEN LO DICE EL SALUDO (`helloTo`, pilar 0.22.0+): una trama de
// control del transporte que solo lleva una llave PÚBLICA, la misma que el proxio ya
// tiene atada a esa conexión desde el `identify`. Con eso se recupera lo único que se
// perdía al dejar de mandar por token: que dos miembros que aún no se conocen se
// descubran por estar a la vez en el canal, sin esperar a que el creador abra la app.
//
// Los mensajes son objetos JSON con un campo `type`:
//   { type:'ROOM_PREDICTION', roomId, env }   pronóstico firmado de un miembro
//   { type:'ROOM_REQUEST', roomId }           pedir los pronósticos a un miembro

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
  /** A quién NO se le pudo sellar y por qué (`code` del pilar). La app lo enseña:
   *  callarlo deja a alguien fuera de la sala sin que nadie lo sepa. */
  onUnreachable?: (pubkey: string, code: string) => void
}

interface RoomMsg { type?: string; roomId?: string; env?: string }

/** Mantiene viva la sincronización de UNA sala mientras está en pantalla. */
export class RoomSync {
  private roomId: string
  private myEnv: string | null
  private handlers: RoomSyncHandlers
  private peers = new Set<string>()
  // QUÉ le pasé por última vez a cada quien (una firma del conjunto de sobres, no la
  // hora). Sirve para dos cosas a la vez: que un miembro nuevo reciba la sala entera de
  // QUIEN SEA que le oiga primero —no solo del creador—, y que eso no se vuelva un
  // ping-pong. Con una marca de «ya le hablé» no valdría: le habría hablado cuando no
  // tenía nada, y lo que aprendiera después no le llegaría nunca.
  private lastRelay = new Map<string, string>()
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
    // ESCUCHAR ANTES DE CONECTAR: la cola de 24 h se drena al identificarse, dentro de
    // `ensureConnected`. Engancharse después es perderse justo lo que quedó esperando.
    this.registerHandlers(getProxyClient())
    const c = await ensureConnected()
    if (this.stopped) return
    try {
      // El canal es SOLO presencia: quién está mirando ahora. Es público por diseño
      // (§4.1 lo exime) y no lleva nada del usuario — ni el pronóstico ni su apodo.
      await c.publish(this.channelName)
      const tokens = await c.list(this.channelName)
      for (const tk of tokens) if (tk !== c.token) this.peers.add(tk)
      // Saludar a los que ya estaban: quien contesta dice de quién es su token, y a
      // partir de ahí ya hay una identidad a la que sellarle.
      try { c.helloTo([...this.peers]) } catch { /* sin identify todavía */ }
      this.handlers.onStatus?.('online')
      this.emitCount()
      void this.relayAll()        // les paso TODO lo que conozco (gossip)
      void this.broadcastMine()   // lo MÍO: online ahora, o encolado 24 h
      void this.requestPredictions()
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
    this.lastRelay.clear()
    this.handlers.onStatus?.('offline')
  }

  /** Re-difunde MI sobre (al aportar, cambiar o BORRAR). */
  updateMyEnv (env: string | null) {
    this.myEnv = env
    void this.broadcastMine()
  }

  /** Difunde un sobre puntual (p.ej. el REENVÍO del pronóstico de un amigo) sin
   *  reemplazar `myEnv` (mi aporte propio se sigue re-difundiendo como siempre). */
  broadcastEnv (env: string) {
    void this.sendEnv(this.members(), env)
  }

  private emitCount () { this.handlers.onPeerCount?.(this.peers.size + 1) }

  private members (): string[] {
    return (this.handlers.memberPubkeys?.() ?? []).filter(Boolean)
  }

  /**
   * Mandar SELLADO a varias identidades, UNA POR UNA.
   *
   * El pilar resuelve todas las llaves antes de mandar nada, para que no quede media
   * sala con el mensaje y la otra media sin él. Eso es lo correcto cuando el mensaje es
   * uno solo; aquí no lo es: son N personas independientes, y un miembro que todavía no
   * anunció su llave de cifrado dejaría MUDA la sala entera. Así que se manda de uno en
   * uno y el que no se pueda se dice por su nombre.
   *
   * Lo que NO se hace, y es la regla: al que no se le puede sellar, no se le manda en
   * claro. Se queda fuera y se avisa.
   */
  private async sealedTo (pubkeys: string[], msg: RoomMsg): Promise<Set<string>> {
    const fallaron = new Set<string>()
    if (!pubkeys.length) return fallaron
    const c = getProxyClient()
    for (const pk of pubkeys) {
      try {
        await c.sendSealed(pk, msg)
      } catch (e: any) {
        const code = e?.code || 'unknown'
        fallaron.add(pk)
        this.handlers.onUnreachable?.(pk, code)
        console.warn('no se pudo sellar para un miembro de la sala (' + code + '): no se manda en claro')
      }
    }
    return fallaron
  }

  /** Firma barata del conjunto de sobres: dice si tengo algo distinto que contar. */
  private static firma (envs: string[]): string {
    let h = 5381
    for (const e of [...envs].sort()) for (let i = 0; i < e.length; i++) h = ((h << 5) + h + e.charCodeAt(i)) | 0
    return envs.length + ':' + (h >>> 0).toString(36)
  }

  private sendEnv (pubkeys: string[], env: string) {
    return this.sealedTo(pubkeys, { type: 'ROOM_PREDICTION', roomId: this.roomId, env })
  }

  private broadcastMine () {
    if (!this.myEnv) return Promise.resolve()
    return this.sendEnv(this.members(), this.myEnv)
  }

  /**
   * Reenvía TODOS los sobres que conozco (gossip) a quien se le diga — salvo a quien ya
   * le mandé exactamente esto mismo, que es lo que corta el ping-pong: dos que se
   * reenvían el uno al otro paran en cuanto ninguno tiene nada nuevo que contar.
   */
  private async relayAll (pubkeys: string[] = this.members()) {
    if (!pubkeys.length) return
    const envs = (this.handlers.allEnvelopes?.() ?? []).filter(Boolean)
    if (this.myEnv && !envs.includes(this.myEnv)) envs.push(this.myEnv)
    if (!envs.length) return
    const firma = RoomSync.firma(envs)
    const objetivo = pubkeys.filter((pk) => this.lastRelay.get(pk) !== firma)
    if (!objetivo.length) return
    const fallaron = new Set<string>()
    for (const env of envs) for (const pk of await this.sendEnv(objetivo, env)) fallaron.add(pk)
    // Solo se apunta a quien LE LLEGÓ: al que falló hay que volver a intentárselo.
    for (const pk of objetivo) if (!fallaron.has(pk)) this.lastRelay.set(pk, firma)
  }

  private requestPredictions (pubkeys: string[] = this.members()) {
    return this.sealedTo(pubkeys, { type: 'ROOM_REQUEST', roomId: this.roomId })
  }

  private registerHandlers (c: WebSocketProxyClient) {
    this.offFns.push(c.on('message', (_from: string, payload: unknown, meta: any) => {
      // Lo que no viene sellado no existe. El cliente ya lo tira por `requireSealed`;
      // esta es la comprobación de la app, y solo mira la marca que deja el pilar —
      // abrir el sobre aquí también sería la segunda capa que hace que no lo abra nadie.
      if (!meta?.sealed) return
      const msg = (typeof payload === 'object' && payload ? payload : {}) as RoomMsg
      if (msg.roomId !== this.roomId) return
      // QUIEN ME HABLA, SE LLEVA LA SALA ENTERA — una vez. Es lo que hace que un miembro
      // nuevo converja con quien sea que le oiga primero y no solo con el creador: en
      // cuanto aporta algo, el que lo recibe le devuelve todo lo que sabe. Se le contesta
      // a la IDENTIDAD, no a su token: el token no dice de quién es y sellar necesita
      // saberlo. Lo que se reenvía son sobres firmados, los mismos que reparte el enlace.
      const de = meta.fromPubkey as string | null
      if (msg.type === 'ROOM_PREDICTION' && typeof msg.env === 'string') {
        this.handlers.onPrediction(msg.env)
        // Se le devuelve todo lo que sé, pero DESPUÉS de aplicar lo suyo: así el que
        // acaba de aportar recibe la sala entera de una, incluido su propio sitio en
        // ella. `relayAll` decide solo si hay algo nuevo que contarle.
        if (de) void Promise.resolve().then(() => this.relayAll([de]))
      } else if (msg.type === 'ROOM_REQUEST' && de) {
        void this.relayAll([de])
      }
    }))
    this.offFns.push(c.on('channel_joined', (channel: string, token: string) => {
      if (channel !== this.channelName || token === c.token) return
      this.peers.add(token)
      this.emitCount()
      try { c.helloTo(token) } catch { /* sin identify todavía */ }
    }))
    // El saludo contestado: ya se sabe QUIÉN está en la sala, no solo cuántos. Se le
    // manda lo que sé — `relayAll` calla solo si no tengo nada nuevo que contarle.
    this.offFns.push(c.on('peer_identity', (token: string, publickey: string) => {
      if (!this.peers.has(token) || !publickey) return
      void this.relayAll([publickey])
    }))
    const drop = (channel: string, token: string) => {
      if (channel && channel !== this.channelName) return
      if (this.peers.delete(token)) this.emitCount()
    }
    this.offFns.push(c.on('channel_left', drop))
    this.offFns.push(c.on('peer_disconnected', (token: string, channel?: string) => drop(channel ?? '', token)))
  }
}
