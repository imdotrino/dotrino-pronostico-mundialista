// Estado del pronóstico y su resolución a equipos concretos en cada partido.

import { GROUPS, GROUP_LETTERS } from './teams'
import {
  R32, ALL_LATER, FINAL, THIRD_PLACE, THIRD_SLOTS, allocateThirds, roundOf,
  type Slot, type R32Match, type LaterMatch, type RoundKey,
} from './bracket'
import {
  computeStandings, certainGroupOrder, GROUP_MATCH_COUNT, GROUP_PAIRS, MATCHES_PER_GROUP,
  groupMatchIndex, teamAt, type GameMode, type Scope, type Results,
} from './standings'

export interface Prediction {
  // Modo de juego: 'winlose' (solo gana/empata/pierde) o 'score' (con marcador).
  mode: GameMode
  // Alcance: 'all' (grupos + llaves), 'groups' (solo grupos) o 'bracket' (solo
  // llaves). Default 'all'; los pronósticos antiguos (sin scope) son 'all'.
  scope: Scope
  // Resultados de los 72 partidos de grupos (entrada del usuario). Las
  // posiciones se CALCULAN desde aquí, pero solo se aplican al confirmar.
  results: Results
  // Posiciones CONFIRMADAS. Para cada grupo (0..11): los 4 team id en el orden
  // [1º, 2º, 3º, 4º]. Es la "foto" que alimenta llaves, codec y compartir.
  groupOrder: number[][]
  // Ranking confirmado de los 12 terceros (permutación de índices de grupo).
  thirdsRank: number[]
  // Posiciones en BORRADOR que el usuario edita en modo 'manual' (arrastrando).
  // Las confirmadas siguen siendo groupOrder/thirdsRank (alimentan llaves/codec).
  draftGroupOrder: number[][]
  // Ranking de terceros en borrador (modo 'manual').
  draftThirdsRank: number[]
  // Para cada partido de eliminatorias: el team id que el usuario eligió como
  // ganador. Si ese equipo deja de estar en la llave (por un cambio en la fase
  // de grupos), el pick se invalida solo y la llave vuelve a quedar vacía.
  picks: Record<number, number>
}

export function defaultPrediction (): Prediction {
  return {
    mode: 'manual',
    scope: 'all',
    results: {},
    groupOrder: GROUPS.map((g) => g.teams.map((t) => t.id)),
    thirdsRank: GROUPS.map((_, i) => i),
    draftGroupOrder: GROUPS.map((g) => g.teams.map((t) => t.id)),
    draftThirdsRank: GROUPS.map((_, i) => i),
    picks: {},
  }
}

export function clonePrediction (p: Prediction): Prediction {
  return {
    mode: p.mode,
    scope: p.scope,
    // Clon JSON (results es data plana); structuredClone falla con proxies reactivos de Vue.
    results: JSON.parse(JSON.stringify(p.results)) as Results,
    groupOrder: p.groupOrder.map((g) => [...g]),
    thirdsRank: [...p.thirdsRank],
    draftGroupOrder: p.draftGroupOrder.map((g) => [...g]),
    draftThirdsRank: [...p.draftThirdsRank],
    picks: { ...p.picks },
  }
}

/**
 * Aplica los resultados a las posiciones: recalcula groupOrder/thirdsRank desde
 * `results`+`mode` y poda los picks de llaves que dejan de ser válidos. Llamar
 * al "Confirmar cambios". Devuelve true si cambió algo.
 */
export function confirmStandings (p: Prediction): boolean {
  const next = draftStandings(p)
  const changed = JSON.stringify(next.groupOrder) !== JSON.stringify(p.groupOrder) ||
    JSON.stringify(next.thirdsRank) !== JSON.stringify(p.thirdsRank)
  if (changed) {
    p.groupOrder = next.groupOrder.map((g) => [...g])
    p.thirdsRank = [...next.thirdsRank]
    prunePicks(p)
  }
  return changed
}

/**
 * Descarta los cambios en borrador: vuelve el orden arrastrado al último
 * confirmado (lo opuesto a `confirmStandings`). Devuelve true si revirtió algo.
 */
