// Rating derivado (web-of-trust) — portado del messenger del ecosistema.
// Regla: si tengo mi propio rating del peer, ese gana; si no, promedio
// ponderado de los endorsements cuyo autor es alguien a quien yo he valorado
// (peso = miConfianza / 5). Los endorsements de desconocidos se ignoran.

import type { PeerInfo } from '@dotrino/identity'

export interface DerivedRating {
  value: number | null
  source: 'mine' | 'derived' | null
  count: number
}

export function buildTrustMap (peers: PeerInfo[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const p of peers) {
    const r = p?.myRating?.rating
    if (typeof r === 'number' && r > 0) map.set(p.publickey, r)
  }
  return map
}

export function computeDerivedRating (peer: PeerInfo | null, ratedByMap: Map<string, number>): DerivedRating {
  if (!peer) return { value: null, source: null, count: 0 }
  const mine = peer.myRating
  if (mine && typeof mine.rating === 'number') return { value: mine.rating, source: 'mine', count: 1 }

  const list = Array.isArray(peer.endorsements) ? peer.endorsements : []
  let weightedSum = 0
  let totalWeight = 0
  let count = 0
  for (const e of list) {
    if (!e || typeof e.rating !== 'number') continue
    const trust = ratedByMap.get(e.ratedBy)
    if (typeof trust !== 'number' || trust <= 0) continue
    const weight = trust / 5
    weightedSum += e.rating * weight
    totalWeight += weight
    count++
  }
  if (count === 0 || totalWeight === 0) return { value: null, source: null, count: 0 }
  return { value: weightedSum / totalWeight, source: 'derived', count }
}

/** Acorta una clave pública JWK (string) para mostrar. */
export function shortKey (publickey: string): string {
  try {
    const jwk = JSON.parse(publickey)
    const x = String(jwk.x || '')
    return x.slice(0, 6) + '…' + x.slice(-6)
  } catch {
    return publickey.slice(0, 10) + '…'
  }
}
