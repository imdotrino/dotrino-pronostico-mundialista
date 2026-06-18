// Enlaces de SALA: invitación (descriptor firmado por el creador) y contribución
// (el pronóstico firmado de un miembro asociado a una sala). Reutiliza el
// empaquetado de blob firmado de share.ts (punto comprimido P-256 + ECDSA).
//
// Dos formas de fragmento (#...):
//   #room=<blob>   → descriptor de sala firmado por el creador (invitación)
//   #rm=<b64url>   → contribución de un miembro: { r:roomId, f:fragPronóstico }
//
// El pronóstico que aporta un miembro es un enlace de pronóstico NORMAL (el
// mismo blob firmado de share.ts), así reusamos toda la verificación existente.

import { signBlob, verifyBlob, parseShareFragment, SHARE_BASE } from './share'
import { decodePrediction } from './codec'
import { verifyMatchPick } from './matchday'
import type { Room, RoomMode, RoomScope, RoomMember } from './roomStore'

export const ROOM_PAYLOAD_VERSION = 2

/** Inicio del Mundial 2026 (primer partido): tope de "sellado" por defecto. */
export const TOURNAMENT_START = Date.UTC(2026, 5, 11, 0, 0, 0)

export const ROOM_INVITE_PREFIX = 'room='
export const ROOM_MEMBER_PREFIX = 'rm='

// --- Descriptor de sala (lo que firma el creador) ---------------------------

interface RoomDescriptor {
  i: string // id
  n: string // nombre
  m: RoomMode // modo exigido
  sc?: RoomScope // alcance exigido (opcional; ausente = 'free' en invitaciones legacy)
  s: number // sealedUntil (0 = visible)
  c: number // createdAt
  d?: 1 // sala del PRONÓSTICO DE LA FECHA (clientes viejos ignoran el campo)
}

/** Datos mínimos del creador para construir la invitación. */
export interface RoomInit {
  id: string
  name: string
  mode: RoomMode
  scope: RoomScope
  sealedUntil: number
  createdAt: number
  daily?: boolean
}

/** Firma el descriptor de la sala y arma el enlace de invitación. */
export async function buildRoomInviteUrl (init: RoomInit): Promise<{ url: string; hostPubkey: string; hostNick?: string }> {
  const desc: RoomDescriptor = { i: init.id, n: init.name.slice(0, 60), m: init.mode, sc: init.scope, s: init.sealedUntil, c: init.createdAt }
  if (init.daily) desc.d = 1
  const { blob, publickey, nickname } = await signBlob(JSON.stringify(desc), ROOM_PAYLOAD_VERSION)
  return { url: `${SHARE_BASE}#${ROOM_INVITE_PREFIX}${blob}`, hostPubkey: publickey, hostNick: nickname }
}

export interface ParsedRoomInvite {
  id: string
  name: string
  mode: RoomMode
  scope: RoomScope
  sealedUntil: number
  createdAt: number
  hostPubkey: string
  verified: boolean
  daily: boolean
}

/** Lee y verifica el descriptor de sala de un fragmento `room=<blob>`. */
export async function parseRoomInvite (frag: string): Promise<ParsedRoomInvite | null> {
  const blob = frag.startsWith(ROOM_INVITE_PREFIX) ? frag.slice(ROOM_INVITE_PREFIX.length) : frag
  const res = await verifyBlob(blob, ROOM_PAYLOAD_VERSION)
  if (!res) return null
  let desc: RoomDescriptor
  try { desc = JSON.parse(res.content) } catch { return null }
  if (!desc?.i || !desc?.n) return null
  return {
    id: String(desc.i),
    name: String(desc.n),
    mode: (desc.m ?? 'free') as RoomMode,
    scope: (desc.sc ?? 'free') as RoomScope,
    sealedUntil: Number(desc.s) || 0,
    createdAt: Number(desc.c) || Date.now(),
    hostPubkey: res.publickey,
    verified: res.verified,
    daily: desc.d === 1,
  }
}

