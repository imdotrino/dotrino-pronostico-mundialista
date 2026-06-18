// Cliente del relay de resultados oficiales (results.dotrino.com). Trae el feed
// FIRMADO, lo verifica contra la pubkey PINEADA del relay y lo mapea a la entrada
// de "Resultados oficiales" del pronosticador (results + picks + code), para que
// el puntaje de todos se recalcule solo.
//
// "Solo relay": la app NUNCA pega a ESPN/FIFA; habla solo con el relay, que
// centraliza proveedores + fallback + cache + overrides manuales (state of truth)
// en un solo punto. El feed es app-agnóstico (partidos por código FIFA); el mapeo
// al fixture interno lo hace ACÁ (par de códigos en grupos; resolución de llave
// en eliminatorias).

import { TEAMS, teamById } from './teams'
import {
  GROUP_PAIRS, groupMatchIndex, teamAt, koWinnerSide, outcomeOf,
  type Results, type MatchResult,
} from './standings'
import { defaultPrediction, confirmStandings, resolveMatches, type Prediction } from './prediction'
import { R32, R16, QF, SF, THIRD_PLACE, FINAL } from './bracket'
import { encodePrediction } from './codec'
import { kickoffUTC } from './schedule'
import type { IdentityInstance } from './identity'

// URL del relay y su pubkey de SERVICIO, PINEADA (la confianza no depende de la
// pubkey que venga en el feed, sino de esta clave conocida — igual que el signer).
export const RESULTS_URL = (import.meta.env.VITE_RESULTS_URL as string | undefined) || 'https://results.dotrino.com'
export const RESULTS_PUBKEY =
  '{"kty":"EC","crv":"P-256","x":"ZDjs6CfsBVvqSqK8RHdplk_rW4yYYMADjEf1uAu5ToE","y":"XS3OQPNnN7Bo_JXzsxACk2EtVODr9vpBrk4Y2qhOUaU"}'

// Mismo corte que el relay para separar fase de grupos de eliminatorias por la
// hora de arranque (ver keys.js del relay).
const KNOCKOUT_START = Date.parse('2026-06-28T12:00:00Z')

export interface FeedMatch {
  home: string; away: string; kickoff: string | null
  status: 'scheduled' | 'in' | 'final'; started: boolean; finished: boolean
  homeGoals: number | null; awayGoals: number | null
  homePens: number | null; awayPens: number | null
  winner: string | null; source: string
}
export interface Feed {
  v: number; competition: string; updatedAt: number
  providers: string[]; providerLabels: Record<string, string>
  providerHealth: Record<string, { ok: boolean; count: number; error: string | null }>
  matches: FeedMatch[]; overrides: FeedMatch[]; publickey: string
  // Thumbprints (pubkeyId hex) de los admins autorizados a publicar. Públicos:
  // solo sirven para que la UI muestre "Publicar" a un admin (la seguridad real
  // es la verificación de firma + allowlist en el relay).
  admins?: string[]
}
export interface SignedFeed { data: Feed; signature: string }

// --- cripto (idéntico al resto del ecosistema: canónico + WebCrypto verify) ---

function canonicalStringify (v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']'
  const ks = Object.keys(v as Record<string, unknown>).sort()
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canonicalStringify((v as Record<string, unknown>)[k])).join(',') + '}'
}
function b64ToBytes (b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Verifica la firma del feed contra la pubkey PINEADA del relay. */
export async function verifyFeed (sf: SignedFeed): Promise<boolean> {
  try {
    if (!sf || !sf.data || typeof sf.signature !== 'string') return false
    // La confianza es la pubkey pineada; además exigimos que el feed la declare.
    if (sf.data.publickey !== RESULTS_PUBKEY) return false
    const jwk = JSON.parse(RESULTS_PUBKEY)
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const bytes = new TextEncoder().encode(canonicalStringify(sf.data))
    return await crypto.subtle.verify({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, b64ToBytes(sf.signature) as BufferSource, bytes as BufferSource)
  } catch { return false }
}

/** Trae el feed firmado del relay (verificado). `source` opcional para forzar
 *  una fuente ('espn'|'fifa'|'manual'|'merged'). null si no alcanza/firma inválida. */
export async function fetchOfficialFeed (source?: string): Promise<SignedFeed | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const url = RESULTS_URL + '/official' + (source && source !== 'merged' ? '?source=' + encodeURIComponent(source) : '')
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const sf = await res.json() as SignedFeed
    if (!(await verifyFeed(sf))) { console.warn('feed oficial: firma inválida (descartado)'); return null }
    return sf
  } catch { return null }
}