export function revertDraft (p: Prediction): boolean {
  const changed = JSON.stringify(p.draftGroupOrder) !== JSON.stringify(p.groupOrder) ||
    JSON.stringify(p.draftThirdsRank) !== JSON.stringify(p.thirdsRank)
  if (changed) {
    p.draftGroupOrder = p.groupOrder.map((g) => [...g])
    p.draftThirdsRank = [...p.thirdsRank]
  }
  return changed
}

/**
 * Posiciones "en borrador" que aún no se aplican a las llaves:
 *   - 'manual': lo que el usuario arrastra (draftGroupOrder/draftThirdsRank).
 *   - winlose/score: lo calculado desde los resultados cargados.
 */
export function draftStandings (p: Prediction): { groupOrder: number[][]; thirdsRank: number[] } {
  if (p.mode === 'manual') return { groupOrder: p.draftGroupOrder, thirdsRank: p.draftThirdsRank }
  return computeStandings(p.results, p.mode)
}

/**
 * "Huella" de las posiciones que SÍ alimentan las llaves: el 1.º y 2.º de cada
 * grupo (cupos W/RU) y los terceros que clasifican según su asignación a slots.
 * El 4.º de cada grupo y los terceros que no clasifican NO entran a las llaves,
 * así que reordenarlos no cambia esta huella.
 */
function bracketSignature (groupOrder: number[][], thirdsRank: number[]): string {
  const winners = groupOrder.map((g) => g[0])
  const runners = groupOrder.map((g) => g[1])
  const thirds = allocateThirds(thirdsRank.slice(0, 8))
    .map((group) => (group == null ? null : groupOrder[group]![2]!))
  return JSON.stringify([winners, runners, thirds])
}

/**
 * ¿Hay cambios sin confirmar que AFECTAN las llaves? Solo cuenta como pendiente
 * lo que cambia la huella del bracket; los reordenamientos que no tocan las
 * llaves (p. ej. 4.º puesto, o terceros que no clasifican) se consideran ya
 * confirmados (ver `autoConfirmNonBracket`).
 */
export function hasPendingChanges (p: Prediction): boolean {
  // Sin llaves no hay nada que "afecte las llaves": en 'groups'/'bracket' los
  // reordenamientos se confirman solos (ver autoConfirmNonBracket).
  if (p.scope !== 'all') return false
  const next = draftStandings(p)
  return bracketSignature(next.groupOrder, next.thirdsRank) !==
    bracketSignature(p.groupOrder, p.thirdsRank)
}

/**
 * Aplica al confirmado (silenciosamente) los cambios del borrador que NO afectan
 * las llaves, para que queden "confirmados" sin pedir confirmación. No poda picks
 * porque la huella del bracket es idéntica (los mismos equipos siguen presentes).
 * Devuelve true si sincronizó algo.
 */
export function autoConfirmNonBracket (p: Prediction): boolean {
  const next = draftStandings(p)
  const rawChanged = JSON.stringify(next.groupOrder) !== JSON.stringify(p.groupOrder) ||
    JSON.stringify(next.thirdsRank) !== JSON.stringify(p.thirdsRank)
  if (!rawChanged) return false
  // En 'all' solo auto-confirmamos lo que NO toca las llaves (el resto pide
  // confirmación). Sin llaves ('groups'/'bracket') confirmamos siempre.
  if (p.scope === 'all' &&
      bracketSignature(next.groupOrder, next.thirdsRank) !==
      bracketSignature(p.groupOrder, p.thirdsRank)) return false
  p.groupOrder = next.groupOrder.map((g) => [...g])
  p.thirdsRank = [...next.thirdsRank]
  return true
}

// Tercer equipo de un grupo según las posiciones confirmadas (para terceros).
function groupThird (p: Prediction, group: number): number { return p.groupOrder[group]![2]! }

/** Grupos cuyos terceros clasifican (8 mejores), en orden de ranking. */
export function qualifiedThirdGroups (p: Prediction): number[] {
  return p.thirdsRank.slice(0, 8)
}

