// Cálculo de la tabla de posiciones de la fase de grupos a partir de los
// RESULTADOS de los partidos. Dos modos de juego (se diferencian solo en cómo
// se calculan/desempatan los puntos):
//   - 'winlose': solo gana/empata/pierde (sin marcador). Desempate por
//     enfrentamiento directo y orden de sorteo.
//   - 'score':   con marcador opcional; si hay goles se usan para diferencia de
//     gol y goles a favor como desempate (al estilo FIFA).
//
// Cada grupo es un round-robin de 4 equipos → 6 partidos. Los partidos se
// identifican por la posición de sorteo de los equipos (0..3), estable.

import { GROUPS } from './teams'

// Tres modos de juego:
//   - 'manual':  tabla de posiciones y terceros ordenados a mano (arrastrar).
//                No usa resultados; las posiciones son la entrada directa.
//   - 'winlose': gana/empata/pierde por partido → calcula posiciones.
//   - 'score':   con marcador (goles) → calcula posiciones con diferencia de gol.
export type GameMode = 'manual' | 'winlose' | 'score'

// ALCANCE (scope) del pronóstico: qué fases incluye. Es una dimensión ORTOGONAL
// al modo de juego (cada modo × cada scope = una combinación). Junto al modo
// (Simple/Medio/Completo) forman los "9 tipos":
//   - 'all':     dos fases — fase de grupos + llaves (comportamiento clásico).
//   - 'groups':  solo la fase de grupos (sin llaves).
//   - 'bracket': solo las llaves, sembradas desde los RESULTADOS oficiales de
//                grupos. Queda OCULTO hasta tener resultados oficiales (ver
//                BRACKET_SCOPE_ENABLED en App.vue); el modelo ya lo soporta.
export type Scope = 'all' | 'groups' | 'bracket'

// Resultado de un partido.
//   o: 0 = gana el local (primero del par), 1 = empate, 2 = gana el visitante.
//   gh/ga: goles local/visitante (opcionales; solo relevantes en modo 'score').
//   ph/pa: penales local/visitante (solo en eliminatorias con empate en los 90').
export interface MatchResult {
  o: 0 | 1 | 2
  gh?: number
  ga?: number
  ph?: number
  pa?: number
}

/**
 * Lado que avanza en un partido de eliminatoria según el marcador: gana quien
 * tiene más goles; si empatan en los 90', deciden los penales. Devuelve 'h'
 * (local), 'a' (visitante) o null si aún no está decidido.
 */
export function koWinnerSide (r: MatchResult | undefined): 'h' | 'a' | null {
  if (!r || typeof r.gh !== 'number' || typeof r.ga !== 'number') return null
  if (r.gh > r.ga) return 'h'
  if (r.gh < r.ga) return 'a'
  // Empate en 90': deciden los penales.
  if (typeof r.ph !== 'number' || typeof r.pa !== 'number' || r.ph === r.pa) return null
  return r.ph > r.pa ? 'h' : 'a'
}

// Resultados indexados por índice global de partido de grupo (0..71).
export type Results = Record<number, MatchResult>

/**
 * Resultado 1/X/2 de un partido: si hay marcador cargado se deriva de los goles
 * (gana local / empate / gana visitante); si no, usa el campo `o`. null si no
 * hay resultado cargado. Sirve para comparar aciertos de gana/empata/pierde.
 */
export function outcomeOf (r: MatchResult | undefined): 0 | 1 | 2 | null {
  if (!r) return null
  if (typeof r.gh === 'number' && typeof r.ga === 'number') {
    return r.gh > r.ga ? 0 : r.gh < r.ga ? 2 : 1
  }
  return r.o
}

// Los 6 enfrentamientos de un grupo, por posición de sorteo (0..3).
export const GROUP_PAIRS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
]

export const MATCHES_PER_GROUP = GROUP_PAIRS.length // 6
export const GROUP_MATCH_COUNT = 12 * MATCHES_PER_GROUP // 72

