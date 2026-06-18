// Salas de pronósticos guardadas en localStorage. Una SALA reúne los
// pronósticos firmados de varias personas para compararlos entre sí y contra
// los resultados oficiales (tabla de posiciones + comparación lado a lado).
//
// Filosofía Dotrino: el estado vive 100% en cada cliente (sin servidor
// autoritativo). El proxy y los enlaces/QR solo reparten/sincronizan; cada
// quien guarda en SU localStorage los pronósticos de las salas en las que está.

import type { GameMode, Scope, Results } from './standings'
import { pullThread, syncThread, THREAD_ROOMS } from './cloud'

/** Modo exigido por la sala: uno fijo o 'free' (cualquier tipo). */
export type RoomMode = GameMode | 'free'

/** Alcance exigido por la sala: uno fijo o 'free' (cualquier alcance). */
export type RoomScope = Scope | 'free'

/** El pronóstico firmado que un miembro aportó a la sala. */
export interface RoomMember {
  /** clave pública JWK (string) del autor — identifica al miembro */
  publickey: string
  nickname?: string
  /** la firma del pronóstico verificó (autoría confiable) */
  verified: boolean
  /** nombre/título del pronóstico (viaja en el frag firmado; solo display) */
  name?: string
  /** fragmento firmado original del pronóstico (blob base64url del enlace) */
  frag: string
  /** código compacto del pronóstico (decodificable para puntuar/comparar) */
  code: string
  /** modo y resultados locales del pronóstico (no viajan en el código) */
  mode?: GameMode
  /** alcance del pronóstico (decodificado del código): 'all'/'groups'/'bracket' */
  scope?: Scope
  results?: Results
  /** sello de tiempo del sellador: cuándo existió este pronóstico (ms epoch) */
  sealedAt?: number
  /** ¿el sello del sellador verificó contra la pubkey pineada? */
  sealValid?: boolean
  /** SALAS DE LA FECHA: por partido, el instante CERTIFICADO (ms) en que existió
   *  el pick — sellos por partido del sobre, YA VERIFICADOS contra el TSA y el
   *  marcador aportado. Un pick solo puntúa si su prueba es anterior al kickoff. */
  proof?: Record<number, number>
  /** tombstone: el autor borró su aporte (se conserva como lápida para que un
   *  reenvío de un sobre viejo no lo "reviva"). */
  deleted?: boolean
  /** sobre FIRMADO por el autor (`{r,f|d,t}`), tal cual viaja: permite reenviarlo
   *  a terceros sin alterarlo (gossip). */
  env?: string
  /** versión puesta por el AUTOR (ms epoch del sobre): clave de last-write-wins.
   *  Mayor gana → re-aportar/borrar le gana a lo anterior. Ausente = legacy (0). */
  version?: number
  /** REENVÍO: pubkey del miembro que aportó este pronóstico de un amigo (sobre
   *  v4). Ausente = aporte del propio autor. Lo del autor SIEMPRE gana al reenvío. */
  via?: string
  /** apodo del aportador del reenvío (del sobre v4; solo display) */
  viaNick?: string
  /** marca temporal local de la última versión recibida (bookkeeping/cloud) */
  updatedAt: number
}

export interface Room {
  id: string
  name: string
  /** modo de juego exigido a los miembros (o 'free') */
  mode: RoomMode
  /** alcance exigido a los miembros (o 'free'). Ausente = 'free' (salas legacy). */
  scope?: RoomScope
  /** privacidad: 0 = pronósticos visibles desde ya; o un timestamp (ms) hasta el
   *  que los pronósticos ajenos quedan "sellados" (ocultos para evitar copia). */
  sealedUntil: number
  /** true = sala del PRONÓSTICO DE LA FECHA: los miembros aportan su entrada
   *  diaria, el puntaje es por partido (gateado por sello a tiempo) y los picks
   *  ajenos se ocultan hasta el kickoff de cada partido (no hay sello global). */
  daily?: boolean
  /** clave pública del creador (host lógico, NO autoritativo) */
  hostPubkey: string
  hostNick?: string
  /** ¿soy yo el creador de esta sala? */
  mine: boolean
  createdAt: number
  updatedAt: number
  members: RoomMember[]
}

