// Librería de pronósticos guardada en localStorage: los míos (editables) y los
// importados de otras personas (firmados, solo lectura).

import type { GameMode, Scope, Results } from './standings'
import { pullThread, syncThread, THREAD_PREDICTIONS } from './cloud'

export interface SavedAuthor {
  publickey: string
  nickname?: string
  verified: boolean
}

/** Sello de tiempo PERSISTENTE de un pronóstico propio (TSA signer.dotrino.com).
 *  Se crea con el botón "Sellar" (o implícitamente al compartir) y queda guardado
 *  con el código EXACTO que se selló: si `code` del entry cambia (se editó), el
 *  sello queda obsoleto hasta volver a sellar (o cancelar la edición). Al
 *  compartir/aportar a una sala se REUTILIZA, así la fecha certificada es la del
 *  último sellado y no la de cada compartida. */
export interface SavedSeal {
  /** instante del sellado (ms epoch, reloj del sellador) */
  ts: number
  /** firma del sellador (base64url, 64 bytes ECDSA P-256 r‖s) */
  sig: string
  /** código del pronóstico que se selló (si difiere del actual, no aplica) */
  code: string
}

/** Sello del TSA de UN pick del pronóstico de la fecha (ver matchday.ts):
 *  certifica que ese marcador, de este autor, existió en `ts` (antes del
 *  kickoff si se selló a tiempo). `sig` en base64url (64 bytes r‖s). */
export interface MatchSealRecord {
  ts: number
  sig: string
}

export interface SavedPrediction {
  id: string
  name: string
  /** código compacto del pronóstico (lo que viaja en el QR/enlace) */
  code: string
  updatedAt: number
  /** true = propio y editable; false = importado de otra persona (solo lectura) */
  mine: boolean
  /** true = entrada de RESULTADOS oficiales (única; sección aparte en la barra). */
  official?: boolean
  /** true = el pronóstico DE LA FECHA (único por cuenta; sección propia, no
   *  aparece en la lista de pronósticos clásicos). Ver matchday.ts. */
  daily?: boolean
  /** Sellos POR PARTIDO del pronóstico de la fecha (id interno → sello). */
  dailySeals?: Record<number, MatchSealRecord>
  author?: SavedAuthor
  /** Enlace original firmado (solo importados): se reusa al compartir/imprimir
   *  un pronóstico ajeno, sin re-firmarlo con la identidad propia. */
  sharedUrl?: string
  /** Sello de tiempo guardado (solo propios). Ver SavedSeal. */
  seal?: SavedSeal
  // Datos de resultados (solo locales; no viajan en el código compartido).
  mode?: GameMode
  // Alcance del pronóstico (grupos/llaves/ambas). El código ya lo lleva, pero se
  // guarda también aquí para mostrarlo sin decodificar. Ausente = 'all' (legacy).
  scope?: Scope
  results?: Results
  // Borrador de posiciones del modo manual (solo local; no viaja en el código).
  draftGroupOrder?: number[][]
  draftThirdsRank?: number[]
}

const LIB_KEY = 'mundial.library.v1'
const ACTIVE_KEY = 'mundial.activeId.v1'

export function genId (): string {
  return (crypto.randomUUID?.() ?? 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
}

export function loadLibrary (): SavedPrediction[] {
  try {
    const raw = localStorage.getItem(LIB_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

// Marca de versión del registro para el sync: sellar NO bumpea updatedAt (para
// que un autosellado en un dispositivo desactualizado no gane el LWW de
// contenido), así que el ts del registro incluye el sello para que igual se suba.
function recordTs (p: SavedPrediction): number {
  return Math.max(p.updatedAt || 0, p.seal?.ts || 0)
}

export function saveLibrary (list: SavedPrediction[]): void {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(list)) } catch { /* */ }
  // Espejo en la nube (fire-and-forget; no bloquea ni rompe si el store no está).
  void syncThread(THREAD_PREDICTIONS, list.map((p) => ({ id: p.id, ts: recordTs(p), data: p })))
}

/**
 * Trae los pronósticos del store del ecosistema y los fusiona con la lista local
 * (last-writer-wins por `updatedAt`). Devuelve la lista fusionada y si cambió.
 * Pensado para correr en segundo plano al arrancar (no bloquea el render).
 * El SELLO se fusiona aparte del contenido: como sellar no bumpea updatedAt, el
 * lado que pierde el LWW puede traer un sello que el ganador no tiene; si ese
 * sello corresponde al código del ganador (mismo code) se conserva, prefiriendo
 * siempre el más antiguo (la fecha certificada más temprana es la que vale).
 */
export async function hydrateLibrary (local: SavedPrediction[]): Promise<{ list: SavedPrediction[]; changed: boolean }> {
  const remote = await pullThread<SavedPrediction>(THREAD_PREDICTIONS)
  if (!remote.length) return { list: local, changed: false }
  const byId = new Map(local.map((p) => [p.id, p]))
  let changed = false
  for (const r of remote) {
    if (!r?.id) continue
    const cur = byId.get(r.id)
    if (!cur) { byId.set(r.id, r); changed = true; continue }
    const remoteWins = (r.updatedAt || 0) > (cur.updatedAt || 0)
    const winner = remoteWins ? r : cur
    const loser = remoteWins ? cur : r
    const ls = loser.seal
    if (ls && ls.code === winner.code &&
        (!winner.seal || winner.seal.code !== winner.code || ls.ts < winner.seal.ts)) {
      winner.seal = ls
      changed = true
    }
    if (remoteWins) { byId.set(r.id, r); changed = true }
  }
  return { list: [...byId.values()], changed }
}

export function getActiveId (): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}
export function setActiveId (id: string): void {
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* */ }
}