/** Índice global (0..71) del partido `pair` (0..5) del grupo `g` (0..11). */
export function groupMatchIndex (g: number, pair: number): number {
  return g * MATCHES_PER_GROUP + pair
}

/** team id de la posición de sorteo `pos` (0..3) del grupo `g`. */
export function teamAt (g: number, pos: number): number {
  return GROUPS[g]!.teams[pos]!.id
}

interface Stat { pos: number; pts: number; gd: number; gf: number }

// Resultado efectivo de un partido: ganador (0 local / 1 empate / 2 visitante)
// y goles aplicables. En 'score' con goles cargados, el ganador sale de los
// goles; si no, del campo `o` y sin goles.
function effective (r: MatchResult | undefined, mode: GameMode): { o: 0 | 1 | 2; gh: number; ga: number; hasGoals: boolean } | null {
  if (!r) return null
  if (mode === 'score' && typeof r.gh === 'number' && typeof r.ga === 'number') {
    const o: 0 | 1 | 2 = r.gh > r.ga ? 0 : r.gh < r.ga ? 2 : 1
    return { o, gh: r.gh, ga: r.ga, hasGoals: true }
  }
  return { o: r.o, gh: 0, ga: 0, hasGoals: false }
}

function groupStats (g: number, results: Results, mode: GameMode): Stat[] {
  const stat: Stat[] = [0, 1, 2, 3].map((pos) => ({ pos, pts: 0, gd: 0, gf: 0 }))
  GROUP_PAIRS.forEach(([a, b], pair) => {
    const eff = effective(results[groupMatchIndex(g, pair)], mode)
    if (!eff) return
    const sa = stat[a]!
    const sb = stat[b]!
    if (eff.hasGoals) {
      sa.gf += eff.gh; sb.gf += eff.ga
      sa.gd += eff.gh - eff.ga; sb.gd += eff.ga - eff.gh
    }
    if (eff.o === 0) sa.pts += 3
    else if (eff.o === 2) sb.pts += 3
    else { sa.pts += 1; sb.pts += 1 }
  })
  return stat
}

// Enfrentamiento directo entre dos posiciones a y b del grupo: +1 si gana a,
// -1 si gana b, 0 empate/sin dato.
function headToHead (g: number, a: number, b: number, results: Results, mode: GameMode): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const pair = GROUP_PAIRS.findIndex(([x, y]) => x === lo && y === hi)
  if (pair < 0) return 0
  const eff = effective(results[groupMatchIndex(g, pair)], mode)
  if (!eff || eff.o === 1) return 0
  // o===0 gana el "lo"; o===2 gana el "hi".
  const winner = eff.o === 0 ? lo : hi
  if (winner === a) return 1
  if (winner === b) return -1
  return 0
}

function compareInGroup (g: number, results: Results, mode: GameMode) {
  return (x: Stat, y: Stat): number => {
    if (y.pts !== x.pts) return y.pts - x.pts
    if (y.gd !== x.gd) return y.gd - x.gd
    if (y.gf !== x.gf) return y.gf - x.gf
    const h = headToHead(g, x.pos, y.pos, results, mode)
    if (h !== 0) return -h // +1 (gana x) → x antes
    return x.pos - y.pos // estable: orden de sorteo
  }
}

/** Orden pronosticado [1º,2º,3º,4º] (team ids) de un grupo según resultados. */
export function computeGroupOrder (g: number, results: Results, mode: GameMode): number[] {
  const stat = groupStats(g, results, mode).sort(compareInGroup(g, results, mode))
  return stat.map((s) => teamAt(g, s.pos))
}

/**
 * Ranking de los 12 terceros (permutación de índices de grupo, mejor→peor),
 * por puntos / diferencia de gol / goles a favor del 3.º de cada grupo.
 */
export function computeThirdsRank (results: Results, mode: GameMode): number[] {
  const thirds = GROUPS.map((_, g) => {
    const stat = groupStats(g, results, mode).sort(compareInGroup(g, results, mode))
    const third = stat[2]!
    return { g, pts: third.pts, gd: third.gd, gf: third.gf }
  })
  thirds.sort((a, b) => (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf) || (a.g - b.g))
  return thirds.map((t) => t.g)
}

