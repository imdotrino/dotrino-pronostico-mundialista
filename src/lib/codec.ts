// Codificación compacta del pronóstico. Incluye TODO lo necesario para
// reconstruirlo: modo, posiciones confirmadas, llaves y resultados (goles y
// penales) de cada partido.
//
// Layout de bits (MSB primero), versión 3:
//   - versión            4 bits  (=3)
//   - modo               2 bits  (0 manual, 1 winlose, 2 score)
//   - 12 grupos × 5 bits         (rango factorial de cada permutación de 4)
//   - terceros          29 bits  (rango factorial de la permutación de 12)
//   - 32 picks × 2 bits          (0 sin decidir, 1 = home/arriba, 2 = away/abajo)
//   - resultados: cuenta 7 bits + por partido { clave 7, o 2, hayGoles 1
//       [gh 4, ga 4], hayPenales 1 [ph 4, pa 4] }  (goles/penales 0..15)
//
// Versión 4: idéntica a la 3 pero inserta el ALCANCE (scope) en 2 bits justo
// después del modo (0 all, 1 groups, 2 bracket). Para no romper nada y mantener
// compatibilidad total hacia atrás Y hacia adelante:
//   - los pronósticos con scope 'all' (el default y TODOS los previos) se
//     codifican como versión 3 (bytes idénticos a hoy; apps viejas los leen).
//   - solo los pronósticos con scope 'groups'/'bracket' usan la versión 4.
// Versiones 2 (sin modo/resultados) y 3 (sin scope) se siguen leyendo: su scope
// es 'all'.

import { GROUPS } from './teams'
import { R32, R16, QF, SF, THIRD_PLACE, FINAL } from './bracket'
import { defaultPrediction, resolveMatches, type Prediction } from './prediction'
import type { GameMode, Scope, MatchResult } from './standings'

const VERSION_UNSCOPED = 3 // 'all' → formato clásico (compatible con apps viejas)
const VERSION_SCOPED = 4 // 'groups'/'bracket' → añade 2 bits de scope tras el modo

const MODES: GameMode[] = ['manual', 'winlose', 'score']
function modeToCode (m: GameMode): number { const i = MODES.indexOf(m); return i < 0 ? 0 : i }
function codeToMode (n: number): GameMode { return MODES[n] ?? 'manual' }

const SCOPES: Scope[] = ['all', 'groups', 'bracket']
function scopeToCode (s: Scope): number { const i = SCOPES.indexOf(s); return i < 0 ? 0 : i }
function codeToScope (n: number): Scope { return SCOPES[n] ?? 'all' }
const cap15 = (v: number): number => Math.max(0, Math.min(15, Math.floor(v)))

// Orden fijo de partidos para los picks (debe permanecer estable).
export const PICK_ORDER: number[] = [
  ...R32.map((m) => m.num),
  ...R16.map((m) => m.num),
  ...QF.map((m) => m.num),
  ...SF.map((m) => m.num),
  THIRD_PLACE.num,
  FINAL.num,
]

// ---- permutaciones (sistema factorial / código de Lehmer) ----------------

function factorial (n: number): number {
  let f = 1
  for (let i = 2; i <= n; i++) f *= i
  return f
}

function permToIndex (perm: number[], base: number[]): number {
  const remaining = [...base]
  const n = base.length
  let rank = 0
  for (let i = 0; i < n; i++) {
    const pos = remaining.indexOf(perm[i]!)
    rank += pos * factorial(n - 1 - i)
    remaining.splice(pos, 1)
  }
  return rank
}

function indexToPerm (rank: number, base: number[]): number[] {
  const remaining = [...base]
  const n = base.length
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const f = factorial(n - 1 - i)
    const pos = Math.floor(rank / f)
    rank %= f
    out.push(remaining[pos]!)
    remaining.splice(pos, 1)
  }
  return out
}

// ---- escritor/lector de bits ----------------------------------------------

class BitWriter {
  private bits: number[] = []
  write (value: number, nbits: number) {
    for (let i = nbits - 1; i >= 0; i--) this.bits.push((value >> i) & 1)
  }
  toBytes (): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8))
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >> 3]! |= 1 << (7 - (i & 7))
    }
    return bytes
  }
}

class BitReader {
  private pos = 0
  private bytes: Uint8Array
  constructor (bytes: Uint8Array) { this.bytes = bytes }
  read (nbits: number): number {
    let v = 0
    for (let i = 0; i < nbits; i++) {
      const bit = ((this.bytes[this.pos >> 3] ?? 0) >> (7 - (this.pos & 7))) & 1
      v = (v << 1) | bit
      this.pos++
    }
    return v
  }
}

// ---- base64url -------------------------------------------------------------