// --- mapeo feed → entrada oficial ---

const CODE_TO_ID = new Map(TEAMS.map((t) => [t.code, t.id]))
function pairKey (a: string, b: string): string { return [a.toUpperCase(), b.toUpperCase()].sort().join('-') }
function phaseOf (kickoff: string | null): 'grp' | 'ko' { return (Date.parse(kickoff || '') || 0) >= KNOCKOUT_START ? 'ko' : 'grp' }
function feedKey (m: FeedMatch): string { return phaseOf(m.kickoff) + ':' + pairKey(m.home, m.away) }

export interface OfficialBuild {
  results: Results
  code: string
  /** internalId (groupMatchIndex 0..71 | num FIFA 73..104) → fuente del dato. */
  provenance: Record<number, string>
  appliedGroups: number
  appliedKo: number
}

/**
 * Construye la entrada oficial (results + code) desde el feed. Los overrides
 * manuales GANAN sobre los proveedores (state of truth); los proveedores
 * rellenan el resto. Solo aplica partidos empezados/terminados.
 */
// ¿El partido del feed trae algún dato de resultado? Un override sin goles ni
// ganador no informa nada: aplicarlo TAPARÍA el dato real del proveedor.
function hasResultInfo (m: FeedMatch): boolean {
  return m.homeGoals != null || m.awayGoals != null || m.winner != null
}

export function buildOfficial (feed: Feed): OfficialBuild {
  // Lookup por clave de match; overrides al final → ganan (solo si traen dato).
  const map = new Map<string, FeedMatch>()
  for (const m of feed.matches || []) if (m.home && m.away) map.set(feedKey(m), m)
  for (const o of feed.overrides || []) if (o.home && o.away && hasResultInfo(o)) map.set(feedKey(o), o)

  const pred = defaultPrediction()
  pred.mode = 'score'
  pred.scope = 'all'
  const provenance: Record<number, string> = {}
  let appliedGroups = 0
  let appliedKo = 0

  // Fase de grupos: por par de códigos FIFA → groupMatchIndex; reorienta goles
  // a la convención del fixture (primero del par = local).
  for (let g = 0; g < 12; g++) {
    for (let p = 0; p < GROUP_PAIRS.length; p++) {
      const [pa, pb] = GROUP_PAIRS[p]!
      const homeCode = teamById(teamAt(g, pa)).code
      const awayCode = teamById(teamAt(g, pb)).code
      const fm = map.get('grp:' + pairKey(homeCode, awayCode))
      if (!fm || !fm.started || fm.homeGoals == null || fm.awayGoals == null) continue
      const homeIsFeedHome = fm.home.toUpperCase() === homeCode
      const gh = homeIsFeedHome ? fm.homeGoals : fm.awayGoals
      const ga = homeIsFeedHome ? fm.awayGoals : fm.homeGoals
      const idx = groupMatchIndex(g, p)
      pred.results[idx] = { o: gh > ga ? 0 : gh < ga ? 2 : 1, gh, ga }
      provenance[idx] = fm.source
      appliedGroups++
    }
  }

  // Deriva posiciones de los resultados de grupos (alimenta el código + llaves).
  confirmStandings(pred)

  // Eliminatorias por ronda: resolver con los picks actuales, mapear cada
  // partido (par de códigos) → su número FIFA, fijar marcador + ganador.
  const ROUNDS: number[][] = [
    R32.map((m) => m.num), R16.map((m) => m.num), QF.map((m) => m.num),
    SF.map((m) => m.num), [THIRD_PLACE.num, FINAL.num],
  ]
  for (const roundNums of ROUNDS) {
    const resolved = resolveMatches(pred)
    for (const num of roundNums) {
      const rm = resolved.get(num)
      if (!rm || rm.home == null || rm.away == null) continue
      const homeCode = teamById(rm.home).code
      const awayCode = teamById(rm.away).code
      const fm = map.get('ko:' + pairKey(homeCode, awayCode))
      if (!fm || !fm.finished || fm.homeGoals == null || fm.awayGoals == null) continue
      const homeIsFeedHome = fm.home.toUpperCase() === homeCode
      const gh = homeIsFeedHome ? fm.homeGoals : fm.awayGoals
      const ga = homeIsFeedHome ? fm.awayGoals : fm.homeGoals
      const ph = homeIsFeedHome ? fm.homePens : fm.awayPens
      const pa = homeIsFeedHome ? fm.awayPens : fm.homePens
      const r: MatchResult = { o: gh > ga ? 0 : gh < ga ? 2 : 1, gh, ga }
      if (ph != null && pa != null) { r.ph = ph; r.pa = pa }
      pred.results[num] = r
      // Ganador (incl. penales): preferimos el winner explícito del feed.
      const w = fm.winner ? fm.winner.toUpperCase() : null
      let winnerId: number | null = null
      if (w === homeCode) winnerId = rm.home
      else if (w === awayCode) winnerId = rm.away
      else { const side = koWinnerSide(r); winnerId = side === 'h' ? rm.home : side === 'a' ? rm.away : null }
      if (winnerId != null) pred.picks[num] = winnerId
      provenance[num] = fm.source
      appliedKo++
    }
  }

  return { results: pred.results, code: encodePrediction(pred), provenance, appliedGroups, appliedKo }
}

