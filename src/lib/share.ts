// Firma del pronóstico con la identidad ECDSA P-256 del vault id.dotrino.com
// y armado del enlace/QR de compartir hacia pronostico.dotrino.com.
//
// Para que el QR sea lo más liviano posible, el payload se empaqueta en UN solo
// blob binario (base64url una sola vez), en vez de un JSON con campos ya en
// base64 (que duplicaba el tamaño). Layout (versión 1):
//   [0]      versión (=1)
//   [1..65)  firma ECDSA P-256 cruda (64 bytes)
//   [65]     prefijo del punto comprimido de la clave pública (0x02/0x03)
//   [66..98) coordenada X de la clave pública (32 bytes)  → punto comprimido
//   [98..100) longitud del código (uint16 big-endian)
//   [100..]  bytes del código del pronóstico
//   [+]      apodo: 1 byte de longitud + UTF-8
//   [+]      nombre: 1 byte de longitud + UTF-8 (máx 50 caracteres)
// Los enlaces viejos (JSON) se siguen leyendo por compatibilidad.
//
// Versión 2: idéntica a la 1 y, al final, un SELLO DE TIEMPO del sellador
// (signer.dotrino.com) que garantiza CUÁNDO existió el pronóstico:
//   [+]      ts: 6 bytes big-endian (ms epoch, reloj del sellador)
//   [+]      firma del sellador: 64 bytes (ECDSA P-256 r‖s)
// El sello se firma sobre el hash SHA-256 de (code ‖ X ‖ Y), atándolo al
// contenido y al autor. Se verifica contra la pubkey pineada del sellador.

import { getIdentity } from './identity'
import { requestSeal, verifySeal, sha256Base64url, type PredictionSeal } from './signer'

export { getIdentity }
export type { PredictionSeal }

export const SHARE_BASE = 'https://pronostico.dotrino.com/'

const PAYLOAD_VERSION = 1
const PAYLOAD_VERSION_SEALED = 2

// ---- base64 / base64url ----------------------------------------------------

export function b64ToBytes (b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function b64urlToBytes (s: string): Uint8Array {
  return b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/'))
}
export function bytesToB64url (bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// El vault firma canonicalStringify(data); para un string eso es
// JSON.stringify(string). Lo replicamos para verificar.
export function canonicalBytes (code: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(code))
}

// ---- punto P-256: compresión y descompresión (BigInt) ----------------------

const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn
const P256_A = P256_P - 3n

function bytesToBig (b: Uint8Array): bigint {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n
}
function bigTo32 (n: bigint): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n }
  return out
}
function modpow (base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod
    base = (base * base) % mod
    exp >>= 1n
  }
  return r
}

// Reconstruye la coordenada Y (32 bytes) a partir de X y la paridad (prefijo
// 0x03 → impar). P-256 cumple p ≡ 3 (mod 4): y = (y²)^((p+1)/4) mod p.
export function decompressY (xBytes: Uint8Array, odd: boolean): Uint8Array {
  const x = bytesToBig(xBytes)
  const rhs = (modpow(x, 3n, P256_P) + P256_A * x + P256_B) % P256_P
  let y = modpow(rhs, (P256_P + 1n) / 4n, P256_P)
  if ((y & 1n) !== (odd ? 1n : 0n)) y = P256_P - y
  return bigTo32(y)
}

// ---- API -------------------------------------------------------------------

