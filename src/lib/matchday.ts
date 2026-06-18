// Pronóstico DE LA FECHA: partido a partido, día a día. A diferencia del
// pronóstico clásico (toda la llave antes del torneo), aquí el usuario predice
// cada partido ANTES de que empiece y cada pronóstico se SELLA individualmente
// con el sellador del ecosistema (signer.dotrino.com): el sello certifica que
// ese marcador, de ese autor, existió antes del kickoff.
//
// Reusa las piezas existentes:
//   - el calendario (schedule.ts) da el kickoff de los 104 partidos;
//   - los picks viven como `results` de una Prediction modo 'score' (codec
//     intacto: el código compartido viaja por share/salas sin cambios);
//   - los equipos reales de las eliminatorias salen de los RESULTADOS oficiales
//     (la misma base que alimenta los puntajes).
//
// La entrada de la librería que guarda este pronóstico es ÚNICA por cuenta
// (flag `daily` en SavedPrediction; viaja por el store del ecosistema, así que
// todos los dispositivos de la cuenta convergen a la misma).

import { GROUPS, teamById } from './teams'
import {
  GROUP_PAIRS, MATCHES_PER_GROUP, groupMatchIndex, teamAt, outcomeOf, koWinnerSide,
  type Results, type MatchResult,
} from './standings'
import { R32, ALL_LATER, roundOf, type RoundKey } from './bracket'
import { kickoffUTC } from './schedule'
import { defaultPrediction, resolveMatches, confirmStandings } from './prediction'
import { decodePrediction, encodePrediction } from './codec'
import { getIdentity } from './identity'
import { requestSeal, verifySeal, sha256Base64url } from './signer'
import { genId, type SavedPrediction, type MatchSealRecord } from './store'

// Puntos del juego de la fecha (independientes del juego clásico): acertar el
// 1X2 del partido, bono por marcador exacto y, en eliminatorias, quién avanza.
export const MATCHDAY_SCORING = {
  outcome: 3,
  exact: 3,
  advance: 2,
} as const

// Reloj inyectable SOLO para e2e (los specs fijan "hoy" para que el popup y los
// bloqueos por kickoff sean deterministas). En producción es Date.now().
export function nowMs (): number {
  const w = globalThis as { __MUNDIAL_TEST_NOW__?: number }
  return typeof w.__MUNDIAL_TEST_NOW__ === 'number' ? w.__MUNDIAL_TEST_NOW__ : Date.now()
}

// --- Fixture ----------------------------------------------------------------

export interface Fixture {
  /** id interno (groupMatchIndex 0..71 | num FIFA 73..104) */
  id: number
  /** kickoff en ms epoch (siempre conocido: el calendario cubre 104/104) */
  kickoff: number
  stage: 'group' | 'ko'
  /** grupo 0..11 (solo fase de grupos) */
  group?: number
  /** ronda (solo eliminatorias) */
  round?: RoundKey
  /** team ids; en eliminatorias null hasta que el oficial defina la llave */
  home: number | null
  away: number | null
}

/**
 * Los 104 partidos con kickoff y equipos, ordenados cronológicamente. Los cupos
 * de eliminatorias se resuelven desde la entrada OFICIAL (resultados reales);
 * mientras la llave no esté definida quedan null (aún no pronosticables).
 */
export function allFixtures (official: SavedPrediction | null): Fixture[] {
  const out: Fixture[] = []
  for (let g = 0; g < GROUPS.length; g++) {
    for (let pair = 0; pair < MATCHES_PER_GROUP; pair++) {
      const id = groupMatchIndex(g, pair)
      const iso = kickoffUTC(id)
      if (!iso) continue
      const [pa, pb] = GROUP_PAIRS[pair]!
      out.push({ id, kickoff: Date.parse(iso), stage: 'group', group: g, home: teamAt(g, pa), away: teamAt(g, pb) })
    }
  }
  // Eliminatorias: equipos reales según el avance OFICIAL (no el pronosticado).
  let resolved: Map<number, { home: number | null; away: number | null }> | null = null
  if (official?.code) {
    try {
      const p = decodePrediction(official.code)
      if (official.results) p.results = official.results
      resolved = resolveMatches(p)
    } catch { /* código oficial inválido: llaves sin equipos */ }
  }
  for (const m of [...R32, ...ALL_LATER]) {
    const iso = kickoffUTC(m.num)
    if (!iso) continue
    const rm = resolved?.get(m.num)
    out.push({
      id: m.num, kickoff: Date.parse(iso), stage: 'ko', round: roundOf(m.num),
      home: rm?.home ?? null, away: rm?.away ?? null,
    })
  }
  return out.sort((a, b) => a.kickoff - b.kickoff || a.id - b.id)
}

