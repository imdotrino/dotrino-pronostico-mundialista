// Utilidades de bytes y serialización compartidas por share, codec, matchday,
// officialResults y signer. Una sola copia: antes había cuatro y no eran iguales.

/** base64 o base64url → bytes. */
export function b64ToBytes (b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const b64urlToBytes = b64ToBytes

export function bytesToB64url (bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of u8) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Serialización canónica idéntica a vault / proxy / servidor del signer. */
export function canonicalStringify (v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']'
  const ks = Object.keys(v as Record<string, unknown>).sort()
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canonicalStringify((v as Record<string, unknown>)[k])).join(',') + '}'
}

/** ¿`sig` (ECDSA P-256, SHA-256) firma `data` con la pública `jwk`? Una llave o firma ilegible es `false`. */
export async function verifyEcdsa (jwk: JsonWebKey, sig: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, sig as BufferSource, data as BufferSource)
  } catch (e) {
    console.warn('signature check failed:', e)
    return false
  }
}