// --- publicación manual (admin firma con su vault) -------------------------

export interface OverrideItem {
  home: string; away: string; kickoff: string | null
  homeGoals?: number | null; awayGoals?: number | null
  homePens?: number | null; awayPens?: number | null
  winner?: string | null; clear?: boolean
}

function sameResult (a: MatchResult | undefined, b: MatchResult | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (a.gh ?? null) === (b.gh ?? null) && (a.ga ?? null) === (b.ga ?? null) &&
    (a.ph ?? null) === (b.ph ?? null) && (a.pa ?? null) === (b.pa ?? null) &&
    outcomeOf(a) === outcomeOf(b)
}

// internalId → códigos FIFA + kickoff + ganador (para armar el override).
function idToOverride (pred: Prediction, id: number, resolved: ReturnType<typeof resolveMatches>): OverrideItem | null {
  const r = pred.results[id]
  if (!r) return null
  let homeCode: string, awayCode: string, winnerCode: string | null = null
  if (id <= 71) {
    const g = Math.floor(id / GROUP_PAIRS.length)
    const pair = id % GROUP_PAIRS.length
    const [pa, pb] = GROUP_PAIRS[pair]!
    homeCode = teamById(teamAt(g, pa)).code
    awayCode = teamById(teamAt(g, pb)).code
  } else {
    const rm = resolved.get(id)
    if (!rm || rm.home == null || rm.away == null) return null
    homeCode = teamById(rm.home).code
    awayCode = teamById(rm.away).code
    const w = pred.picks[id]
    if (w != null) winnerCode = teamById(w).code
  }
  return {
    home: homeCode, away: awayCode, kickoff: kickoffUTC(id),
    homeGoals: r.gh ?? null, awayGoals: r.ga ?? null,
    homePens: r.ph ?? null, awayPens: r.pa ?? null, winner: winnerCode,
  }
}

/**
 * Qué publicar como manual: SOLO los partidos cuyo resultado en la entrada
 * oficial DIFIERE de lo que reportan los proveedores. Lo que coincide con el
 * proveedor no se publica (lo rellena el proveedor solo). Así "lo que ingreso
 * es el state of truth y ESPN alimenta lo que no introduje".
 */
