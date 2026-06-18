// Estado COMPARTIDO de salas (módulo singleton) para que la barra lateral y la
// página de salas vean lo mismo: las salas, cuál está activa y la sincronización
// en vivo. Las salas son "otra página" del app: se crean/seleccionan desde la
// barra lateral (igual que los pronósticos) y el área principal muestra la activa.

import { ref, computed } from 'vue'
import type { PeerInfo } from '@dotrino/identity'
import { getIdentity } from '../lib/identity'
import {
  loadRooms, saveRooms, getActiveRoomId, setActiveRoomId, upsertMember, hydrateRooms,
  type Room, type RoomMode, type RoomScope,
} from '../lib/roomStore'
import {
  genRoomId, TOURNAMENT_START, parseRoomInvite, parseMemberContrib, memberFromEnvelope,
  buildMemberEnvelope,
} from '../lib/room'
import { buildShareUrl } from '../lib/share'
import { dailySealsForEnvelope } from '../lib/matchday'
import type { SavedPrediction } from '../lib/store'
import { RoomSync } from '../lib/roomSync'

// --- Estado a nivel de módulo (compartido por todos los componentes) --------
const rooms = ref<Room[]>([])
const activeRoomId = ref<string | null>(null)
const peerCount = ref(0)
const syncStatus = ref<'connecting' | 'online' | 'offline'>('offline')
const myPubkey = ref<string | null>(null)
const myNick = ref<string>('')
const contacts = ref<PeerInfo[]>([])
const unreachable = ref(false)
// Sub-pestaña de la sala activa (compartida para que la barra lateral y el
// header puedan llevar al usuario a la sección de invitar/compartir).
const roomTab = ref<'table' | 'compare' | 'matches'>('table')
// Modal de compartir sala (QR + enlace + redes), abierto desde header/sidebar.
const roomShareOpen = ref(false)

let sync: RoomSync | null = null
let inited = false

const activeRoom = computed(() => rooms.value.find((r) => r.id === activeRoomId.value) ?? null)

function persist () { saveRooms(rooms.value) }

/** Re-lee las salas desde localStorage (tras una escritura externa). */
function reloadRooms () {
  rooms.value = loadRooms()
}

async function loadIdentityInfo () {
  const idi = await getIdentity()
  if (!idi) { unreachable.value = true; return }
  unreachable.value = false
  myPubkey.value = idi.me?.publickey ?? null
  myNick.value = idi.me?.nickname ?? ''
  contacts.value = await idi.listContacts().catch(() => [])
}

async function initRooms () {
  rooms.value = loadRooms()
  await loadIdentityInfo()
  inited = true
  void inited
  // Restaura la última sala activa (sin arrancar sync hasta entrar a la sección).
  const last = getActiveRoomId()
  if (last && rooms.value.some((r) => r.id === last)) activeRoomId.value = last
  // Rehidratación desde el store del ecosistema, en segundo plano (no bloquea).
  hydrateRooms(rooms.value)
    .then(({ rooms: merged, changed }) => { if (changed) { rooms.value = merged; saveRooms(merged) } })
    .catch(() => { /* sin nube, seguimos local */ })
}

/** Arranca el sync de la sala activa (al entrar a la sección Salas). */
function ensureSync () {
  const r = activeRoom.value
  if (r && !sync) startSync(r)
}

// --- Sincronización ---------------------------------------------------------
function startSync (room: Room) {
  stopSync()
  const myEnv = room.members.find((m) => m.publickey === myPubkey.value)?.env ?? null
  sync = new RoomSync(room.id, myEnv, {
    onPrediction: (env) => applyEnvelope(env),
    onPeerCount: (n) => { peerCount.value = n },
    onStatus: (s) => { syncStatus.value = s },
    // Miembros conocidos (sin mí): para entrega online + cola offline por pubkey.
    memberPubkeys: () => {
      const r = activeRoom.value
      if (!r) return []
      return r.members.map((m) => m.publickey).filter((pk) => pk && pk !== myPubkey.value)
    },
    // Todos los sobres firmados que conozco, para reenviarlos (gossip).
    allEnvelopes: () => {
      const r = activeRoom.value
      if (!r) return []
      return r.members.map((m) => m.env).filter((e): e is string => !!e)
    },
  })
  sync.start()
}