/** thirdSlot (0..7) → equipo tercero asignado, o null si no resoluble. */
export function thirdSlotTeams (p: Prediction): (number | null)[] {
  const alloc = allocateThirds(qualifiedThirdGroups(p))
  return alloc.map((group) => (group == null ? null : groupThird(p, group)))
}

// effGO[group] = posiciones efectivas del grupo (team id o null si aún no es
// segura). En 'manual' son las posiciones explícitas; en 'winlose'/'score' son
// las CIERTAS según los resultados cargados (null mientras no se sepan).
function resolveSlot (slot: Slot, effGO: (number | null)[][], thirds: (number | null)[]): number | null {
  switch (slot.kind) {
    case 'W': return effGO[slot.group]?.[0] ?? null
    case 'RU': return effGO[slot.group]?.[1] ?? null
    case '3rd': return thirds[slot.thirdSlot] ?? null
  }
}

export interface ResolvedMatch {
  num: number
  home: number | null
  away: number | null
  /** equipo que avanza */
  winner: number | null
  /** equipo que cae (útil para el 3er puesto) */
  loser: number | null
}

/**
 * Resuelve todos los partidos a equipos concretos aplicando los picks.
 * Devuelve un mapa por número de partido. Los cupos sin resolver quedan null.
 */
export function resolveMatches (p: Prediction): Map<number, ResolvedMatch> {
  // En modos con resultados (no manual), un cupo solo se llena cuando la
  // posición ya es SEGURA con lo cargado; si no, queda null (placeholder).
  // En 'manual' valen las posiciones explícitas (lo que el usuario ordenó).
  const useCertain = p.mode !== 'manual'
  const effGO: (number | null)[][] = useCertain
    ? GROUPS.map((_, g) => certainGroupOrder(g, p.results, p.mode))
    : p.groupOrder.map((g) => [...g])

  let thirds: (number | null)[]
  if (useCertain) {
    // Los mejores terceros requieren conocer y comparar el 3.º de TODOS los
    // grupos; solo se asignan cuando todas las posiciones son seguras.
    const allCertain = effGO.every((go) => go.every((x) => x != null))
    if (allCertain) {
      const st = computeStandings(p.results, p.mode)
      thirds = thirdSlotTeams({ ...p, groupOrder: st.groupOrder, thirdsRank: st.thirdsRank })
    } else {
      thirds = new Array(THIRD_SLOTS.length).fill(null)
    }
  } else {
    thirds = thirdSlotTeams(p)
  }

  const out = new Map<number, ResolvedMatch>()

  const decide = (num: number, home: number | null, away: number | null): ResolvedMatch => {
    let winner: number | null = null
    let loser: number | null = null
    // Solo hay ganador si el equipo elegido sigue siendo uno de los dos cupos.
    // Si no (o no hay elección), la llave queda vacía y no propaga adelante.
    // Se permite elegir ganador aunque el rival aún esté vacío: basta con que
    // el equipo elegido sea el cupo presente (home o away).
    const chosen = p.picks[num]
    if (chosen != null && (chosen === home || chosen === away)) {
      winner = chosen
      loser = chosen === home ? away : home
    }
    const m: ResolvedMatch = { num, home, away, winner, loser }
    out.set(num, m)
    return m
  }

  // Dieciseisavos
  for (const m of R32 as R32Match[]) {
    decide(m.num, resolveSlot(m.home, effGO, thirds), resolveSlot(m.away, effGO, thirds))
  }

  // Rondas posteriores. ALL_LATER está ordenado de octavos hacia la final,
  // con el 3er puesto antes de la final; ambos dependen de las semifinales,
  // ya resueltas para entonces.
  for (const m of ALL_LATER as LaterMatch[]) {
    if (m.num === THIRD_PLACE.num) {
      // Perdedores de las semifinales.
      const a = out.get(m.from[0])?.loser ?? null
      const b = out.get(m.from[1])?.loser ?? null
      decide(m.num, a, b)
    } else {
      const a = out.get(m.from[0])?.winner ?? null
      const b = out.get(m.from[1])?.winner ?? null
      decide(m.num, a, b)
    }
  }

  return out
}

