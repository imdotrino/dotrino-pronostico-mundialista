// Cálculo de puntos de un pronóstico comparado contra los RESULTADOS oficiales.
//
// La entrada con `official: true` es la base de comparación. Por cada pronóstico
// se compara su tabla de posiciones, sus aciertos de llaves (quién avanza) y,
// solo en modo 'score' (Completo), los marcadores exactos de la fase de grupos.

import type { SavedPrediction } from './store'
import { decodePrediction } from './codec'
import { resolveMatches } from './prediction'
import { GROUP_PAIRS, groupMatchIndex, certainGroupOrder, outcomeOf, type Results } from './standings'
import { R32, R16, QF, SF, THIRD_PLACE, FINAL } from './bracket'

// Puntos por categoría. El panel "¿Cómo se puntúa?" lee ESTAS mismas constantes.
export const SCORING = {
  posicion: 3, // por cada equipo cuya posición de grupo (1.º/2.º/3.º/4.º) coincide
  r32: 4, // acertar quién avanza en dieciseisavos
  r16: 6, // octavos
  qf: 9, // cuartos
  sf: 13, // semifinales
  final: 20, // final (campeón)
  tercero: 5, // partido por el tercer puesto
  resultado: 1, // acertar gana/empata/pierde de un partido de grupo (Medio y Completo)
  marcadorExacto: 2, // marcador EXACTO de grupo (solo modo Completo)
} as const

export interface ScoreBreakdown {
  /** Puntos por posiciones de grupo acertadas. */
  posiciones: number
  /** Puntos por aciertos de llaves (quién avanza) en todas las rondas. */
  llaves: number
  /** Puntos por acertar gana/empata/pierde de partidos de grupo (Medio/Completo). */
  resultados: number
  /** Puntos extra por marcadores exactos de grupo (solo modo Completo). */
  marcadores: number
  /** Suma total. */
  total: number
}

// Rondas de llaves con su puntaje. THIRD_PLACE es un solo partido aparte.
const ROUNDS: { matches: { num: number }[]; pts: number; key: string }[] = [
  { matches: R32, pts: SCORING.r32, key: 'r32' },
  { matches: R16, pts: SCORING.r16, key: 'r16' },
  { matches: QF, pts: SCORING.qf, key: 'qf' },
  { matches: SF, pts: SCORING.sf, key: 'sf' },
  { matches: [THIRD_PLACE], pts: SCORING.tercero, key: 'third' },
  { matches: [FINAL], pts: SCORING.final, key: 'final' },
]

/**
 * Puntúa una entrada contra la oficial. Decodifica ambos códigos; para el extra
 * de marcador usa los `results` locales de las entradas (no viajan en el código)
 * cuando la entrada está en modo 'score'. Si la oficial está vacía, devuelve 0.
 */
export function scoreEntry (entry: SavedPrediction, official: SavedPrediction | null): ScoreBreakdown {
  const empty: ScoreBreakdown = { posiciones: 0, llaves: 0, resultados: 0, marcadores: 0, total: 0 }
  if (!official || !official.code) return empty

  let P, O
  try {
    P = decodePrediction(entry.code)
    O = decodePrediction(official.code)
  } catch {
    return empty
  }

  // El alcance (scope) del pronóstico decide qué categorías puntúan: 'groups'
  // no tiene llaves; 'bracket' no tiene fase de grupos del usuario (sale de los
  // resultados oficiales). 'all' puntúa todo.
  const scope = P.scope ?? 'all'

  // --- Posiciones de grupo: +3 SOLO por posiciones oficiales ASEGURADAS. ---
  // Las posiciones oficiales se derivan de los resultados cargados y solo
  // cuentan las que ya son ciertas (no se puntúa lo incierto).
  const oResults: Results = official.results ?? {}
  const oMode = official.mode ?? 'score'
  let posiciones = 0
  if (scope !== 'bracket') {
    for (let g = 0; g < 12; g++) {
      const pg = P.groupOrder[g]!
      const certain = certainGroupOrder(g, oResults, oMode)
      for (let pos = 0; pos < 4; pos++) {
        const teamCierto = certain[pos]
        if (teamCierto != null && pg[pos] === teamCierto) posiciones += SCORING.posicion
      }
    }
  }

  // --- Llaves: acertar quién avanza, SOLO en partidos que el oficial ya
  // decidió (resultado real registrado). Si el oficial aún no lo definió, no
  // se puntúa. El ganador oficial es el pick registrado (O.picks[num]). ---
  const rp = resolveMatches(P)
  let llaves = 0
  if (scope !== 'groups') {
    for (const round of ROUNDS) {
      for (const m of round.matches) {
        const wp = rp.get(m.num)?.winner ?? null
        const wo = O.picks[m.num] ?? null // ganador real registrado en el oficial
        if (wp != null && wo != null && wp === wo) llaves += round.pts
      }
    }
  }

  // --- Resultados (gana/empata/pierde) y marcador exacto de grupo. ---
  // En Medio y Completo se compara el 1/X/2 de cada partido de grupo; en
  // Completo, además, el marcador exacto. Solo cuenta donde el oficial ya tiene
  // ese resultado (partido jugado). En scope 'bracket' la fase de grupos no es
  // del usuario, así que no puntúa.
  let resultados = 0
  let marcadores = 0
  if (scope !== 'bracket' && (entry.mode === 'winlose' || entry.mode === 'score')) {
    const er: Results = entry.results ?? {}
    const or: Results = official.results ?? {}
    for (let g = 0; g < 12; g++) {
      for (let pair = 0; pair < GROUP_PAIRS.length; pair++) {
        const idx = groupMatchIndex(g, pair)
        const a = er[idx]
        const b = or[idx]
        // Acierto 1/X/2 (Medio y Completo).
        const eo = outcomeOf(a)
        const oo = outcomeOf(b)
        if (eo != null && oo != null && eo === oo) resultados += SCORING.resultado
        // Marcador exacto (solo Completo).
        if (entry.mode === 'score' && a && b &&
          typeof a.gh === 'number' && typeof a.ga === 'number' &&
          typeof b.gh === 'number' && typeof b.ga === 'number' &&
          a.gh === b.gh && a.ga === b.ga) {
          marcadores += SCORING.marcadorExacto
        }
      }
    }
  }

  return {
    posiciones, llaves, resultados, marcadores,
    total: posiciones + llaves + resultados + marcadores,
  }
}

