<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PeerInfo } from '@dotrino/identity'
import { getIdentity, type IdentityInstance } from '../lib/identity'
import { getReputation } from '../lib/reputation'
import { buildTrustMap, computeDerivedRating, shortKey } from '../lib/rating'
import { resolveTokenToIdentity, ProxyTokenError } from '../lib/proxy'
import { useNotifications } from '../lib/notifications'
import { createVaultProfileProvider } from '@dotrino/profile'
import '@dotrino/profile'

const { t, locale } = useI18n()

const notif = useNotifications()
async function toggleNotif () {
  if (notif.enabled.value) await notif.disable()
  else await notif.enable()
}

const props = defineProps<{ open: boolean; focusPubkey?: string | null; focusNick?: string | null; requireNick?: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()

type Tab = 'perfil' | 'contactos' | 'rankings'
const tab = ref<Tab>('perfil')

const id = ref<IdentityInstance | null>(null)
const unreachable = ref(false)
const myNick = ref('')
const myPubkey = computed(() => id.value?.me?.publickey ?? null)

// Copiar la clave pública COMPLETA del vault (el perfil solo muestra la corta).
// Sirve, p.ej., para registrarse como admin de resultados oficiales en el relay.
const copiedKey = ref(false)
async function copyMyPubkey (): Promise<void> {
  const pk = myPubkey.value
  if (!pk) return
  try {
    await navigator.clipboard.writeText(pk)
    copiedKey.value = true
    setTimeout(() => { copiedKey.value = false }, 2000)
  } catch { /* clipboard no disponible: el usuario puede seleccionar el texto */ }
}

const contacts = ref<PeerInfo[]>([])
const peers = ref<PeerInfo[]>([])
const newToken = ref('')
const newNick = ref('')
const addError = ref('')
const addStatus = ref('')   // mensaje de progreso ("Buscando token…", éxito)
const adding = ref(false)

const trustMap = computed(() => buildTrustMap(peers.value))
const ranking = computed(() =>
  [...peers.value]
    .map((p) => ({ peer: p, r: computeDerivedRating(p, trustMap.value) }))
    .filter((x) => x.r.value != null)
    .sort((a, b) => (b.r.value ?? 0) - (a.r.value ?? 0)),
)

// Provider compartido del ecosistema para <dotrino-profile> (vault + registro
// de reputación). Mismo que usan el resto de apps; no se reimplementa la tarjeta.
let _provider: any = null
async function ensureProvider () {
  if (_provider) return _provider
  const [identity, reputation] = await Promise.all([getIdentity(), getReputation()])
  if (reputation) _provider = createVaultProfileProvider({ identity, reputation })
  return _provider
}
function bindProfile (el: any) {
  if (!el) return
  ensureProvider().then((p) => { if (p) el.provider = p })
}
// Tema oscuro del pronosticador (azure/gold sobre panel) para el Web Component.
const profileTheme: Record<string, string> = {
  '--ccp-bg': 'var(--panel)',
  '--ccp-bg-2': 'var(--panel-2)',
  '--ccp-bg-3': 'var(--panel-2)',
  '--ccp-bg-4': 'rgba(233, 242, 255, 0.18)',
  '--ccp-border': 'var(--line)',
  '--ccp-text': 'var(--text)',
  '--ccp-muted': 'var(--muted)',
  '--ccp-accent': 'var(--azure)',
  '--ccp-accent-2': 'var(--azure-dim)',
  '--ccp-gold': 'var(--gold)',
  '--ccp-derived': 'var(--gold)',
  '--ccp-online': 'var(--azure)',
  '--ccp-affinity': '#ff7aa8',
  '--ccp-input-bg': 'var(--panel-2)',
  '--ccp-radius': '12px',
}

// Perfil de un peer (contacto o ranking): tarjeta compartida en modo edición
// (permite calificarlo). Al guardar, refrescamos para recomputar el ranking.
const peerPk = ref<string | null>(null)
const peerName = ref('')
function openPeerProfile (pk: string, name?: string | null) {
  if (!pk || pk === myPubkey.value) return
  peerName.value = name || ''
  peerPk.value = pk
}
function onPeerRate () { refresh() }

// Mi nombre lo guarda el propio Web Component (mode="self") en el vault.
function onMyName (e: any) { const n = e?.detail?.name; if (typeof n === 'string') { myNick.value = n; emit('changed') } }

async function load () {
  const inst = await getIdentity()
  id.value = inst
  if (!inst) { unreachable.value = true; return }
  unreachable.value = false
  myNick.value = inst.me?.nickname ?? ''
  // Si se exige apodo (para compartir), abrimos en Perfil.
  if (props.requireNick) tab.value = 'perfil'
  await refresh()
  if (props.focusPubkey) {
    // Enfocados en un pubkey concreto (p.ej. el autor de un pronóstico firmado):
    // ya tenemos su clave pública, así que lo agregamos como contacto SIN token
    // y dejamos lista la pestaña de contactos para valorarlo.
    tab.value = 'contactos'
    // Autollenamos el apodo con el que el autor firmó (viene en el link) y lo
    // dejamos visible en el formulario.
    if (props.focusNick) newNick.value = props.focusNick
    const pk = props.focusPubkey
    const exists = contacts.value.some((c) => c.publickey === pk)
    if (!exists && pk !== inst.me?.publickey) {
      try {
        await inst.addContact({ publickey: pk, nickname: props.focusNick || undefined })
        await refresh()
        emit('changed')
      } catch (e) {
        addError.value = e instanceof Error ? e.message : String(e)
      }
    }
  }
}

async function refresh () {
  if (!id.value) return
  contacts.value = await id.value.listContacts().catch(() => [])
  peers.value = await id.value.listPeers().catch(() => [])
}

watch(() => props.open, (o) => { if (o) load() })

async function addContact () {
  addError.value = ''
  addStatus.value = ''
  if (!id.value || adding.value) return

  // Si estamos enfocados en un autor (ya tenemos su clave) y no se escribió
  // token, lo agregamos directamente por su clave pública (no hace falta token).
  const token = newToken.value.trim().toUpperCase()
  if (props.focusPubkey && !token) {
    adding.value = true
    try {
      await id.value.addContact({ publickey: props.focusPubkey, nickname: newNick.value.trim() || props.focusNick || undefined })
      newNick.value = ''
      addStatus.value = t('identity.contactAdded')
      await refresh()
      emit('changed')
    } catch (e) {
      addError.value = e instanceof Error ? e.message : String(e)
    } finally { adding.value = false }
    return
  }

  // Normalizamos el token tal como hace el messenger: mayúsculas, sin espacios.
  if (!/^[A-Z0-9]{4,8}$/.test(token)) {
    addError.value = t('identity.tokenInvalid')
    return
  }

  adding.value = true
  addStatus.value = t('identity.searchingToken')
  try {
    // Resolvemos el token → identidad real (clave pública) vía el proxy:
    // mandamos un challenge firmado y verificamos la respuesta del peer.
    const resolved = await resolveTokenToIdentity(token, id.value)

    if (resolved.publickey === id.value.me?.publickey) {
      addError.value = t('identity.tokenIsYours')
      addStatus.value = ''
      return
    }

    await id.value.addContact({
      publickey: resolved.publickey,
      // Preferimos el apodo que escribió el usuario; si no, el que anunció el peer.
      nickname: newNick.value.trim() || resolved.nickname || undefined,
      encryptionPubkey: resolved.encryptionPubkey || undefined,
      lastToken: token,
    })
    newToken.value = ''
    newNick.value = ''
    addStatus.value = t('identity.contactAdded')
    await refresh()
    emit('changed')
  } catch (e) {
    addStatus.value = ''
    if (e instanceof ProxyTokenError) {
      addError.value = e.message
    } else {
      addError.value = t('identity.addError')
    }
  } finally {
    adding.value = false
  }
}

async function removeContact (pk: string) {
  if (!id.value) return
  await id.value.removeContact(pk)
  await refresh(); emit('changed')
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="panel">
      <button class="x" @click="emit('close')" :aria-label="t('common.close')">×</button>
      <h3>{{ t('identity.title') }}</h3>

      <nav class="ptabs">
        <button :class="{ on: tab === 'perfil' }" @click="tab = 'perfil'">{{ t('identity.tabProfile') }}</button>
        <button :class="{ on: tab === 'contactos' }" @click="tab = 'contactos'">{{ t('identity.tabContacts') }}</button>
        <button :class="{ on: tab === 'rankings' }" @click="tab = 'rankings'">{{ t('identity.tabRankings') }}</button>
      </nav>

      <i18n-t v-if="unreachable" keypath="identity.unreachable" tag="p" class="warn" scope="global">
        <template #vault><code>id.dotrino.com</code></template>
      </i18n-t>

      <!-- PERFIL: tarjeta compartida del ecosistema en modo self (nombre editable
           guardado en el vault + mi reputación). Las notificaciones push son
           propias de esta app y van debajo. -->
      <section v-show="tab === 'perfil'" class="body">
        <p v-if="requireNick && !myNick" class="focus-note">{{ t('identity.requireNickShare') }}</p>
        <dotrino-profile
          v-if="!unreachable && myPubkey"
          :ref="bindProfile"
          mode="self"
          :style="profileTheme"
          :lang="locale"
          :pubkey="myPubkey"
          :name="myNick"
          @cc-profile-name="onMyName"
        ></dotrino-profile>
        <p class="hint">{{ t('identity.nickHint') }}</p>

        <!-- Copiar la clave pública completa (el perfil solo muestra la corta). -->
        <div v-if="myPubkey" class="copy-key">
          <button class="copy-key-btn" @click="copyMyPubkey">
            {{ copiedKey ? t('identity.copied') : t('identity.copyPubkey') }}
          </button>
          <code class="copy-key-val">{{ myPubkey }}</code>
        </div>

        <!-- Notificaciones push -->
        <div class="notif">
          <div class="notif-row">
            <span class="lbl">{{ t('identity.notifTitle') }}</span>
            <button
              class="switch"
              :class="{ on: notif.enabled.value }"
              :disabled="notif.busy.value || !notif.supported.value"
              :aria-pressed="notif.enabled.value"
              @click="toggleNotif"
            ><span class="knob"></span></button>
          </div>
          <p class="hint">{{ t('identity.notifHint') }}</p>
          <p v-if="!notif.supported.value" class="hint warn-note">{{ t('identity.notifUnsupported') }}</p>
          <p v-else-if="notif.permission.value === 'denied'" class="hint warn-note">{{ t('identity.notifDenied') }}</p>
          <p v-if="notif.error.value" class="err">{{ notif.error.value }}</p>
        </div>
      </section>

      <!-- CONTACTOS -->
      <section v-show="tab === 'contactos'" class="body">
        <p v-if="focusPubkey" class="focus-note">{{ t('identity.authorNoToken') }}</p>
        <div class="add">
          <input
            v-model="newToken"
            class="token"
            maxlength="8"
            :placeholder="focusPubkey ? t('identity.tokenOptional') : t('identity.tokenPlaceholder')"
            :disabled="adding"
            @keydown.stop
            @keyup.enter="addContact"
          />
          <input v-model="newNick" :placeholder="t('identity.nickOptional')" :disabled="adding" @keydown.stop />
          <button class="go" :disabled="adding || (!newToken.trim() && !focusPubkey)" @click="addContact">
            {{ adding ? t('identity.searching') : t('identity.addContact') }}
          </button>
          <p v-if="addStatus" class="status">{{ addStatus }}</p>
          <p v-if="addError" class="err">{{ addError }}</p>
          <i18n-t v-if="!focusPubkey" keypath="identity.addContactHint" tag="p" class="hint" scope="global">
            <template #token><strong>{{ t('identity.tokenWord') }}</strong></template>
          </i18n-t>
        </div>
        <p v-if="!contacts.length" class="empty">{{ t('identity.noContacts') }}</p>
        <div v-for="c in contacts" :key="c.publickey" class="contact">
          <button class="ci ci-btn" @click="openPeerProfile(c.publickey, c.nickname)" :title="t('rooms.member')">
            <span class="nm">{{ c.nickname || t('identity.noNick') }}</span>
            <span class="mono sm">{{ shortKey(c.publickey) }}</span>
          </button>
          <button class="del" :title="t('common.delete')" @click.stop="removeContact(c.publickey)">🗑</button>
        </div>
      </section>

      <!-- RANKINGS -->
      <section v-show="tab === 'rankings'" class="body">
        <p class="hint">{{ t('identity.rankingsHint') }}</p>
        <p v-if="!ranking.length" class="empty">{{ t('identity.noRatings') }}</p>
        <button v-for="(x, i) in ranking" :key="x.peer.publickey" class="rank-row"
                @click="openPeerProfile(x.peer.publickey, x.peer.nickname)" :title="t('rooms.member')">
          <span class="pos">{{ i + 1 }}</span>
          <div class="ci">
            <span class="nm">{{ x.peer.nickname || t('identity.anon') }}</span>
            <span class="mono sm">{{ shortKey(x.peer.publickey) }}</span>
          </div>
          <span class="score">
            {{ x.r.value!.toFixed(1) }} <span class="star on">★</span>
            <small>{{ x.r.source === 'mine' ? t('identity.sourceMine') : `×${x.r.count}` }}</small>
          </span>
        </button>
      </section>
    </div>

    <!-- Perfil de un peer (contacto / ranking): tarjeta compartida del ecosistema
         en modo edición (calificar). Reemplaza la calificación a mano. -->
    <dotrino-profile
      v-if="peerPk"
      :ref="bindProfile"
      modal
      mode="edit"
      :style="profileTheme"
      :lang="locale"
      :pubkey="peerPk"
      :name="peerName"
      @cc-profile-close="peerPk = null"
      @cc-profile-rate="onPeerRate"
    ></dotrino-profile>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.66);
  display: flex; align-items: center; justify-content: center; z-index: 400; padding: 1rem;
}
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 1.3rem; max-width: 420px; width: 100%; position: relative;
  box-shadow: var(--shadow); max-height: 88vh; display: flex; flex-direction: column;
}
.x { position: absolute; top: 0.5rem; right: 0.7rem; background: none; border: none; color: var(--muted); font-size: 1.5rem; cursor: pointer; }
h3 { color: var(--azure); margin-bottom: 0.8rem; }
.ptabs { display: flex; gap: 0.3rem; margin-bottom: 0.9rem; }
.ptabs button {
  flex: 1; background: transparent; border: 1px solid var(--line); color: var(--muted);
  padding: 0.5rem; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 0.85rem;
}
.ptabs button.on { background: var(--panel-2); color: var(--text); border-color: var(--azure); }
.warn { color: var(--gold); font-size: 0.82rem; margin-bottom: 0.6rem; }
.body { overflow-y: auto; }