function stopSync () {
  if (sync) { sync.stop(); sync = null }
  peerCount.value = 0
  syncStatus.value = 'offline'
}

/** Re-difunde mi sobre (aporte o retract) en la sala activa. */
function updateSyncFrag (env: string | null) {
  sync?.updateMyEnv(env)
}

/** Difunde un sobre puntual (reenvío de un amigo / su retiro) en la sala activa. */
function broadcastEnvelope (env: string) {
  sync?.broadcastEnv(env)
}

/**
 * Aplica un sobre firmado recibido a la sala que indica (verificado y por
 * last-write-wins). Sirve tanto para la sync de la sala activa como para el
 * buzón GLOBAL (aportes que el proxy entregó por la cola offline al reconectar,
 * aunque no estés mirando esa sala). Como el sobre va firmado, reenviarlo es
 * seguro y un retract solo lo aplica quien lo firmó.
 */
async function applyEnvelope (env: string) {
  const parsed = await memberFromEnvelope(env)
  if (!parsed || !parsed.member.verified) return // identidad obligatoria
  const room = rooms.value.find((r) => r.id === parsed.roomId)
  if (!room) return
  if (upsertMember(room, parsed.member)) persist()
}

// --- Navegación -------------------------------------------------------------
function openRoom (id: string) {
  activeRoomId.value = id
  setActiveRoomId(id)
  roomTab.value = 'table'
  const r = activeRoom.value
  if (r) startSync(r)
}

/** Abre la sala y el modal de compartir (QR + enlace + redes). */
function shareRoom (id: string) {
  openRoom(id)
  roomShareOpen.value = true
}

function closeRoom () {
  stopSync()
  activeRoomId.value = null
  setActiveRoomId(null)
}

// --- Crear / unirse / salir -------------------------------------------------
async function createRoom (input: { name: string; mode: RoomMode; scope: RoomScope; sealed: boolean; daily?: boolean }): Promise<Room | null> {
  const idi = await getIdentity()
  if (!idi?.me?.publickey) { unreachable.value = true; return null }
  const now = Date.now()
  const room: Room = {
    id: genRoomId(),
    name: input.name.trim().slice(0, 60),
    mode: input.mode,
    scope: input.scope,
    // Las salas de la fecha no tienen sello global: cada partido se "abre" solo
    // al kickoff (la máscara por partido vive en las vistas de la sala).
    sealedUntil: input.daily ? 0 : (input.sealed ? TOURNAMENT_START : 0),
    daily: input.daily || undefined,
    hostPubkey: idi.me.publickey,
    hostNick: idi.me.nickname || undefined,
    mine: true,
    createdAt: now,
    updatedAt: now,
    members: [],
  }
  rooms.value.push(room)
  persist()
  openRoom(room.id)
  return room
}

function extractFragment (text: string): string {
  const s = text.trim()
  const h = s.lastIndexOf('#')
  return h >= 0 ? s.slice(h + 1) : s
}

/** Une por enlace de invitación pegado. Devuelve el id de sala o lanza. */
async function joinByLink (text: string): Promise<string> {
  const parsed = await parseRoomInvite(extractFragment(text))
  if (!parsed) throw new Error('invalid')
  return upsertRoomFromInvite(parsed.id, parsed.name, parsed.mode, parsed.scope, parsed.sealedUntil, parsed.hostPubkey, parsed.createdAt, parsed.daily)
}