function bytesToB64url (bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes (s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ---- API -------------------------------------------------------------------

function writeResults (w: BitWriter, results: Record<number, MatchResult>): void {
  const keys = Object.keys(results).map(Number).filter((k) => results[k])
  w.write(keys.length, 7) // hasta 104 partidos (< 128)
  for (const key of keys) {
    const res = results[key]!
    w.write(key, 7)
    w.write(res.o, 2)
    const hasG = typeof res.gh === 'number' && typeof res.ga === 'number'
    w.write(hasG ? 1 : 0, 1)
    if (hasG) { w.write(cap15(res.gh!), 4); w.write(cap15(res.ga!), 4) }
    const hasP = typeof res.ph === 'number' && typeof res.pa === 'number'
    w.write(hasP ? 1 : 0, 1)
    if (hasP) { w.write(cap15(res.ph!), 4); w.write(cap15(res.pa!), 4) }
  }
}

function readResults (r: BitReader): Record<number, MatchResult> {
  const out: Record<number, MatchResult> = {}
  const n = r.read(7)
  for (let i = 0; i < n; i++) {
    const key = r.read(7)
    const res: MatchResult = { o: r.read(2) as 0 | 1 | 2 }
    if (r.read(1)) { res.gh = r.read(4); res.ga = r.read(4) }
    if (r.read(1)) { res.ph = r.read(4); res.pa = r.read(4) }
    out[key] = res
  }
  return out
}

export function encodePrediction (p: Prediction): string {
  const w = new BitWriter()
  // scope 'all' → versión 3 clásica (sin bits de scope); resto → versión 4.
  const scope = p.scope ?? 'all'
  const scoped = scope !== 'all'
  w.write(scoped ? VERSION_SCOPED : VERSION_UNSCOPED, 4)
  w.write(modeToCode(p.mode), 2)
  if (scoped) w.write(scopeToCode(scope), 2)
  for (let g = 0; g < 12; g++) {
    const base = GROUPS[g]!.teams.map((t) => t.id)
    w.write(permToIndex(p.groupOrder[g]!, base), 5)
  }
  w.write(permToIndex(p.thirdsRank, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 29)
  // El pick se guarda como lado (1=home, 2=away) según en qué cupo está hoy el
  // equipo elegido; 0 si no hay elección o el equipo ya no está en la llave.
  const resolved = resolveMatches(p)
  for (const num of PICK_ORDER) {
    const m = resolved.get(num)
    const chosen = p.picks[num]
    let side = 0
    if (m && chosen != null) {
      if (chosen === m.home) side = 1
      else if (chosen === m.away) side = 2
    }
    w.write(side, 2)
  }
  writeResults(w, p.results)
  return bytesToB64url(w.toBytes())
}

export function decodePrediction (code: string): Prediction {
  const r = new BitReader(b64urlToBytes(code))
  const version = r.read(4)
  if (version !== 2 && version !== 3 && version !== 4) throw new Error(`Versión de código no soportada: ${version}`)
  const p = defaultPrediction()
  // v2: sin modo ni scope (modo 'manual', scope 'all'). v3: modo, scope 'all'.
  // v4: modo + scope.
  if (version >= 3) p.mode = codeToMode(r.read(2))
  if (version >= 4) p.scope = codeToScope(r.read(2))
  for (let g = 0; g < 12; g++) {
    const base = GROUPS[g]!.teams.map((t) => t.id)
    p.groupOrder[g] = indexToPerm(r.read(5), base)
  }
  p.thirdsRank = indexToPerm(r.read(29), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  // El borrador arranca igual a lo confirmado: un pronóstico decodificado no
  // debe mostrar "Confirmar cambios" espurio.
  p.draftGroupOrder = p.groupOrder.map((a) => [...a])
  p.draftThirdsRank = [...p.thirdsRank]
  // Lee los lados de los picks (en el orden en que se escribieron).
  const sides = PICK_ORDER.map(() => r.read(2))
  // Los resultados van DESPUÉS de los picks en el flujo de bits, pero deben
  // leerse ANTES de reconstruir los picks: en modos no-manual los cupos de la
  // llave se resuelven desde `results` (posiciones ciertas), así que sin ellos
  // resolveMatches devolvería null y se perderían los picks.
  if (version >= 3) p.results = readResults(r)
  // Reconstruye los team id resolviendo de forma incremental: cada partido
  // depende solo de los anteriores en PICK_ORDER (R32→final), que ya quedaron
  // decididos al llegar a él.
  p.picks = {}
  PICK_ORDER.forEach((num, i) => {
    const side = sides[i]
    if (side === 1 || side === 2) {
      const m = resolveMatches(p).get(num)
      const teamId = side === 1 ? m?.home : m?.away
      if (teamId != null) p.picks[num] = teamId
    }
  })
  return p
}
