// EL VAULT DE PRUEBA, EN UN SOLO SITIO.
//
// Firmar (y ahora también CIFRAR) requiere el vault de identidad, que headless no es
// fiable, así que los e2e inyectan uno de mentira en `window.__TEST_VAULT_PROMISE__`
// (hook que `lib/identity.ts` usa solo en tests; en producción nunca está seteado).
//
// Estaba copiado en tres specs, y al añadirle la mitad de CIFRADO —que es lo que necesita
// el sellado de los mensajes dirigidos (CONVENCIONES §4.1)— tres copias habrían sido dos
// que se quedan atrás. Esto NO es cripto nueva: es exactamente lo que hace el núcleo de
// `@dotrino/identity` —ECDSA P-256 para firmar, ECDH P-256 + AES-GCM para cifrar—, con
// las llaves generadas en el navegador.
//
// `llaves()` sirve para el caso en que la MISMA persona tiene que volver en otra pestaña
// (apagarse y encenderse): sin llaves fijas sería otra identidad.

import type { BrowserContext } from '@playwright/test'

const SIG = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export interface VaultKeys {
  sigPriv: JsonWebKey; sigPub: JsonWebKey
  encPriv: JsonWebKey; encPub: JsonWebKey
}

/** Llaves fijas para una identidad que tiene que sobrevivir a cerrar la pestaña. */
export async function llaves (): Promise<VaultKeys> {
  const s = await crypto.subtle.generateKey(SIG, true, ['sign', 'verify'])
  const e = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  return {
    sigPriv: await crypto.subtle.exportKey('jwk', s.privateKey),
    sigPub: await crypto.subtle.exportKey('jwk', s.publicKey),
    encPriv: await crypto.subtle.exportKey('jwk', e.privateKey),
    encPub: await crypto.subtle.exportKey('jwk', e.publicKey),
  }
}

/**
 * El script de init. Sin `keys` genera un par nuevo en el navegador (lo de siempre);
 * con `keys`, reusa los dados — misma persona en otra pestaña.
 */
export function vaultInit (nick: string, keys?: VaultKeys): string {
  return `
window.__TEST_VAULT_PROMISE__ = (async () => {
  const sub = crypto.subtle;
  const FIJAS = ${keys ? JSON.stringify(keys) : 'null'};
  let sigPriv, sigPubJwk, encPriv, encPubJwk;
  if (FIJAS) {
    sigPriv = await sub.importKey('jwk', FIJAS.sigPriv, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
    sigPubJwk = FIJAS.sigPub;
    encPriv = await sub.importKey('jwk', FIJAS.encPriv, { name:'ECDH', namedCurve:'P-256' }, false, ['deriveBits']);
    encPubJwk = FIJAS.encPub;
  } else {
    const s = await sub.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
    const e = await sub.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
    sigPriv = s.privateKey; sigPubJwk = await sub.exportKey('jwk', s.publicKey);
    encPriv = e.privateKey; encPubJwk = await sub.exportKey('jwk', e.publicKey);
  }
  const pub = JSON.stringify({ kty:'EC', crv:'P-256', x:sigPubJwk.x, y:sigPubJwk.y, ext:true });
  const encPub = JSON.stringify({ kty:'EC', crv:'P-256', x:encPubJwk.x, y:encPubJwk.y });
  const canon = (v) => (v===null||typeof v!=='object') ? JSON.stringify(v)
    : Array.isArray(v) ? '['+v.map(canon).join(',')+']'
    : '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
  const b64 = (b) => { let s=''; for (const x of new Uint8Array(b)) s+=String.fromCharCode(x); return btoa(s); };
  const unb64 = (s) => { const bin=atob(s); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return a; };
  const compartida = async (peerStr) => {
    const p = await sub.importKey('jwk', JSON.parse(peerStr), { name:'ECDH', namedCurve:'P-256' }, false, []);
    const bits = await sub.deriveBits({ name:'ECDH', public:p }, encPriv, 256);
    return sub.importKey('raw', bits, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
  };
  const idDe = async (s) => b64(await sub.digest('SHA-256', new TextEncoder().encode(s))).slice(0,16);
  let nickname = ${JSON.stringify(nick)};
  return {
    me: { publickey: pub, nickname },
    async signData(data){
      const sig = await sub.sign({name:'ECDSA',hash:'SHA-256'}, sigPriv, new TextEncoder().encode(canon(data)));
      return { signature: b64(sig), publickey: pub };
    },
    // --- la mitad de CIFRADO: lo que hace posible sellar lo dirigido (§4.1) ---
    async getEncryptionPubkey(){ return encPub; },
    async encrypt(recipients, plaintext){
      const k = await sub.generateKey({name:'AES-GCM',length:256}, true, ['encrypt','decrypt']);
      const raw = await sub.exportKey('raw', k);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await sub.encrypt({name:'AES-GCM',iv}, k, new TextEncoder().encode(plaintext));
      const wrap = {};
      for (const r of recipients || []) {
        if (!r || !r.encryptionPubkey) continue;
        let sk; try { sk = await compartida(r.encryptionPubkey); } catch (e) { continue; }
        const wiv = crypto.getRandomValues(new Uint8Array(12));
        wrap[await idDe(r.encryptionPubkey)] = { iv: b64(wiv), ct: b64(await sub.encrypt({name:'AES-GCM',iv:wiv}, sk, raw)) };
      }
      return { v:2, iv: b64(iv), ct: b64(ct), wrap };
    },
    async decrypt(senderEncPub, _token, env){
      const mio = env && env.wrap && env.wrap[await idDe(encPub)];
      if (!mio) throw new Error('this device is not among the message recipients');
      const sk = await compartida(senderEncPub);
      const raw = await sub.decrypt({name:'AES-GCM',iv:unb64(mio.iv)}, sk, unb64(mio.ct));
      const k = await sub.importKey('raw', raw, {name:'AES-GCM'}, false, ['decrypt']);
      const pt = await sub.decrypt({name:'AES-GCM',iv:unb64(env.iv)}, k, unb64(env.ct));
      return { plaintext: new TextDecoder().decode(pt) };
    },
    async listContacts(){ return []; },
    async setMyNickname(a){ nickname = (a && a.nickname) || nickname; this.me.nickname = nickname; },
  };
})();`
}

/** EL ESPÍA DEL CABLE: cada frame que sube y cada uno que baja, tal cual. */
export const wireInit = `
window.__CABLE__ = [];
(() => {
  const Real = window.WebSocket;
  class Espia extends Real {
    constructor (...a) {
      super(...a);
      this.addEventListener('message', (e) => { try { window.__CABLE__.push(String(e.data)) } catch (_) {} });
    }
    send (t) { try { window.__CABLE__.push(String(t)) } catch (_) {}; return super.send(t); }
  }
  Espia.OPEN = Real.OPEN; Espia.CLOSED = Real.CLOSED;
  window.WebSocket = Espia;
})();`

export async function installVault (context: BrowserContext, nick: string, keys?: VaultKeys) {
  await context.addInitScript(vaultInit(nick, keys))
}
