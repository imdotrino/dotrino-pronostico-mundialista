import { test, expect } from '@playwright/test'

// Comprueba el LINK de compartir: empaquetado binario + punto P-256 comprimido
// + verificación de firma. Corre en el navegador (crypto.subtle) e importa el
// módulo real `parseShareFragment`. Como firmar requiere el vault de identidad
// (no fiable headless), generamos una clave de prueba y replicamos el mismo
// empaquetado que buildShareUrl, luego validamos el parseo/verificación.

test('el link de compartir se reconstruye y la firma verifica', async ({ page }) => {
  await page.goto('/')

  const r = await page.evaluate(async () => {
    const { parseShareFragment } = await import('/src/lib/share.ts')
    const subtle = globalThis.crypto.subtle

    const b64url = (bytes: Uint8Array): string => {
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b)
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }
    const b64urlToBytes = (s: string): Uint8Array => {
      const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
      const o = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
      return o
    }

    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await subtle.exportKey('jwk', kp.privateKey) as JsonWebKey
    const code = 'K4AAAsAAAADSL6VEoAAAAIAAAAA'
    const name = 'Mi pronóstico ñ'
    const nick = 'gato'

    // Empaqueta como buildShareUrl: firma `signCode` pero mete `packCode` en el
    // blob (normalmente iguales; distintos sirven para el caso de firma inválida).
    const buildFrag = async (packCode: string, signCode: string): Promise<string> => {
      const sig = new Uint8Array(await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey,
        new TextEncoder().encode(JSON.stringify(signCode)),
      ))
      const x = b64urlToBytes(jwk.x as string)
      const y = b64urlToBytes(jwk.y as string)
      const prefix = (y[31]! & 1) === 1 ? 0x03 : 0x02
      const cb = b64urlToBytes(packCode)
      const nameB = new TextEncoder().encode(name)
      const nickB = new TextEncoder().encode(nick)
      const parts = [
        Uint8Array.of(1), sig, Uint8Array.of(prefix), x,
        Uint8Array.of((cb.length >> 8) & 255, cb.length & 255), cb,
        Uint8Array.of(nickB.length), nickB,
        Uint8Array.of(nameB.length), nameB,
      ]
      const total = parts.reduce((s, p) => s + p.length, 0)
      const blob = new Uint8Array(total)
      let off = 0
      for (const p of parts) { blob.set(p, off); off += p.length }
      return b64url(blob)
    }

    // Caso válido: firma y código coinciden.
    const ok = await parseShareFragment(await buildFrag(code, code))
    // Caso inválido: el código del blob no es el firmado → la firma no verifica.
    const bad = await parseShareFragment(await buildFrag('OTR0CODIGO__', code))

    return {
      verified: ok?.verified, codeOk: ok?.code === code, name: ok?.name, nick: ok?.nickname,
      badVerified: bad?.verified, badCode: bad?.code,
    }
  })

  expect(r.verified).toBe(true)
  expect(r.codeOk).toBe(true)
  expect(r.name).toBe('Mi pronóstico ñ')
  expect(r.nick).toBe('gato')
  // El fragmento manipulado se lee pero NO verifica.
  expect(r.badVerified).toBe(false)
  expect(r.badCode).toBe('OTR0CODIGO__')
})