export interface Standings { groupOrder: number[][]; thirdsRank: number[] }

/** Tabla completa derivada de los resultados. */
export function computeStandings (results: Results, mode: GameMode): Standings {
  return {
    groupOrder: GROUPS.map((_, g) => computeGroupOrder(g, results, mode)),
    thirdsRank: computeThirdsRank(results, mode),
  }
}

/** Estadística por posición de sorteo de un grupo (para mostrar puntos en la tabla). */
export function groupStandingsTable (g: number, results: Results, mode: GameMode): { teamId: number; pts: number; gd: number; gf: number }[] {
  return groupStats(g, results, mode)
    .sort(compareInGroup(g, results, mode))
    .map((s) => ({ teamId: teamAt(g, s.pos), pts: s.pts, gd: s.gd, gf: s.gf }))
}

/**
 * Posiciones CIERTAS (aseguradas) de un grupo según los resultados cargados.
 * Devuelve, por posición (1.º..4.º), el team id SOLO si es seguro; null si aún
 * no se puede saber con certeza. Una posición es cierta si:
 *   - todos los partidos del grupo se jugaron (orden final real), o
 *   - el equipo ocupa esa posición en TODAS las combinaciones posibles de los
 *     partidos que faltan, decidida por PUNTOS (sin depender de desempates por
 *     diferencia de gol, que con partidos por jugar no son seguros).
 * Conservadora a propósito: nunca afirma una certeza que el azar pueda romper.
 */
export function certainGroupOrder (g: number, results: Results, mode: GameMode): (number | null)[] {
  const unplayed: number[] = []
  for (let p = 0; p < GROUP_PAIRS.length; p++) {
    if (!results[groupMatchIndex(g, p)]) unplayed.push(p)
  }
  // Grupo completo: el orden final es real y seguro.
  if (unplayed.length === 0) return groupStandingsTable(g, results, mode).map((r) => r.teamId)

  // Puntos ya asegurados por los partidos jugados.
  const basePts = [0, 0, 0, 0]
  GROUP_PAIRS.forEach(([a, b], pair) => {
    const eff = effective(results[groupMatchIndex(g, pair)], mode)
    if (!eff) return
    if (eff.o === 0) basePts[a]! += 3
    else if (eff.o === 2) basePts[b]! += 3
    else { basePts[a]! += 1; basePts[b]! += 1 }
  })

  // Por posición: undefined = aún sin observar, null = quedó incierta,
  // number = mismo equipo (y "limpio" por puntos) en todas las combinaciones.
  const perPos: (number | null | undefined)[] = [undefined, undefined, undefined, undefined]
  const total = 3 ** unplayed.length
  for (let mask = 0; mask < total; mask++) {
    const pts = [...basePts]
    let m = mask
    for (const pair of unplayed) {
      const o = m % 3; m = Math.floor(m / 3)
      const [a, b] = GROUP_PAIRS[pair]!
      if (o === 0) pts[a]! += 3
      else if (o === 2) pts[b]! += 3
      else { pts[a]! += 1; pts[b]! += 1 }
    }
    const order = [0, 1, 2, 3].sort((x, y) => pts[y]! - pts[x]! || x - y)
    for (let rank = 0; rank < 4; rank++) {
      const posIdx = order[rank]!
      // "Limpia" si los puntos la separan estrictamente de sus vecinas (sin
      // empate que dependería de diferencia de gol / partidos futuros).
      const clean =
        (rank === 0 || pts[order[rank - 1]!]! > pts[posIdx]!) &&
        (rank === 3 || pts[posIdx]! > pts[order[rank + 1]!]!)
      if (!clean) { perPos[rank] = null; continue }
      const teamId = teamAt(g, posIdx)
      if (perPos[rank] === undefined) perPos[rank] = teamId
      else if (perPos[rank] !== teamId) perPos[rank] = null
    }
  }
  return perPos.map((v) => (v == null ? null : v))
}