export function buildPublishItems (pred: Prediction, feed: Feed): OverrideItem[] {
  const providerResults = buildOfficial({ ...feed, overrides: [] }).results
  const merged = buildOfficial(feed)
  const resolved = resolveMatches(pred)
  const items: OverrideItem[] = []
  for (const k of Object.keys(pred.results)) {
    const id = Number(k)
    const same = sameResult(pred.results[id], providerResults[id])
    if (same) {
      // Coincide con el proveedor pero hay un override manual DISTINTO vigente:
      // se publica un `clear` para que vuelva a mandar el proveedor.
      if (merged.provenance[id] === 'manual' && !sameResult(pred.results[id], merged.results[id])) {
        const it = idToOverride(pred, id, resolved)
        if (it) items.push({ home: it.home, away: it.away, kickoff: it.kickoff, clear: true })
      }
      continue
    }
    const it = idToOverride(pred, id, resolved)
    // Nunca publicar un override SIN dato (sin goles ni ganador): no corrige
    // nada y taparía el resultado del proveedor en todos los clientes.
    if (it && (it.homeGoals != null || it.awayGoals != null || it.winner != null)) items.push(it)
  }
  // Limpieza: overrides vacíos ya publicados (datos basura históricos) se
  // retiran del relay en la próxima publicación del admin.
  for (const o of feed.overrides || []) {
    if (o.home && o.away && !hasResultInfo(o)) items.push({ home: o.home, away: o.away, kickoff: o.kickoff, clear: true })
  }
  return items
}

export interface PublishResult { ok: boolean; status?: number; error?: string; changed?: number }

/** Firma el lote de overrides con el vault del admin y lo publica en el relay. */
export async function publishOfficial (items: OverrideItem[], id: IdentityInstance): Promise<PublishResult> {
  try {
    const me = (id as unknown as { me?: { publickey?: string } }).me?.publickey
      || (await id.signData({ op: 'probe' }) as { publickey?: string }).publickey
    if (!me) return { ok: false, error: 'sin identidad' }
    const data = { op: 'set-official', competition: 'fifa.world.2026', issuedAt: Date.now(), publickey: me, matches: items }
    const signed = await id.signData(data) as { signature: string }
    const res = await fetch(RESULTS_URL + '/admin/result', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, signature: signed.signature }),
    })
    const j = await res.json().catch(() => ({})) as { error?: string; changed?: number }
    if (!res.ok) return { ok: false, status: res.status, error: j.error || ('http ' + res.status) }
    return { ok: true, changed: j.changed }
  } catch (e) { return { ok: false, error: (e as Error)?.message || 'error' } }
}

// Thumbprint (pubkeyId hex) de una identidad: SHA-256 del JWK canónico {crv,kty,x,y}.
// Idéntico al pubkeyId del relay → sirve para saber si soy admin.
async function sha256hex (s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s) as BufferSource)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export async function pubkeyThumbprint (jwkString: string): Promise<string | null> {
  try {
    const j = JSON.parse(jwkString)
    return await sha256hex(canonicalStringify({ crv: j.crv, kty: j.kty, x: j.x, y: j.y }))
  } catch { return null }
}

/** ¿La identidad `jwkString` está en la allowlist de admins del feed? */
export async function isAdminIdentity (feed: Feed, jwkString: string | null | undefined): Promise<boolean> {
  const admins = feed.admins || []
  if (!admins.length || !jwkString) return false
  const tp = await pubkeyThumbprint(jwkString)
  return !!tp && admins.includes(tp)
}

/** Resumen de fuentes activas para la UI (etiqueta de procedencia). */
export function sourceSummary (feed: Feed): { providers: { id: string; label: string; ok: boolean; count: number }[]; overrides: number } {
  const providers = (feed.providers || []).map((id) => ({
    id,
    label: (feed.providerLabels && feed.providerLabels[id]) || id.toUpperCase(),
    ok: !!(feed.providerHealth && feed.providerHealth[id] && feed.providerHealth[id].ok),
    count: (feed.providerHealth && feed.providerHealth[id] && feed.providerHealth[id].count) || 0,
  }))
  return { providers, overrides: (feed.overrides || []).length }
}

export { CODE_TO_ID }
