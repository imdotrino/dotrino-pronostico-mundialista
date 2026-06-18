// Estructura de la fase final del Mundial 2026 (formato 48 equipos).
//
// 32 clasificados: 12 primeros + 12 segundos + 8 mejores terceros.
// Numeración oficial de partidos: dieciseisavos 73-88, octavos 89-96,
// cuartos 97-100, semifinales 101-102, tercer puesto 103, final 104.

// Fuente de un cupo en un partido de dieciseisavos.
export type Slot =
  | { kind: 'W'; group: number } // 1º del grupo (group = índice 0..11)
  | { kind: 'RU'; group: number } // 2º del grupo
  | { kind: '3rd'; thirdSlot: number } // mejor tercero asignado a este slot

// Los 8 slots de "mejor tercero" en dieciseisavos, con los grupos cuyos
// terceros pueden caer en cada uno (regla de la FIFA por posición de bombo).
// thirdSlot 0..7 ↔ partidos 74,77,79,80,81,82,85,87.
export const THIRD_SLOTS: { match: number; allowed: number[] }[] = [
  { match: 74, allowed: [0, 1, 2, 3, 5] }, //  A B C D F
  { match: 77, allowed: [2, 3, 5, 6, 7] }, //  C D F G H
  { match: 79, allowed: [2, 4, 5, 7, 8] }, //  C E F H I
  { match: 80, allowed: [4, 7, 8, 9, 10] }, // E H I J K
  { match: 81, allowed: [1, 4, 5, 8, 9] }, //  B E F I J
  { match: 82, allowed: [0, 4, 7, 8, 9] }, //  A E H I J
  { match: 85, allowed: [4, 5, 6, 8, 9] }, //  E F G I J
  { match: 87, allowed: [3, 4, 8, 9, 11] }, // D E I J L
]

export interface R32Match {
  num: number
  home: Slot
  away: Slot
}

const W = (group: number): Slot => ({ kind: 'W', group })
const RU = (group: number): Slot => ({ kind: 'RU', group })
const T = (thirdSlot: number): Slot => ({ kind: '3rd', thirdSlot })

// Dieciseisavos (Round of 32). group: A=0 … L=11.
export const R32: R32Match[] = [
  { num: 73, home: RU(0), away: RU(1) },
  { num: 74, home: W(4), away: T(0) },
  { num: 75, home: W(5), away: RU(2) },
  { num: 76, home: W(2), away: RU(5) },
  { num: 77, home: W(8), away: T(1) },
  { num: 78, home: RU(4), away: RU(8) },
  { num: 79, home: W(0), away: T(2) },
  { num: 80, home: W(11), away: T(3) },
  { num: 81, home: W(3), away: T(4) },
  { num: 82, home: W(6), away: T(5) },
  { num: 83, home: RU(10), away: RU(11) },
  { num: 84, home: W(7), away: RU(9) },
  { num: 85, home: W(1), away: T(6) },
  { num: 86, home: W(9), away: RU(7) },
  { num: 87, home: W(10), away: T(7) },
  { num: 88, home: RU(3), away: RU(6) },
]

// Rondas posteriores: cada partido toma el ganador de dos partidos previos.
export interface LaterMatch {
  num: number
  from: [number, number] // números de los dos partidos cuyo ganador avanza
}

export const R16: LaterMatch[] = [
  { num: 89, from: [74, 77] },
  { num: 90, from: [73, 75] },
  { num: 91, from: [76, 78] },
  { num: 92, from: [79, 80] },
  { num: 93, from: [83, 84] },
  { num: 94, from: [81, 82] },
  { num: 95, from: [86, 88] },
  { num: 96, from: [85, 87] },
]

export const QF: LaterMatch[] = [
  { num: 97, from: [89, 90] },
  { num: 98, from: [93, 94] },
  { num: 99, from: [91, 92] },
  { num: 100, from: [95, 96] },
]

export const SF: LaterMatch[] = [
  { num: 101, from: [97, 98] },
  { num: 102, from: [99, 100] },
]

export const FINAL: LaterMatch = { num: 104, from: [101, 102] }
// Tercer puesto: lo juegan los perdedores de las semifinales.
export const THIRD_PLACE: LaterMatch = { num: 103, from: [101, 102] }

export const ALL_LATER: LaterMatch[] = [...R16, ...QF, ...SF, THIRD_PLACE, FINAL]

// Clave de ronda de un partido de eliminatorias (para etiquetas i18n
// `bracket.<key>`). Numeración FIFA: 73-88 R32, 89-96 R16, 97-100 cuartos,
// 101-102 semis, 103 tercer puesto, 104 final.
export type RoundKey = 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final'
export function roundOf (num: number): RoundKey {
  if (num === FINAL.num) return 'final'
  if (num === THIRD_PLACE.num) return 'third'
  if (num >= 101) return 'sf'
  if (num >= 97) return 'qf'
  if (num >= 89) return 'r16'
  return 'r32'
}

/**
 * Asigna los 8 grupos cuyos terceros clasificaron a los 8 thirdSlots,
 * respetando los grupos permitidos por slot. Devuelve un arreglo indexado por
 * thirdSlot (0..7) con el índice de grupo asignado, o null si no hay 8 grupos
 * válidos. Usa backtracking determinista (aproxima el Anexo de la FIFA: la
 * combinación de 8 grupos determina la asignación).
 */
export function allocateThirds (qualifiedGroups: number[]): (number | null)[] {
  const result: (number | null)[] = new Array(THIRD_SLOTS.length).fill(null)
  if (qualifiedGroups.length !== THIRD_SLOTS.length) return result
  const used = new Set<number>()

  const solve = (slot: number): boolean => {
    if (slot >= THIRD_SLOTS.length) return true
    for (const g of THIRD_SLOTS[slot]!.allowed) {
      if (used.has(g) || !qualifiedGroups.includes(g)) continue
      used.add(g)
      result[slot] = g
      if (solve(slot + 1)) return true
      used.delete(g)
      result[slot] = null
    }
    return false
  }

  solve(0)
  return result
}