const ROOMS_KEY = 'mundial.rooms.v1'
const ACTIVE_ROOM_KEY = 'mundial.activeRoomId.v1'

export function loadRooms (): Room[] {
  try {
    const raw = localStorage.getItem(ROOMS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export function saveRooms (rooms: Room[]): void {
  try { localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms)) } catch { /* */ }
  // Espejo en la nube (fire-and-forget; no bloquea ni rompe si el store no está).
  void syncThread(THREAD_ROOMS, rooms.map((r) => ({ id: r.id, ts: r.updatedAt, data: r })))
}

/**
 * Trae las salas del store del ecosistema y las fusiona con las locales
 * (last-writer-wins por `updatedAt`; los miembros igual reconvergen por el canal
 * en vivo). Devuelve la lista fusionada y si cambió.
 */
export async function hydrateRooms (local: Room[]): Promise<{ rooms: Room[]; changed: boolean }> {
  const remote = await pullThread<Room>(THREAD_ROOMS)
  if (!remote.length) return { rooms: local, changed: false }
  const byId = new Map(local.map((r) => [r.id, r]))
  let changed = false
  for (const r of remote) {
    if (!r?.id) continue
    const cur = byId.get(r.id)
    if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) { byId.set(r.id, r); changed = true }
  }
  return { rooms: [...byId.values()], changed }
}

export function getActiveRoomId (): string | null {
  return localStorage.getItem(ACTIVE_ROOM_KEY)
}
export function setActiveRoomId (id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_ROOM_KEY, id)
    else localStorage.removeItem(ACTIVE_ROOM_KEY)
  } catch { /* */ }
}

/** ¿El pronóstico de este miembro está sellado (oculto) para mí ahora mismo? */
export function isMemberSealed (room: Room, member: RoomMember, myPubkey: string | null): boolean {
  if (member.publickey === myPubkey) return false // los míos siempre los veo
  // Lo que YO reenvié ya lo conozco (vino de mi librería): no tiene sentido sellármelo.
  if (member.via && member.via === myPubkey) return false
  return room.sealedUntil > Date.now()
}

// Rango de precedencia: lo aportado por el PROPIO autor (sin via, incluida su
// lápida) siempre le gana a un reenvío de terceros, sin importar la versión.
// Así nadie puede pisar el pronóstico propio del amigo (ni revivir lo que él
// borró) reenviando un frag viejo con un reloj más nuevo.
function rankOf (m: RoomMember): number {
  return m.via ? 1 : 2
}

/**
 * Inserta o reemplaza un miembro (por publickey). Primero manda el RANGO (autor
 * gana a reenvío); a igual rango, last-write-wins por la VERSIÓN del sobre
 * (`version`, ms). Un tombstone con version mayor le gana al pronóstico;
 * re-aportar con version mayor le gana al tombstone. El retiro de un reenvío
 * solo lo aplica quien hizo ESE reenvío. Devuelve true si cambió el estado.
 */
export function upsertMember (room: Room, member: RoomMember): boolean {
  const i = room.members.findIndex((m) => m.publickey === member.publickey)
  if (i < 0) { room.members.push(member); room.updatedAt = Date.now(); return true }
  const cur = room.members[i]!
  if (rankOf(member) < rankOf(cur)) return false
  if (rankOf(member) === rankOf(cur)) {
    if ((member.version ?? 0) < (cur.version ?? 0)) return false
    // Lápida de reenvío: solo borra el reenvío del MISMO aportador.
    if (member.deleted && member.via && cur.via && member.via !== cur.via) return false
  }
  room.members[i] = member
  room.updatedAt = Date.now()
  return true
}
