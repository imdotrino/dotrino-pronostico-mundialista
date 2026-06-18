// Cliente del sellador de tiempo (TSA) del ecosistema: signer.dotrino.com.
//
// No hay librería npm: el servicio es HTTP plano. Acá está la ÚNICA copia del
// protocolo de sellado/verificación de esta app (firmar/verificar deben usar
// exactamente los mismos bytes que firma el servidor). Ver README de
// dotrino-signer como fuente de verdad.
//
// El sello prueba CUÁNDO existió un pronóstico: el sellador firma con SU clave
// el par { hash, ts }, y como el autor no controla esa clave, no puede falsear
// la fecha. El sellador solo ve el hash, nunca el pronóstico.

export const SIGNER_URL = 'https://signer.dotrino.com'

// Pubkey de producción del sellador, PINEADA: la confianza no depende de la
// `pubkey` que venga en el sello, sino de esta clave conocida.
export const SIGNER_PUBKEY =
  '{"kty":"EC","x":"Cqkk1aCZ5M2qI5-7aYkb61ezUql6owBJawe3V06kOVE","y":"0Wp-0IqjDSsCuoVXBIFsmsKcqLp8YBgmUcTPcMiaEAI","crv":"P-256"}'

export interface PredictionSeal {
  /** Instante del sellado (ms epoch, reloj del sellador). */
  ts: number
  /** Firma ECDSA P-256 (r‖s, 64 bytes) del sellador. */
  sig: Uint8Array
}

// Serialización canónica idéntica a vault / proxy / servidor del signer.
function canonicalStringify (v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']'
  const ks = Object.keys(v as Record<string, unknown>).sort()
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canonicalStringify((v as Record<string, unknown>)[k])).join(',') + '}'
}

function bufToB64url (buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64ToBytes (b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** SHA-256 de bytes, en base64url (formato que espera el sellador). */
export async function sha256Base64url (bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return bufToB64url(digest)
}

// Cache en memoria por hash: evita pedir un sello nuevo en cada render de QR /
// compartir del mismo pronóstico.
const sealCache = new Map<string, PredictionSeal>()

/**
 * Pide un sello para un hash (best-effort). Devuelve null si el sellador no
 * responde: el pronóstico se comparte igual, sin fecha verificable.
 */
export async function requestSeal (hashB64url: string): Promise<PredictionSeal | null> {
  const cached = sealCache.get(hashB64url)
  if (cached) return cached
  try {
    // Timeout: un sellador lento/caído NO debe bloquear el compartir (best-effort).
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(SIGNER_URL + '/seal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hashB64url }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const j = await res.json() as { op?: string; ts?: number; signature?: string }
    if (j.op !== 'seal' || typeof j.ts !== 'number' || !j.signature) return null
    const seal: PredictionSeal = { ts: j.ts, sig: b64ToBytes(j.signature) }
    sealCache.set(hashB64url, seal)
    return seal
  } catch {
    return null
  }
}

/**
 * Verifica el sello contra la pubkey pineada del sellador.
 * @returns true si la firma del sellador sobre { op:'seal', hash, ts } es válida.
 */
export async function verifySeal (hashB64url: string, ts: number, sig: Uint8Array): Promise<boolean> {
  try {
    const jwk = JSON.parse(SIGNER_PUBKEY)
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const bytes = new TextEncoder().encode(canonicalStringify({ op: 'seal', hash: hashB64url, ts }))
    return await crypto.subtle.verify({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, sig as BufferSource, bytes as BufferSource)
  } catch {
    return false
  }
}