/** Clave de día LOCAL (YYYY-MM-DD) de un instante. */
export function dayKey (ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** ¿El partido ya empezó? (los picks se editan SOLO antes del kickoff) */
export function fixtureStarted (f: Fixture, now = nowMs()): boolean {
  return now >= f.kickoff
}

/** ¿Se puede pronosticar? Antes del kickoff y con los dos equipos definidos. */
export function fixturePredictable (f: Fixture, now = nowMs()): boolean {
  return !fixtureStarted(f, now) && f.home != null && f.away != null
}

/** Partidos del día local de `now` (para el popup diario). */
export function fixturesToday (fixtures: Fixture[], now = nowMs()): Fixture[] {
  const today = dayKey(now)
  return fixtures.filter((f) => dayKey(f.kickoff) === today)
}

/** Partidos de HOY y MAÑANA (día local de `now`), para el popup diario. */
export function fixturesTodayTomorrow (fixtures: Fixture[], now = nowMs()): Fixture[] {
  const today = dayKey(now)
  const tomorrow = dayKey(now + 86_400_000)
  return fixtures.filter((f) => {
    const k = dayKey(f.kickoff)
    return k === today || k === tomorrow
  })
}

/** Etiqueta de fase legible vía i18n: ['group.title', {letter}] o ['bracket.r32']. */
export function fixturePhaseKey (f: Fixture): { key: string; params?: Record<string, string> } {
  if (f.stage === 'group') return { key: 'group.title', params: { letter: GROUPS[f.group!]!.letter } }
  return { key: 'bracket.' + (f.round ?? 'r32') }
}

// --- Entrada única por cuenta -------------------------------------------------

/** La entrada del pronóstico de la fecha (única; flag `daily`). */
export function findDailyEntry (library: SavedPrediction[]): SavedPrediction | null {
  return library.find((p) => p.daily) ?? null
}

// Código de la entrada diaria: una Prediction 'score' cuyos `results` son los
// picks (grupos y eliminatorias). Sin picks de llaves propios: las posiciones se
// derivan de los marcadores pronosticados (inofensivo; lo que puntúa es results).
function dailyCode (results: Results): string {
  const p = defaultPrediction()
  p.mode = 'score'
  p.results = JSON.parse(JSON.stringify(results)) as Results
  confirmStandings(p)
  return encodePrediction(p)
}

/**
 * Garantiza UNA entrada diaria. Si el store de la cuenta trajo otra (creada en
 * otro dispositivo antes del sync), FUSIONA pick a pick de forma determinista
 * (gana el sello más antiguo; sin sellos, la entrada editada más recientemente)
 * y conserva siempre la de id menor, para que todos los dispositivos converjan.
 * Devuelve si modificó la librería (para persistir).
 */
export function ensureDailyEntry (library: SavedPrediction[], name: string): { entry: SavedPrediction; changed: boolean } {
  const dailies = library.filter((p) => p.daily)
  if (dailies.length === 0) {
    const entry: SavedPrediction = {
      id: genId(),
      name,
      code: dailyCode({}),
      updatedAt: Date.now(),
      mine: true,
      daily: true,
      mode: 'score',
      scope: 'all',
      results: {},
      dailySeals: {},
    }
    library.push(entry)
    return { entry, changed: true }
  }
  if (dailies.length === 1) return { entry: dailies[0]!, changed: false }

  // Duplicadas (carrera de creación entre dispositivos): merge determinista.
  dailies.sort((a, b) => (a.id < b.id ? -1 : 1))
  const winner = dailies[0]!
  const results: Results = JSON.parse(JSON.stringify(winner.results ?? {}))
  const seals: Record<number, MatchSealRecord> = { ...(winner.dailySeals ?? {}) }
  for (const other of dailies.slice(1)) {
    for (const k of Object.keys(other.results ?? {})) {
      const id = Number(k)
      const r = other.results![id]!
      const os = other.dailySeals?.[id]
      const ws = seals[id]
      const otherWins = !results[id] ||
        (os && (!ws || os.ts < ws.ts)) ||
        (!os && !ws && (other.updatedAt || 0) > (winner.updatedAt || 0))
      if (otherWins) {
        results[id] = JSON.parse(JSON.stringify(r))
        if (os) seals[id] = os
        else delete seals[id]
      }
    }
  }
  winner.results = results
  winner.dailySeals = seals
  winner.code = dailyCode(results)
  winner.updatedAt = Math.max(...dailies.map((d) => d.updatedAt || 0))
  for (const other of dailies.slice(1)) {
    const i = library.indexOf(other)
    if (i >= 0) library.splice(i, 1)
  }
  return { entry: winner, changed: true }
}

// --- Sello POR PARTIDO --------------------------------------------------------
// "Sella cada uno de ellos": cada pick lleva su propio sello del TSA, atado al
// partido + marcador + autor. Así cualquiera puede verificar que ESE pronóstico
// existió antes del kickoff, aunque la entrada completa se siga editando después
// (los partidos de mañana) — cosa que un único sello global no puede probar.

// Bytes canónicos del sello de un pick: deterministas en autor y verificador.
// `o` no entra (se deriva de los goles); ausencias normalizadas a null.
function matchSealPayload (id: number, r: MatchResult, x: string, y: string): Uint8Array {
  const arr = ['cc-mundial-fecha-v1', id, r.gh ?? null, r.ga ?? null, r.ph ?? null, r.pa ?? null, x, y]
  return new TextEncoder().encode(JSON.stringify(arr))
}

async function matchSealHash (id: number, r: MatchResult, jwkString: string): Promise<string | null> {
  try {
    const jwk = JSON.parse(jwkString) as { x?: string; y?: string }
    if (!jwk?.x || !jwk?.y) return null
    return await sha256Base64url(matchSealPayload(id, r, jwk.x, jwk.y))
  } catch { return null }
}

function b64urlToBytes (s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64url (bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Pide al TSA el sello de un pick PROPIO. Null si no hay identidad/sellador. */
export async function sealMatchPick (id: number, r: MatchResult): Promise<MatchSealRecord | null> {
  const idi = await getIdentity()
  if (!idi?.me?.publickey) return null
  const hash = await matchSealHash(id, r, idi.me.publickey)
  if (!hash) return null
  const seal = await requestSeal(hash)
  if (!seal) return null
  return { ts: seal.ts, sig: bytesToB64url(seal.sig) }
}

/** Verifica el sello de un pick de `authorPubkey` (JWK string). */
export async function verifyMatchPick (id: number, r: MatchResult, authorPubkey: string, seal: { ts: number; sig: string }): Promise<boolean> {
  const hash = await matchSealHash(id, r, authorPubkey)
  if (!hash) return false
  try { return await verifySeal(hash, seal.ts, b64urlToBytes(seal.sig)) } catch { return false }
}

/**
 * Aplica picks a la entrada diaria (resultados + código + updatedAt) y SELLA
 * cada uno (best-effort: si el sellador no responde, el pick queda guardado sin
 * sello y se puede reintentar). Devuelve cuántos sellos se consiguieron.
 */
export async function applyDailyPicks (
  entry: SavedPrediction,
  picks: { id: number; r: MatchResult }[],
): Promise<{ sealed: number; failed: number }> {
  if (!picks.length) return { sealed: 0, failed: 0 }
  const results: Results = entry.results ?? {}
  const seals: Record<number, MatchSealRecord> = entry.dailySeals ?? {}
  for (const { id, r } of picks) {
    results[id] = JSON.parse(JSON.stringify(r)) as MatchResult
    delete seals[id] // el sello anterior era de otro marcador: ya no aplica
  }
  entry.results = results
  entry.dailySeals = seals
  entry.code = dailyCode(results)
  entry.updatedAt = Date.now()

  let sealed = 0
  let failed = 0
  for (const { id, r } of picks) {
    const s = await sealMatchPick(id, r)
    if (s) { seals[id] = s; sealed++ } else failed++
  }
  return { sealed, failed }
}

/** Reintenta sellar los picks SIN sello (sellador caído al guardar). */
export async function sealMissingPicks (entry: SavedPrediction): Promise<number> {
  const results = entry.results ?? {}
  const seals = entry.dailySeals ?? (entry.dailySeals = {})
  let ok = 0
  for (const k of Object.keys(results)) {
    const id = Number(k)
    if (seals[id]) continue
    const s = await sealMatchPick(id, results[id]!)
    if (s) { seals[id] = s; ok++ }
  }
  return ok
}

/** Mapa partido → instante certificado (ms) de los sellos PROPIOS guardados. */
export function dailyProofMap (entry: SavedPrediction | null): Record<number, number> {
  const out: Record<number, number> = {}
  if (!entry?.dailySeals) return out
  for (const k of Object.keys(entry.dailySeals)) out[Number(k)] = entry.dailySeals[Number(k)]!.ts
  return out
}

/** Sellos por partido en el formato compacto que viaja en el sobre de sala. */
export function dailySealsForEnvelope (entry: SavedPrediction): Record<number, { t: number; s: string }> {
  const out: Record<number, { t: number; s: string }> = {}
  for (const k of Object.keys(entry.dailySeals ?? {})) {
    const id = Number(k)
    const s = entry.dailySeals![id]!
    out[id] = { t: s.ts, s: s.sig }
  }
  return out
}

// --- Puntaje de la fecha --------------------------------------------------------

export interface MatchdayMatchScore {
  outcome: boolean
  exact: boolean
  advance: boolean
  /** el pick cuenta (en salas: sello válido ANTES del kickoff) */
  counted: boolean
  pts: number
}

export interface MatchdayScore {
  total: number
  /** nº de partidos con pick que puntúan */
  counted: number
  /** nº de partidos con pick descartados por falta de sello a tiempo (estricto) */
  uncounted: number
  per: Map<number, MatchdayMatchScore>
}

/**
 * Puntúa picks de la fecha contra la entrada oficial, partido a partido.
 * `proof` (partido → ts certificado): en modo `strict` (salas) un pick solo
 * cuenta si su sello existe y es ANTERIOR al kickoff; sin `strict` (vista
 * propia) cuentan todos (la UI ya impide editar tras el kickoff).
 */
export function scoreMatchdayPicks (
  picks: Results | undefined,
  proof: Record<number, number> | null | undefined,
  official: SavedPrediction | null,
  strict: boolean,
): MatchdayScore {
  const per = new Map<number, MatchdayMatchScore>()
  const res: MatchdayScore = { total: 0, counted: 0, uncounted: 0, per }
  const or = official?.results
  if (!picks || !or) return res
  for (const k of Object.keys(picks)) {
    const id = Number(k)
    const mine = picks[id]
    const real = or[id]
    if (!mine) continue
    const kickIso = kickoffUTC(id)
    const kick = kickIso ? Date.parse(kickIso) : 0
    const proven = proof?.[id] != null && kick > 0 && proof[id]! <= kick
    const counted = strict ? proven : true
    if (!counted) { res.uncounted++; per.set(id, { outcome: false, exact: false, advance: false, counted, pts: 0 }); continue }
    res.counted++
    if (!real) { per.set(id, { outcome: false, exact: false, advance: false, counted, pts: 0 }); continue }
    const outcome = outcomeOf(mine) != null && outcomeOf(mine) === outcomeOf(real)
    const exact = outcome &&
      typeof mine.gh === 'number' && typeof mine.ga === 'number' &&
      mine.gh === real.gh && mine.ga === real.ga
    // En eliminatorias además puntúa acertar quién AVANZA (con penales si hubo).
    const advance = id > 71 && koWinnerSide(mine) != null && koWinnerSide(mine) === koWinnerSide(real)
    const pts = (outcome ? MATCHDAY_SCORING.outcome : 0) +
      (exact ? MATCHDAY_SCORING.exact : 0) +
      (advance ? MATCHDAY_SCORING.advance : 0)
    per.set(id, { outcome, exact, advance, counted, pts })
    res.total += pts
  }
  return res
}

// --- Popup diario ---------------------------------------------------------------

/**
 * ¿Corresponde mostrar el popup? Hay partidos HOY o MAÑANA aún pronosticables
 * sin pick. INSISTE en cada apertura/recarga mientras falten picks (cerrarlo
 * solo lo oculta en la sesión actual); con todo pronosticado deja de salir.
 */
export function shouldShowDailyPopup (fixtures: Fixture[], entry: SavedPrediction | null, now = nowMs()): boolean {
  const picks = entry?.results ?? {}
  return fixturesTodayTomorrow(fixtures, now).some((f) => fixturePredictable(f, now) && !picks[f.id])
}

export { teamById }