export function champion (p: Prediction): number | null {
  return resolveMatches(p).get(FINAL.num)?.winner ?? null
}

// Una decisión pendiente del pronóstico, con datos suficientes para que la UI
// arme una etiqueta legible ("Grupo A: MEX vs RSA", "Octavos: …"). Los equipos
// van como team id (o null en una llave cuyos cupos aún no se conocen).
export type MissingItem =
  | { kind: 'group'; letter: string; home: number; away: number }
  | { kind: 'bracket'; num: number; round: RoundKey; home: number | null; away: number | null }

/**
 * Lista las decisiones que faltan por definir, en orden de "qué arreglar
 * primero": antes los partidos de grupo (la base; solo en modos con resultados)
 * y luego las llaves ronda por ronda (R32 → final). Cuenta lo mismo que
 * `completeness` (de ahí se deriva el %), pero ordenado para que las faltas
 * accionables (con equipos ya conocidos) salgan primero.
 */
export function listMissing (p: Prediction): MissingItem[] {
  const out: MissingItem[] = []
  // Partidos de grupo: en 'manual' las posiciones se ponen a mano, no hay
  // resultados que cargar; en scope 'bracket' la fase de grupos no es del
  // usuario (sale de los resultados oficiales). En ambos casos no cuentan.
  if (p.mode !== 'manual' && p.scope !== 'bracket') {
    for (let g = 0; g < GROUPS.length; g++) {
      for (let pair = 0; pair < MATCHES_PER_GROUP; pair++) {
        if (p.results[groupMatchIndex(g, pair)]) continue
        const [a, b] = GROUP_PAIRS[pair]!
        out.push({ kind: 'group', letter: GROUP_LETTERS[g]!, home: teamAt(g, a), away: teamAt(g, b) })
      }
    }
  }
  // Llaves sin ganador decidido (R32 primero, luego rondas hacia la final).
  // En scope 'groups' no hay llaves.
  if (p.scope !== 'groups') {
    const resolved = resolveMatches(p)
    for (const mt of [...R32, ...ALL_LATER]) {
      const m = resolved.get(mt.num)
      if (m?.winner == null) {
        out.push({ kind: 'bracket', num: mt.num, round: roundOf(mt.num), home: m?.home ?? null, away: m?.away ?? null })
      }
    }
  }
  return out
}

/**
 * % de llenado del pronóstico: cuántas decisiones necesarias están tomadas.
 * Llaves: las 32 (R32→final + 3.º) con ganador decidido. En modos con
 * resultados, además los 72 partidos de grupo cargados. (En 'manual' las
 * posiciones ya están dadas, así que solo cuentan las llaves.)
 */
export function completeness (p: Prediction): { filled: number; total: number; pct: number } {
  // Las llaves cuentan salvo en scope 'groups'; los 72 partidos de grupo cuentan
  // solo en modos con resultados y cuando el scope incluye la fase de grupos.
  const bracketTotal = p.scope === 'groups' ? 0 : R32.length + ALL_LATER.length
  const groupTotal = (p.mode !== 'manual' && p.scope !== 'bracket') ? GROUP_MATCH_COUNT : 0
  const total = bracketTotal + groupTotal
  const filled = total - listMissing(p).length
  return { filled, total, pct: total ? Math.round((filled / total) * 100) : 0 }
}

/**
 * Elimina (in place) los picks cuyo equipo elegido ya no está en su llave,
 * propagando en cascada: al borrar un pick, las llaves que dependían de él
 * quedan vacías y sus picks también se invalidan. Devuelve true si cambió algo.
 * Llamar tras editar la fase de grupos.
 */
export function prunePicks (p: Prediction): boolean {
  let changed = false
  for (;;) {
    const resolved = resolveMatches(p)
    let removedThisPass = false
    for (const [num, chosen] of Object.entries(p.picks)) {
      const m = resolved.get(Number(num))
      const valid = m && (chosen === m.home || chosen === m.away)
      if (!valid) {
        delete p.picks[Number(num)]
        removedThisPass = true
        changed = true
      }
    }
    if (!removedThisPass) break
  }
  return changed
}

export { THIRD_SLOTS }