export function concatBytes (parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// ts (ms epoch) en 6 bytes big-endian: alcanza hasta el año ~10889.
function ts6ToBytes (ts: number): Uint8Array {
  const out = new Uint8Array(6)
  let n = Math.floor(ts)
  for (let i = 5; i >= 0; i--) { out[i] = n & 0xff; n = Math.floor(n / 256) }
  return out
}
function bytesToTs6 (b: Uint8Array): number {
  let n = 0
  for (let i = 0; i < 6; i++) n = n * 256 + b[i]!
  return n
}

// Hash que sella el sellador: ata el sello al CONTENIDO (code) y al AUTOR (X,Y
// del punto público). Bytes idénticos al firmar y al verificar.
function predictionSealHash (codeBytes: Uint8Array, xBytes: Uint8Array, yBytes: Uint8Array): Promise<string> {
  return sha256Base64url(concatBytes([codeBytes, xBytes, yBytes]))
}

/**
 * Sella un código de pronóstico con la identidad propia SIN compartirlo (botón
 * "Sellar"): mismo hash que al compartir (code ‖ X ‖ Y), así el sello obtenido
 * se reutiliza después en el enlace/aporte a sala. Devuelve null si no hay
 * identidad o el sellador no responde.
 */
export async function sealPredictionCode (code: string): Promise<PredictionSeal | null> {
  const id = await getIdentity()
  if (!id?.me?.publickey) return null
  const jwk = JSON.parse(id.me.publickey) as { x: string; y: string }
  const hash = await predictionSealHash(b64urlToBytes(code), b64urlToBytes(jwk.x), b64urlToBytes(jwk.y))
  return requestSeal(hash)
}

/**
 * Firma el código del pronóstico y arma el enlace compartible (blob binario).
 * Lanza si no hay identidad disponible.
 * `presetSeal`: sello GUARDADO del pronóstico (botón "Sellar"); si sigue siendo
 * válido para este código+autor se reutiliza (la fecha certificada es la del
 * sellado original, no la de esta compartida). Si no, se pide uno nuevo.
 * Devuelve también el sello usado, para que el caller lo persista.
 */
export async function buildShareUrl (code: string, name?: string, presetSeal?: PredictionSeal | null): Promise<{ url: string; publickey: string; nickname?: string; seal: PredictionSeal | null }> {
  const id = await getIdentity()
  if (!id) throw new Error('No se pudo conectar a la identidad (id.dotrino.com).')

  const { signature, publickey } = await id.signData(code)
  const jwk = JSON.parse(publickey) as { x: string; y: string }
  const nickname = id.me?.nickname

  const sig = b64ToBytes(signature) // 64 bytes (r||s)
  const xBytes = b64urlToBytes(jwk.x) // 32 bytes
  const yBytes = b64urlToBytes(jwk.y) // 32 bytes
  const prefix = (yBytes[31]! & 1) === 1 ? 0x03 : 0x02 // paridad de Y
  const codeBytes = b64urlToBytes(code)
  const enc = new TextEncoder()
  const nickB = nickname ? enc.encode(nickname).slice(0, 255) : new Uint8Array(0)
  const nameB = name ? enc.encode(name.trim().slice(0, 50)).slice(0, 255) : new Uint8Array(0)

  // Sello de tiempo del sellador (best-effort): si no responde, se comparte sin
  // sello (= sin fecha verificable). El sellador pone la fecha, no nosotros.
  const sealHash = await predictionSealHash(codeBytes, xBytes, yBytes)
  let seal: PredictionSeal | null = null
  if (presetSeal && await verifySeal(sealHash, presetSeal.ts, presetSeal.sig)) seal = presetSeal
  if (!seal) seal = await requestSeal(sealHash)

  const head = [
    Uint8Array.of(seal ? PAYLOAD_VERSION_SEALED : PAYLOAD_VERSION),
    sig,
    Uint8Array.of(prefix),
    xBytes,
    Uint8Array.of((codeBytes.length >> 8) & 0xff, codeBytes.length & 0xff),
    codeBytes,
    Uint8Array.of(nickB.length), nickB,
    Uint8Array.of(nameB.length), nameB,
  ]
  if (seal) head.push(ts6ToBytes(seal.ts), seal.sig)
  const blob = concatBytes(head)

  return { url: `${SHARE_BASE}#${bytesToB64url(blob)}`, publickey, nickname, seal }
}

export interface IncomingPrediction {
  code: string
  verified: boolean
  nickname?: string
  /** nombre/título del pronóstico compartido (si vino en el enlace) */
  name?: string
  /** clave pública JWK (string) reconstruida, identifica al autor */
  publickey: string
  /** instante del sello de tiempo (ms epoch), si el enlace trae sello */
  sealedAt?: number
  /** ¿el sello del sellador es válido (firma correcta contra la pubkey pineada)? */
  sealValid?: boolean
  /** firma cruda del sellador (64 bytes): permite re-GUARDAR el sello al
   *  importar un pronóstico propio (recupera la fecha certificada original). */
  sealSig?: Uint8Array
}

/** Sello crudo extraído del blob (antes de verificar). */
interface RawSeal { ts: number; sig: Uint8Array; hash: string }

async function verifyAndBuild (
  code: string,
  sig: Uint8Array,
  jwk: { kty: string; crv: string; x: string; y: string; ext: boolean },
  nickname?: string,
  name?: string,
  rawSeal?: RawSeal | null,
): Promise<IncomingPrediction> {
  let verified = false
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } }, key,
      sig as BufferSource, canonicalBytes(code) as BufferSource,
    )
  } catch (e) { console.warn('Verificación de firma falló:', e) }
  const out: IncomingPrediction = { code, verified, nickname, name, publickey: JSON.stringify(jwk) }
  if (rawSeal) {
    out.sealedAt = rawSeal.ts
    out.sealValid = await verifySeal(rawSeal.hash, rawSeal.ts, rawSeal.sig)
    out.sealSig = rawSeal.sig
  }
  return out
}