// Detalle del cálculo para la pestaña "Puntajes": qué se acertó y cuántos
// puntos dio cada acierto.
export interface ScoreDetail {
  positions: { group: number; pos: number; teamId: number; points: number }[]
  outcomes: { group: number; pair: number; points: number }[]
  exact: { group: number; pair: number; gh: number; ga: number; points: number }[]
  bracket: { num: number; roundKey: string; teamId: number; points: number }[]
  breakdown: ScoreBreakdown
}

export function scoreDetail (entry: SavedPrediction, official: SavedPrediction | null): ScoreDetail {
  const empty: ScoreDetail = { positions: [], outcomes: [], exact: [], bracket: [], breakdown: { posiciones: 0, llaves: 0, resultados: 0, marcadores: 0, total: 0 } }
  if (!official || !official.code) return empty

  let P, O
  try { P = decodePrediction(entry.code); O = decodePrediction(official.code) } catch { return empty }

  const oResults: Results = official.results ?? {}
  const oMode = official.mode ?? 'score'
  const scope = P.scope ?? 'all'
  const detail: ScoreDetail = { positions: [], outcomes: [], exact: [], bracket: [], breakdown: { posiciones: 0, llaves: 0, resultados: 0, marcadores: 0, total: 0 } }

  // Posiciones aseguradas acertadas (no aplican en scope 'bracket').
  if (scope !== 'bracket') {
    for (let g = 0; g < 12; g++) {
      const pg = P.groupOrder[g]!
      const certain = certainGroupOrder(g, oResults, oMode)
      for (let pos = 0; pos < 4; pos++) {
        const teamCierto = certain[pos]
        if (teamCierto != null && pg[pos] === teamCierto) {
          detail.positions.push({ group: g, pos, teamId: teamCierto, points: SCORING.posicion })
        }
      }
    }
  }

  // Llaves acertadas (en partidos ya decididos por el oficial). No en 'groups'.
  const rp = resolveMatches(P)
  if (scope !== 'groups') {
    for (const round of ROUNDS) {
      for (const m of round.matches) {
        const wp = rp.get(m.num)?.winner ?? null
        const wo = O.picks[m.num] ?? null
        if (wp != null && wo != null && wp === wo) {
          detail.bracket.push({ num: m.num, roundKey: round.key, teamId: wp, points: round.pts })
        }
      }
    }
  }

  // Acierto 1/–/2 y marcador exacto de grupo (Medio/Completo); no en 'bracket'.
  if (scope !== 'bracket' && (entry.mode === 'winlose' || entry.mode === 'score')) {
    const er: Results = entry.results ?? {}
    for (let g = 0; g < 12; g++) {
      for (let pair = 0; pair < GROUP_PAIRS.length; pair++) {
        const idx = groupMatchIndex(g, pair)
        const a = er[idx]
        const b = oResults[idx]
        const eo = outcomeOf(a)
        const oo = outcomeOf(b)
        if (eo != null && oo != null && eo === oo) detail.outcomes.push({ group: g, pair, points: SCORING.resultado })
        if (entry.mode === 'score' && a && b &&
          typeof a.gh === 'number' && typeof a.ga === 'number' &&
          typeof b.gh === 'number' && typeof b.ga === 'number' &&
          a.gh === b.gh && a.ga === b.ga) {
          detail.exact.push({ group: g, pair, gh: a.gh, ga: a.ga, points: SCORING.marcadorExacto })
        }
      }
    }
  }

  const posiciones = detail.positions.reduce((s, x) => s + x.points, 0)
  const llaves = detail.bracket.reduce((s, x) => s + x.points, 0)
  const resultados = detail.outcomes.reduce((s, x) => s + x.points, 0)
  const marcadores = detail.exact.reduce((s, x) => s + x.points, 0)
  detail.breakdown = { posiciones, llaves, resultados, marcadores, total: posiciones + llaves + resultados + marcadores }
  return detail
}