// --- Aporte de un miembro: SOBRE FIRMADO con ts del autor --------------------
//
// El aporte viaja como un sobre que el autor FIRMA con su vault:
//   { r:roomId, f:fragFirmado, t:tsAutor }            contribución (v3)
//   { r:roomId, d:1,           t:tsAutor }            retract (tombstone, v3)
// El `t` (ms del reloj del autor) ordena versiones: re-aportar o BORRAR le gana
// a lo anterior (last-write-wins por `t`). Como el sobre va firmado:
//   - un peer puede REENVIAR sobres ajenos sin poder alterarlos (gossip seguro),
//   - solo el autor puede borrar lo suyo (nadie puede falsear el borrado ajeno).
//
// REENVÍO (v4): un miembro puede aportar el pronóstico FIRMADO de un amigo (lo
// importó por enlace; el frag original del amigo prueba la autoría por sí solo):
//   { r, f:fragDelAmigo, t, n?:nickAportador }        aporte de amigo
//   { r, d:1, s:pubkeyDelAmigo, t }                   retiro de MI reenvío
// El sobre lo firma el APORTADOR (≠ autor del frag). Va con byte de versión 4:
// los clientes viejos lo descartan en silencio (no crashean). La precedencia la
// resuelve upsertMember: lo del propio autor SIEMPRE le gana a un reenvío.

export const MEMBER_ENV_VERSION = 3
export const MEMBER_FWD_VERSION = 4

// `ds` (opcional, salas de la FECHA): sellos POR PARTIDO del TSA — id interno →
// { t: ts, s: firma b64url } — atados al marcador aportado y al autor. Clientes
// viejos lo ignoran (JSON con campo extra) sin romper nada.
export type DailySealsWire = Record<number, { t: number; s: string }>

interface MemberEnv { r: string; f?: string; d?: 1; t: number; s?: string; n?: string; ds?: DailySealsWire }

/** Firma el sobre de contribución (mi pronóstico) para una sala. `dailySeals`:
 *  sellos por partido (solo salas de la fecha). */
export async function buildMemberEnvelope (roomId: string, frag: string, ts: number, dailySeals?: DailySealsWire): Promise<string> {
  const env: MemberEnv = { r: roomId, f: frag, t: ts }
  if (dailySeals && Object.keys(dailySeals).length) env.ds = dailySeals
  const { blob } = await signBlob(JSON.stringify(env), MEMBER_ENV_VERSION)
  return blob
}

/** Firma el sobre de RETRACT (tombstone): borra mi aporte de la sala. */
export async function buildRetractEnvelope (roomId: string, ts: number): Promise<string> {
  const env: MemberEnv = { r: roomId, d: 1, t: ts }
  const { blob } = await signBlob(JSON.stringify(env), MEMBER_ENV_VERSION)
  return blob
}

/** Firma el sobre de REENVÍO: aporto a la sala el pronóstico firmado de un amigo. */
export async function buildForwardEnvelope (roomId: string, frag: string, ts: number, nick?: string): Promise<string> {
  const env: MemberEnv = { r: roomId, f: frag, t: ts }
  if (nick) env.n = nick.slice(0, 40)
  const { blob } = await signBlob(JSON.stringify(env), MEMBER_FWD_VERSION)
  return blob
}

/** Firma el retiro de MI reenvío del pronóstico del amigo `authorPubkey`. */
export async function buildForwardRetractEnvelope (roomId: string, authorPubkey: string, ts: number): Promise<string> {
  const env: MemberEnv = { r: roomId, d: 1, s: authorPubkey, t: ts }
  const { blob } = await signBlob(JSON.stringify(env), MEMBER_FWD_VERSION)
  return blob
}

/** Arma el enlace `#rm=` con el sobre firmado del aporte de un miembro. */
export function buildMemberContribUrl (envBlob: string): string {
  return `${SHARE_BASE}#${ROOM_MEMBER_PREFIX}${envBlob}`
}

export interface ParsedMemberContrib { env: string }

/** Lee el sobre de un fragmento `rm=<blob>`. */
export function parseMemberContrib (frag: string): ParsedMemberContrib | null {
  const env = frag.startsWith(ROOM_MEMBER_PREFIX) ? frag.slice(ROOM_MEMBER_PREFIX.length) : frag
  return env ? { env } : null
}

export interface ParsedMemberEnv { roomId: string; member: RoomMember }

/**
 * Verifica un sobre firmado y arma el miembro (o el tombstone si es retract).
 * v3 (aporte propio): el sobre debe firmarlo el MISMO autor del pronóstico.
 * v4 (reenvío): el sobre lo firma OTRO miembro (`via`); la autoría la prueba la
 * firma del amigo dentro del frag (obligatoria). Null si inválido.
 */