/** Crea/actualiza una sala desde un descriptor de invitación ya verificado. */
function upsertRoomFromInvite (id: string, name: string, mode: RoomMode, scope: RoomScope, sealedUntil: number, hostPubkey: string, createdAt: number, daily?: boolean): string {
  let room = rooms.value.find((r) => r.id === id)
  if (!room) {
    room = {
      id, name, mode, scope, sealedUntil, daily: daily || undefined, hostPubkey,
      mine: hostPubkey === myPubkey.value,
      createdAt, updatedAt: Date.now(), members: [],
    }
    rooms.value.push(room)
    persist()
  }
  return id
}

function leaveRoom (id: string) {
  rooms.value = rooms.value.filter((r) => r.id !== id)
  persist()
  if (activeRoomId.value === id) closeRoom()
}

// --- Contribución AUTOMÁTICA del pronóstico de la FECHA ----------------------
// En una sala de la fecha el aporte cambia cada día (los partidos de hoy), así
// que el aporte es automático: en TODA sala de la fecha donde estoy (haya
// aportado antes o no) se publica/refresca en silencio mi entrada diaria
// (firmada + sellos por partido). Única excepción: si me borré a propósito
// (lápida mía), se respeta. Con `onlyIfChanged` se omiten las salas cuyo
// aporte vigente ya es este mismo código (no re-firmar sin cambios). El sobre
// queda guardado en el miembro: la próxima sync de cada sala lo difunde.
async function recontributeDaily (entry: SavedPrediction, opts?: { onlyIfChanged?: boolean }): Promise<void> {
  const mine = rooms.value.filter((r) => {
    if (!r.daily) return false
    const m = r.members.find((mm) => mm.publickey === myPubkey.value)
    if (m?.deleted) return false
    if (opts?.onlyIfChanged && m && !m.via && m.code === entry.code) return false
    return true
  })
  if (!mine.length) return
  try {
    const idi = await getIdentity()
    if (!idi?.me?.nickname) return // sin apodo no se firma: el aporte queda manual
    const { url } = await buildShareUrl(entry.code, entry.name, null)
    const frag = url.split('#')[1] ?? ''
    if (!frag) return
    const ds = dailySealsForEnvelope(entry)
    for (const room of mine) {
      const env = await buildMemberEnvelope(room.id, frag, Date.now(), ds)
      const parsed = await memberFromEnvelope(env)
      if (!parsed || !parsed.member.verified) continue
      parsed.member.nickname = parsed.member.nickname || idi.me.nickname || undefined
      upsertMember(room, parsed.member)
      if (room.id === activeRoomId.value) updateSyncFrag(env)
    }
    persist()
  } catch { /* best-effort: el aporte manual sigue disponible */ }
}

// --- Importación desde enlaces (#room= / #rm=) ------------------------------
async function importRoomInvite (frag: string): Promise<string | null> {
  const parsed = await parseRoomInvite(frag)
  if (!parsed) return null
  reloadRooms()
  return upsertRoomFromInvite(parsed.id, parsed.name, parsed.mode, parsed.scope, parsed.sealedUntil, parsed.hostPubkey, parsed.createdAt, parsed.daily)
}

async function importMemberContrib (frag: string): Promise<string | null> {
  const parsed = parseMemberContrib(frag)
  if (!parsed) return null
  const env = await memberFromEnvelope(parsed.env)
  if (!env || !env.member.verified) return null
  reloadRooms()
  const room = rooms.value.find((r) => r.id === env.roomId)
  if (!room) return 'NOROOM'
  upsertMember(room, env.member)
  persist()
  return env.roomId
}

export function useRooms () {
  return {
    rooms, activeRoom, activeRoomId, peerCount, syncStatus, myPubkey, myNick, contacts, unreachable, roomTab, roomShareOpen,
    initRooms, reloadRooms, loadIdentityInfo,
    openRoom, shareRoom, closeRoom, createRoom, joinByLink, leaveRoom, persist,
    startSync, stopSync, ensureSync, updateSyncFrag, broadcastEnvelope,
    importRoomInvite, importMemberContrib, applyEnvelope, getActiveRoomId,
    recontributeDaily,
  }
}