/** Lee y verifica un pronóstico desde el fragmento del enlace (sin el #). */
export async function parseShareFragment (frag: string): Promise<IncomingPrediction | null> {
  let bytes: Uint8Array
  try { bytes = b64urlToBytes(frag) } catch { return null }
  if (bytes.length === 0) return null

  // Formato viejo (JSON): el primer byte es '{' (0x7B).
  if (bytes[0] === 0x7b) return parseJsonLegacy(bytes)

  // Formato binario (versión 1 sin sello, versión 2 con sello de tiempo).
  const version = bytes[0]
  if (version !== PAYLOAD_VERSION && version !== PAYLOAD_VERSION_SEALED) return null
  try {
    let pos = 1
    const sig = bytes.slice(pos, pos + 64); pos += 64
    const prefix = bytes[pos]!; pos += 1
    const xBytes = bytes.slice(pos, pos + 32); pos += 32
    const codeLen = (bytes[pos]! << 8) | bytes[pos + 1]!; pos += 2
    const codeBytes = bytes.slice(pos, pos + codeLen); pos += codeLen
    const nickLen = bytes[pos]!; pos += 1
    const nick = nickLen ? new TextDecoder().decode(bytes.slice(pos, pos + nickLen)) : undefined; pos += nickLen
    const nameLen = bytes[pos]!; pos += 1
    const name = nameLen ? new TextDecoder().decode(bytes.slice(pos, pos + nameLen)) : undefined; pos += nameLen

    const yBytes = decompressY(xBytes, prefix === 0x03)

    let rawSeal: RawSeal | null = null
    if (version === PAYLOAD_VERSION_SEALED && bytes.length >= pos + 6 + 64) {
      const ts = bytesToTs6(bytes.slice(pos, pos + 6)); pos += 6
      const sealSig = bytes.slice(pos, pos + 64); pos += 64
      const hash = await predictionSealHash(codeBytes, xBytes, yBytes)
      rawSeal = { ts, sig: sealSig, hash }
    }

    const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64url(xBytes), y: bytesToB64url(yBytes), ext: true }
    return verifyAndBuild(bytesToB64url(codeBytes), sig, jwk, nick, name, rawSeal)
  } catch { return null }
}

// ---- Blob genérico firmado -------------------------------------------------
// Reutiliza el mismo empaquetado (punto comprimido P-256 + firma ECDSA) que los
// pronósticos, pero el "contenido" es un string arbitrario: lo usan las SALAS
// para firmar el descriptor (JSON) del creador. Layout:
//   [0] versión · [1..65) firma · [65] prefijo · [66..98) X · [98..100) len · [+] contenido utf8
export async function signBlob (content: string, version: number): Promise<{ blob: string; publickey: string; nickname?: string }> {
  const id = await getIdentity()
  if (!id) throw new Error('No se pudo conectar a la identidad (id.dotrino.com).')
  const { signature, publickey } = await id.signData(content)
  const jwk = JSON.parse(publickey) as { x: string; y: string }
  const sig = b64ToBytes(signature)
  const xBytes = b64urlToBytes(jwk.x)
  const yBytes = b64urlToBytes(jwk.y)
  const prefix = (yBytes[31]! & 1) === 1 ? 0x03 : 0x02
  const contentB = new TextEncoder().encode(content)
  const blob = concatBytes([
    Uint8Array.of(version),
    sig,
    Uint8Array.of(prefix),
    xBytes,
    Uint8Array.of((contentB.length >> 8) & 0xff, contentB.length & 0xff),
    contentB,
  ])
  return { blob: bytesToB64url(blob), publickey, nickname: id.me?.nickname }
}

export interface VerifiedBlob { content: string; verified: boolean; publickey: string }

/** Lee y verifica un blob firmado genérico (descriptor de sala). */
export async function verifyBlob (frag: string, version: number): Promise<VerifiedBlob | null> {
  let bytes: Uint8Array
  try { bytes = b64urlToBytes(frag) } catch { return null }
  if (bytes.length < 1 + 64 + 33 + 2) return null
  if (bytes[0] !== version) return null
  try {
    let pos = 1
    const sig = bytes.slice(pos, pos + 64); pos += 64
    const prefix = bytes[pos]!; pos += 1
    const xBytes = bytes.slice(pos, pos + 32); pos += 32
    const len = (bytes[pos]! << 8) | bytes[pos + 1]!; pos += 2
    const content = new TextDecoder().decode(bytes.slice(pos, pos + len))
    const yBytes = decompressY(xBytes, prefix === 0x03)
    const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64url(xBytes), y: bytesToB64url(yBytes), ext: true }
    let verified = false
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      verified = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } }, key,
        sig as BufferSource, canonicalBytes(content) as BufferSource,
      )
    } catch (e) { console.warn('verifyBlob falló:', e) }
    return { content, verified, publickey: JSON.stringify(jwk) }
  } catch { return null }
}

// Compatibilidad con enlaces viejos en JSON.
interface LegacyPayload { c: string; s: string; x: string; y: string; n?: string; t?: string }
async function parseJsonLegacy (bytes: Uint8Array): Promise<IncomingPrediction | null> {
  let payload: LegacyPayload
  try { payload = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (!payload?.c || !payload?.s || !payload?.x || !payload?.y) return null
  const jwk = { kty: 'EC', crv: 'P-256', x: payload.x, y: payload.y, ext: true }
  return verifyAndBuild(payload.c, b64ToBytes(payload.s), jwk, payload.n, payload.t?.slice(0, 50))
}