.lbl { display: block; font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0.6rem 0 0.3rem; }
.add input, .add textarea {
  width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  color: var(--text); padding: 0.5rem; font-size: 0.85rem; font-family: inherit;
}
.add .token { font-family: monospace; text-transform: uppercase; letter-spacing: 0.18em; text-align: center; font-size: 1rem; }
.add input + input { margin-top: 0.4rem; }
.go {
  background: var(--azure); color: #042038; border: none; border-radius: 8px;
  padding: 0 0.9rem; font-weight: 800; cursor: pointer; white-space: nowrap;
}
.add .go { width: 100%; padding: 0.55rem; margin-top: 0.4rem; }
.go:disabled { opacity: 0.5; cursor: default; }
.mono { font-family: monospace; font-size: 0.82rem; }
.mono.sm { font-size: 0.68rem; color: var(--muted); }
.hint { font-size: 0.78rem; color: var(--muted); margin-top: 0.5rem; }
.copy-key { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.35rem; }
.copy-key-btn {
  align-self: flex-start; background: transparent; color: var(--azure, #41b4ff);
  border: 1px solid var(--azure, #41b4ff); border-radius: 50px;
  padding: 0.35rem 0.85rem; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 0.78rem;
}
.copy-key-btn:hover { background: rgba(65, 180, 255, 0.16); }
.copy-key-val {
  font-size: 0.66rem; color: var(--muted); word-break: break-all; line-height: 1.3;
  background: rgba(255,255,255,0.04); border-radius: 8px; padding: 0.4rem 0.55rem;
}
.focus-note {
  font-size: 0.8rem; color: var(--azure); background: rgba(65, 180, 255, 0.1);
  border: 1px solid var(--azure); border-radius: 8px; padding: 0.5rem 0.7rem; margin-bottom: 0.7rem;
}
.err { color: #ff6b6b; font-size: 0.78rem; margin-top: 0.3rem; }
.status { color: var(--azure); font-size: 0.78rem; margin-top: 0.3rem; }
.empty { color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 0.6rem 0; }

.add { border-bottom: 1px solid var(--line-soft); padding-bottom: 0.8rem; margin-bottom: 0.6rem; }
.contact, .rank-row {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-top: 1px solid var(--line-soft);
}
.rank-row { width: 100%; background: none; border-left: none; border-right: none; border-bottom: none; cursor: pointer; text-align: left; }
.rank-row:hover .nm, .ci-btn:hover .nm { color: var(--azure); }
.ci { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ci-btn { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
.nm { font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.star { color: var(--gold); font-size: 1rem; }
.del { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.9rem; }
.del:hover { color: #ff6b6b; }
.pos { width: 1.4rem; text-align: center; font-family: var(--font-display); color: var(--muted); }
.score { font-weight: 800; color: var(--gold); font-size: 0.9rem; display: flex; align-items: center; gap: 0.2rem; }
.score small { color: var(--muted); font-weight: 400; }

/* Notificaciones */
.notif { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border, rgba(255,255,255,0.1)); }
.notif-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.warn-note { color: var(--gold); }
.switch {
  flex-shrink: 0; width: 44px; height: 26px; border-radius: 999px;
  border: 1px solid var(--border, rgba(255,255,255,0.2));
  background: rgba(255,255,255,0.12); position: relative; cursor: pointer; padding: 0;
  transition: background .15s ease;
}
.switch .knob {
  position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
  border-radius: 50%; background: #fff; transition: transform .15s ease;
}
.switch.on { background: var(--gold); border-color: var(--gold); }
.switch.on .knob { transform: translateX(18px); }
.switch:disabled { opacity: .5; cursor: not-allowed; }
</style>