export async function memberFromEnvelope (envBlob: string): Promise<ParsedMemberEnv | null> {
  const v3 = await verifyBlob(envBlob, MEMBER_ENV_VERSION)
  const res = v3 ?? await verifyBlob(envBlob, MEMBER_FWD_VERSION)
  if (!res || !res.verified) return null
  const isFwd = !v3
  let env: MemberEnv
  try { env = JSON.parse(res.content) } catch { return null }
  if (!env.r || typeof env.t !== 'number') return null
  const signer = res.publickey
  if (env.d) {
    if (isFwd) {
      // Retiro de un reenvío: la lápida apunta al AUTOR (s) pero la firma el
      // aportador (via). upsertMember solo la aplica sobre SU propio reenvío.
      if (typeof env.s !== 'string' || !env.s) return null
      return {
        roomId: env.r,
        member: { publickey: env.s, verified: true, deleted: true, frag: '', code: '', env: envBlob, version: env.t, via: signer, updatedAt: Date.now() },
      }
    }
    return {
      roomId: env.r,
      member: { publickey: signer, verified: true, deleted: true, frag: '', code: '', env: envBlob, version: env.t, updatedAt: Date.now() },
    }
  }
  if (!env.f) return null
  const m = await memberFromFrag(env.f)
  if (!m) return null
  // Sellos por partido (salas de la fecha): se VERIFICAN aquí, uno a uno, contra
  // el TSA pineado + el marcador aportado + la pubkey del AUTOR del frag. Solo
  // los válidos entran a `proof`; un sello falso/ajeno simplemente no prueba nada.
  if (env.ds && typeof env.ds === 'object') {
    const proof: Record<number, number> = {}
    const entries = Object.entries(env.ds).slice(0, 128)
    for (const [k, sl] of entries) {
      const id = Number(k)
      const r = m.results?.[id]
      if (!r || !sl || typeof sl.t !== 'number' || typeof sl.s !== 'string') continue
      if (await verifyMatchPick(id, r, m.publickey, { ts: sl.t, sig: sl.s })) proof[id] = sl.t
    }
    if (Object.keys(proof).length) m.proof = proof
  }
  if (isFwd) {
    // La confianza viene SOLO de la firma del amigo dentro del frag: obligatoria.
    if (!m.verified) return null
    if (m.publickey !== signer) {
      m.via = signer
      if (env.n) m.viaNick = String(env.n).slice(0, 40)
    } // si me reenvío a mí mismo, cuenta como aporte propio (sin via)
  } else if (m.publickey !== signer) {
    return null // v3: el sobre debe firmarlo el mismo autor del pronóstico
  }
  m.env = envBlob
  m.version = env.t
  m.updatedAt = Date.now()
  return { roomId: env.r, member: m }
}

/** Reconoce el tipo de fragmento de la URL. */
export function fragKind (frag: string): 'room' | 'member' | 'prediction' {
  if (frag.startsWith(ROOM_INVITE_PREFIX)) return 'room'
  if (frag.startsWith(ROOM_MEMBER_PREFIX)) return 'member'
  return 'prediction'
}

/** ¿El pronóstico de un miembro respeta el modo exigido por la sala? */
export function modeAllowed (roomMode: RoomMode, predMode: string | undefined): boolean {
  if (roomMode === 'free') return true
  return roomMode === predMode
}

/** ¿El pronóstico de un miembro respeta el alcance exigido por la sala? Las
 *  salas legacy no tienen scope (undefined) → se tratan como 'free'. */
export function scopeAllowed (roomScope: RoomScope | undefined, predScope: string | undefined): boolean {
  if (!roomScope || roomScope === 'free') return true
  return roomScope === (predScope ?? 'all')
}

/**
 * Verifica un fragmento de pronóstico firmado y arma el miembro de sala
 * correspondiente (decodifica modo y resultados del código). Null si no es válido.
 */
export async function memberFromFrag (frag: string): Promise<RoomMember | null> {
  const parsed = await parseShareFragment(frag)
  if (!parsed) return null
  let mode: RoomMember['mode']
  let scope: RoomMember['scope']
  let results: RoomMember['results']
  try { const p = decodePrediction(parsed.code); mode = p.mode; scope = p.scope; results = p.results } catch { /* */ }
  return {
    publickey: parsed.publickey,
    nickname: parsed.nickname,
    verified: parsed.verified,
    name: parsed.name,
    frag,
    code: parsed.code,
    mode,
    scope,
    results,
    sealedAt: parsed.sealedAt,
    sealValid: parsed.sealValid,
    updatedAt: Date.now(),
  }
}

/** Genera un id de sala estable. */
export function genRoomId (): string {
  return crypto.randomUUID?.() ?? 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export type { Room }
