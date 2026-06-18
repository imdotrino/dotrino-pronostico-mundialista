<script setup lang="ts">
import { ref, computed, watch, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildShareUrl, b64urlToBytes, type PredictionSeal } from '../lib/share'
import type { SavedPrediction } from '../lib/store'
import { decodePrediction } from '../lib/codec'
import { upsertMember, type RoomMode, type RoomScope, type RoomMember } from '../lib/roomStore'
import { buildRoomInviteUrl, buildMemberContribUrl, buildMemberEnvelope, buildRetractEnvelope, buildForwardEnvelope, buildForwardRetractEnvelope, memberFromEnvelope, modeAllowed, scopeAllowed } from '../lib/room'
import { dailySealsForEnvelope, findDailyEntry } from '../lib/matchday'
import { sendRoomInvites } from '../lib/inbox'
import { useRooms } from '../composables/useRooms'
import { shortKey } from '../lib/rating'
import RoomLeaderboard from './RoomLeaderboard.vue'
import RoomCompare from './RoomCompare.vue'
import RoomMatches from './RoomMatches.vue'
import { trackEvent } from '../lib/analytics'

const { t } = useI18n()

// Exige apodo antes de firmar (provisto por App): aportar a una sala firma con
// la identidad, igual que compartir, así que requiere tener apodo.
const ensureNick = inject<(run: () => void) => void>('ensureNick', (run) => run())

const props = defineProps<{
  library: SavedPrediction[]
  official: SavedPrediction | null
}>()

// Aportar autosella: App persiste el sello usado en la entrada compartida.
const emit = defineEmits<{ sealed: [entryId: string, code: string, seal: PredictionSeal] }>()

// Sello guardado de la entrada (botón "Sellar"), reutilizable solo si el código
// no cambió desde el sellado: así la fecha certificada del aporte es la del
// sellado original y un pronóstico viejo no queda como "sellado tarde".
function presetSeal (p: SavedPrediction): PredictionSeal | null {
  if (!p.seal || p.seal.code !== p.code) return null
  return { ts: p.seal.ts, sig: b64urlToBytes(p.seal.sig) }
}

const {
  activeRoom, myPubkey, myNick, contacts, unreachable, roomTab,
  createRoom, joinByLink, persist, updateSyncFrag, broadcastEnvelope,
} = useRooms()

// --- Home (sin sala activa): crear + unirse, inline ------------------------
const cName = ref('')
// Tipo de sala: clásica (pronóstico completo) o de la FECHA (partido a partido,
// cada pick sellado y revelado al kickoff).
const cType = ref<'classic' | 'daily'>('classic')
const cMode = ref<RoomMode>('free')
const cScope = ref<RoomScope>('free')
const cSealed = ref(false)
const creating = ref(false)
const joinText = ref('')
const joinError = ref('')
const joining = ref(false)

async function doCreate () {
  if (creating.value || !cName.value.trim()) return
  creating.value = true
  try {
    const daily = cType.value === 'daily'
    await createRoom({
      name: cName.value,
      mode: daily ? 'free' : cMode.value,
      scope: daily ? 'free' : cScope.value,
      sealed: daily ? false : cSealed.value,
      daily,
    })
    if (daily) trackEvent('sala/fecha-creada')
    cName.value = ''; cType.value = 'classic'; cMode.value = 'free'; cScope.value = 'free'; cSealed.value = false
  } finally { creating.value = false }
}

async function doJoin () {
  joinError.value = ''
  if (joining.value || !joinText.value.trim()) return
  joining.value = true
  try {
    await joinByLink(joinText.value)
    joinText.value = ''
  } catch { joinError.value = t('rooms.invalidInvite') } finally { joining.value = false }
}

// --- Detalle de sala --------------------------------------------------------
// La sub-pestaña activa vive en useRooms (compartida con barra lateral/header).
const rtab = roomTab
function goRoomTab (tab: 'table' | 'compare' | 'matches') {
  rtab.value = tab
  trackEvent('sala/' + tab)
}

// Pronósticos clásicos propios (la entrada DIARIA tiene su propio flujo abajo).
const myPredictions = computed(() => props.library.filter((p) => p.mine && !p.official && !p.daily))
// Entrada del pronóstico de la fecha (única por cuenta): el único aporte válido
// en una sala de la fecha.
const dailyEntry = computed(() => findDailyEntry(props.library))
const dailyPickCount = computed(() => Object.keys(dailyEntry.value?.results ?? {}).length)
function entryMode (p: SavedPrediction): string {
  if (p.mode) return p.mode
  try { return decodePrediction(p.code).mode } catch { return 'manual' }
}
function entryScope (p: SavedPrediction): string {
  if (p.scope) return p.scope
  try { return decodePrediction(p.code).scope } catch { return 'all' }
}
// ¿El pronóstico cumple modo Y alcance exigidos por la sala activa? En salas de
// la FECHA solo se aporta la entrada diaria (su propio flujo).
function canContribute (p: SavedPrediction): boolean {
  const room = activeRoom.value
  if (!room) return false
  if (room.daily) return !!p.daily
  if (p.daily) return false
  return modeAllowed(room.mode, entryMode(p)) && scopeAllowed(room.scope, entryScope(p))
}
const myMember = computed(() => activeRoom.value?.members.find((m) => m.publickey === myPubkey.value && !m.deleted) ?? null)
// Mi entrada pero REENVIADA por otro (alguien aportó mi pronóstico por mí): el
// selector sigue visible — aportar el mío en persona la reemplaza (rango autor).
const forwardedMe = computed(() => (myMember.value?.via ? myMember.value : null))

function modeName (m: RoomMode): string {
  if (m === 'free') return t('rooms.modeFree')
  if (m === 'winlose') return t('modes.medium')
  if (m === 'score') return t('modes.full')
  return t('modes.simple')
}
function scopeName (s: RoomScope): string {
  if (s === 'free') return t('rooms.modeFree')
  if (s === 'groups') return t('scopes.groups')
  if (s === 'bracket') return t('scopes.bracket')
  return t('scopes.all')
}

// Contribuir mi pronóstico
const contributing = ref(false)
const contribError = ref('')
const contribShared = ref(false)
function contribute (entry: SavedPrediction) {
  const room = activeRoom.value
  if (!room || contributing.value) return
  contribError.value = ''
  if (!canContribute(entry)) { contribError.value = t('rooms.modeMismatch'); return }
  // Igual que al compartir: exige apodo (abre el perfil si falta) antes de firmar.
  ensureNick(() => { void doContribute(entry) })
}
async function doContribute (entry: SavedPrediction) {
  const room = activeRoom.value
  if (!room) return
  contributing.value = true
  try {
    // code capturado ANTES del await: si el usuario edita mientras responde el
    // sellador, App descarta el sello desfasado (guard entry.code !== code).
    const code = entry.code
    const { url, seal } = await buildShareUrl(code, entry.name, presetSeal(entry))
    if (seal) emit('sealed', entry.id, code, seal)
    const frag = url.split('#')[1] ?? ''
    // Salas de la fecha: el sobre lleva los sellos POR PARTIDO (prueban que cada
    // pick existió antes de su kickoff; sin ellos el pick no puntúa).
    const ds = room.daily && entry.daily ? dailySealsForEnvelope(entry) : undefined
    // Sobre firmado por el autor con ts: ordena versiones (LWW) y habilita borrado.
    const env = await buildMemberEnvelope(room.id, frag, Date.now(), ds)
    const parsed = await memberFromEnvelope(env)
    if (!parsed) throw new Error(t('rooms.contribError'))
    parsed.member.nickname = parsed.member.nickname || myNick.value || undefined
    upsertMember(room, parsed.member)
    persist()
    updateSyncFrag(env)
  } catch (e) { contribError.value = e instanceof Error ? e.message : String(e) } finally { contributing.value = false }
}
async function removeMyContrib () {
  const room = activeRoom.value
  if (!room || !myPubkey.value) return
  if (!confirm(t('rooms.confirmRemoveContrib'))) return
  // Tombstone FIRMADO: solo yo puedo borrar lo mío, y al ir firmado con ts mayor
  // le gana a cualquier reenvío viejo de mi aporte (no se "revive").
  const env = await buildRetractEnvelope(room.id, Date.now())
  const parsed = await memberFromEnvelope(env)
  if (!parsed) return
  upsertMember(room, parsed.member)
  persist()
  updateSyncFrag(env) // difundo la lápida (online + cola offline)
}
async function shareMyContrib () {
  const room = activeRoom.value
  if (!room || !myMember.value?.env) return
  const url = buildMemberContribUrl(myMember.value.env)
  if (navigator.share) navigator.share({ url, title: room.name }).catch(() => {})
  else { try { await navigator.clipboard.writeText(url); contribShared.value = true; setTimeout(() => { contribShared.value = false }, 1800) } catch { /* */ } }
}

// --- Aportar el pronóstico de un AMIGO (importado, firmado por él) ----------
// El frag firmado original del amigo (sharedUrl) prueba la autoría por sí solo;
// va envuelto en un sobre v4 firmado por mí (via). En la sala cuenta a nombre
// del amigo, y lo que él aporte en persona siempre le gana a mi reenvío.

// ¿Se puede reenviar a este autor? No si ya está en la sala (él mismo o por
// reenvío vivo), ni si él mismo borró su aporte (su lápida manda).
function canForwardFriend (author: string): boolean {
  const cur = activeRoom.value?.members.find((m) => m.publickey === author)
  if (!cur) return true
  if (!cur.deleted) return false
  return !!cur.via // lápida de reenvío → se puede re-aportar; lápida propia → no
}
const friendPredictions = computed(() =>
  props.library.filter((p) =>
    !p.mine && !p.official && p.author?.publickey && p.sharedUrl &&
    p.author.publickey !== myPubkey.value && canForwardFriend(p.author.publickey)),
)
const friendBusy = ref(false)
const friendError = ref('')
function contributeFriend (entry: SavedPrediction) {
  const room = activeRoom.value
  if (!room || friendBusy.value) return
  friendError.value = ''
  if (!canContribute(entry)) { friendError.value = t('rooms.modeMismatch'); return }
  ensureNick(() => { void doContributeFriend(entry) })
}
async function doContributeFriend (entry: SavedPrediction) {
  const room = activeRoom.value
  if (!room || !entry.sharedUrl) return
  friendBusy.value = true
  try {
    const frag = entry.sharedUrl.split('#')[1] ?? ''
    const env = await buildForwardEnvelope(room.id, frag, Date.now(), myNick.value || undefined)
    const parsed = await memberFromEnvelope(env)
    if (!parsed) throw new Error(t('rooms.contribError'))
    upsertMember(room, parsed.member)
    persist()
    broadcastEnvelope(env)
    trackEvent('sala/aporte-amigo')
  } catch (e) { friendError.value = e instanceof Error ? e.message : String(e) } finally { friendBusy.value = false }
}

// Retirar MI reenvío (el doble-toque de confirmación vive en RoomLeaderboard).
async function removeFriendContrib (m: RoomMember) {
  const room = activeRoom.value
  if (!room || m.via !== myPubkey.value) return
  const env = await buildForwardRetractEnvelope(room.id, m.publickey, Date.now())
  const parsed = await memberFromEnvelope(env)
  if (!parsed) return
  upsertMember(room, parsed.member)
  persist()
  broadcastEnvelope(env)
}

// Invitar CONTACTOS por el proxy (el QR/enlace/redes vive en el modal de
// compartir de arriba; aquí solo se arma la URL firmada para los envíos).
const inviteUrl = ref('')
const selectedContacts = ref<Set<string>>(new Set())
const inviting = ref(false)
const inviteStatus = ref('')

async function buildInvite () {
  const room = activeRoom.value
  inviteUrl.value = ''
  if (!room) return
  try {
    const { url } = await buildRoomInviteUrl({
      id: room.id, name: room.name, mode: room.mode, scope: room.scope ?? 'free', sealedUntil: room.sealedUntil, createdAt: room.createdAt, daily: room.daily,
    })
    inviteUrl.value = url
  } catch (e) { console.warn('No se pudo armar la invitación:', e) }
}
function toggleContact (pk: string) {
  const s = new Set(selectedContacts.value)
  if (s.has(pk)) s.delete(pk); else s.add(pk)
  selectedContacts.value = s
}
async function inviteSelected () {
  if (inviting.value || !selectedContacts.value.size || !inviteUrl.value) return
  inviting.value = true
  inviteStatus.value = t('rooms.inviting')
  try {
    const sent = await sendRoomInvites([...selectedContacts.value], inviteUrl.value)
    inviteStatus.value = t('rooms.invited', { n: sent })
    selectedContacts.value = new Set()
  } finally { inviting.value = false }
}

// Reconstruir invitación al cambiar de sala. (La sub-pestaña la fija openRoom /
// shareRoom en useRooms, así la barra lateral puede abrir directo en "compartir".)
watch(activeRoom, (r) => {
  selectedContacts.value = new Set()
  inviteStatus.value = ''
  if (r) buildInvite()
}, { immediate: true })
</script>

<template>
  <!-- HOME: sin sala activa → crear / unirse (inline, como página) -->
  <div v-if="!activeRoom" class="home scrolly">
    <i18n-t v-if="unreachable" keypath="identity.unreachable" tag="p" class="warn" scope="global">
      <template #vault><code>id.dotrino.com</code></template>
    </i18n-t>

    <div class="cards">
      <section class="card">
        <h3>➕ {{ t('rooms.create') }}</h3>
        <label class="lbl">{{ t('rooms.name') }}</label>
        <input v-model="cName" maxlength="60" :placeholder="t('rooms.namePlaceholder')" @keydown.stop @keyup.enter="doCreate" />
        <label class="lbl">{{ t('rooms.typeLabel') }}</label>
        <div class="rtype" data-testid="room-type">
          <button class="rtype-opt" :class="{ on: cType === 'classic' }" data-testid="room-type-classic" @click="cType = 'classic'">
            <strong>{{ t('rooms.typeClassic') }}</strong><span>{{ t('rooms.typeClassicDesc') }}</span>
          </button>
          <button class="rtype-opt" :class="{ on: cType === 'daily' }" data-testid="room-type-daily" @click="cType = 'daily'">
            <strong>📅 {{ t('rooms.typeDaily') }}</strong><span>{{ t('rooms.typeDailyDesc') }}</span>
          </button>
        </div>
        <template v-if="cType === 'classic'">
          <label class="lbl">{{ t('rooms.mode') }}</label>
          <select v-model="cMode" class="sel">
            <option value="free">{{ t('rooms.modeFree') }}</option>
            <option value="manual">{{ t('modes.simple') }}</option>
            <option value="winlose">{{ t('modes.medium') }}</option>
            <option value="score">{{ t('modes.full') }}</option>
          </select>
          <label class="lbl">{{ t('rooms.scope') }}</label>
          <select v-model="cScope" class="sel">
            <option value="free">{{ t('rooms.modeFree') }}</option>
            <option value="all">{{ t('scopes.all') }}</option>
            <option value="groups">{{ t('scopes.groups') }}</option>
          </select>
          <label class="check"><input type="checkbox" v-model="cSealed" /><span>{{ t('rooms.sealOption') }}</span></label>
          <p class="hint">{{ cSealed ? t('rooms.sealOn') : t('rooms.sealOff') }}</p>
        </template>
        <p v-else class="hint">{{ t('rooms.dailyCreateHint') }}</p>
        <button class="primary full" :disabled="creating || !cName.trim()" @click="doCreate">{{ creating ? '…' : t('rooms.createConfirm') }}</button>
      </section>

      <section class="card">
        <h3>📥 {{ t('rooms.joinByLink') }}</h3>
        <input v-model="joinText" :placeholder="t('rooms.joinPlaceholder')" @keydown.stop @keyup.enter="doJoin" />
        <button class="primary full" :disabled="joining || !joinText.trim()" @click="doJoin">{{ joining ? '…' : t('rooms.join') }}</button>
        <p v-if="joinError" class="err">{{ joinError }}</p>
        <p class="hint">{{ t('rooms.selectHint') }}</p>
      </section>
    </div>
  </div>

  <!-- DETALLE: contenido de la sala activa -->
  <div v-else class="room scrolly">
    <!-- Aportar mi pronóstico (también si otro aportó el mío por mí: lo reemplazo) -->
    <div v-if="!myMember || forwardedMe" class="contribute">
      <p v-if="forwardedMe" class="hint fwd-note">↪ {{ t('rooms.forwardedForYou', { n: forwardedMe.viaNick || shortKey(forwardedMe.via || '') }) }}</p>
      <!-- Sala de la FECHA: se aporta la entrada diaria (única por cuenta). -->
      <template v-if="activeRoom.daily">
        <p class="contribute-h">📅 {{ t('rooms.dailyContribPrompt') }}</p>
        <p v-if="!dailyEntry" class="empty">{{ t('rooms.dailyNoEntry') }}</p>
        <div v-else class="pick" data-testid="daily-contribute">
          <span class="pick-nm">{{ dailyEntry.name }} <small>{{ t('rooms.dailyPickCount', { n: dailyPickCount }) }}</small></span>
          <button class="go" :disabled="contributing" @click="contribute(dailyEntry)">{{ t('rooms.contribute') }}</button>
        </div>
      </template>
      <template v-else>
        <p class="contribute-h">{{ t('rooms.contributePrompt') }}</p>
        <p v-if="!myPredictions.length" class="empty">{{ t('rooms.noMyPreds') }}</p>
        <div v-for="p in myPredictions" :key="p.id" class="pick">
          <span class="pick-nm">{{ p.name }} <small>{{ modeName(entryMode(p) as RoomMode) }}<template v-if="entryScope(p) !== 'all'"> · {{ scopeName(entryScope(p) as RoomScope) }}</template></small></span>
          <button class="go" :disabled="contributing || !canContribute(p)"
            :title="!canContribute(p) ? t('rooms.modeMismatch') : ''" @click="contribute(p)">{{ t('rooms.contribute') }}</button>
        </div>
      </template>
      <p v-if="contribError" class="err">{{ contribError }}</p>
    </div>
    <div v-else class="mine-note">
      <span>✓ {{ t('rooms.contributed') }}<small v-if="activeRoom.daily" class="auto-note"> · {{ t('rooms.dailyAutoUpdate') }}</small></span>
      <span class="mine-actions">
        <button class="go ghost mini-share" @click="shareMyContrib">{{ contribShared ? t('rooms.copied') : t('rooms.shareContrib') }}</button>
        <button class="go danger mini-share" @click="removeMyContrib">{{ t('rooms.removeContrib') }}</button>
      </span>
    </div>

    <!-- Aportar pronósticos de AMIGOS (importados, firmados por ellos). En salas
         de la fecha no aplica: un reenvío no lleva los sellos por partido. -->
    <div v-if="friendPredictions.length && !activeRoom.daily" class="contribute friend" data-testid="friend-contribute">
      <p class="contribute-h">{{ t('rooms.friendContribPrompt') }}</p>
      <p class="hint">{{ t('rooms.friendContribHint') }}</p>
      <div v-for="p in friendPredictions" :key="p.id" class="pick">
        <span class="pick-nm">{{ p.author?.nickname || t('common.anonymous') }} <small>{{ p.name }} · {{ modeName(entryMode(p) as RoomMode) }}<template v-if="entryScope(p) !== 'all'"> · {{ scopeName(entryScope(p) as RoomScope) }}</template></small></span>
        <button class="go" :disabled="friendBusy || !canContribute(p)"
          :title="!canContribute(p) ? t('rooms.modeMismatch') : ''" @click="contributeFriend(p)">{{ t('rooms.contribute') }}</button>
      </div>
      <p v-if="friendError" class="err">{{ friendError }}</p>
    </div>

    <nav class="rtabs">
      <button :class="{ on: rtab === 'table' }" @click="goRoomTab('table')">{{ t('rooms.tabTable') }}</button>
      <!-- En salas de la fecha la comparación de llaves/campeón no aplica. -->
      <button v-if="!activeRoom.daily" :class="{ on: rtab === 'compare' }" @click="goRoomTab('compare')">{{ t('rooms.tabCompare') }}</button>
      <button :class="{ on: rtab === 'matches' }" data-testid="rtab-matches" @click="goRoomTab('matches')">{{ t('rooms.tabMatches') }}</button>
    </nav>

    <template v-if="rtab === 'table' || (activeRoom.daily && rtab === 'compare')">
      <RoomLeaderboard :room="activeRoom" :official="official" :my-pubkey="myPubkey" :daily="activeRoom.daily" @remove-forward="removeFriendContrib" />

      <!-- Invitar contactos por el proxy (QR/enlace/redes: en compartir, arriba). -->
      <h4 class="grp-h">{{ t('rooms.inviteContacts') }}</h4>
      <p v-if="!contacts.length" class="empty">{{ t('identity.noContacts') }}</p>
      <div v-for="c in contacts" :key="c.publickey" class="contact" @click="toggleContact(c.publickey)">
        <input type="checkbox" :checked="selectedContacts.has(c.publickey)" @click.stop="toggleContact(c.publickey)" />
        <span class="c-nm">{{ c.nickname || t('identity.noNick') }}</span>
        <span class="mono">{{ shortKey(c.publickey) }}</span>
      </div>
      <button v-if="contacts.length" class="primary full" :disabled="inviting || !selectedContacts.size" @click="inviteSelected">
        {{ inviting ? '…' : t('rooms.sendInvites', { n: selectedContacts.size }) }}
      </button>
      <p v-if="inviteStatus" class="status">{{ inviteStatus }}</p>
    </template>
    <RoomCompare v-else-if="rtab === 'compare'" :room="activeRoom" :official="official" :my-pubkey="myPubkey" />
    <RoomMatches v-else :room="activeRoom" :official="official" :my-pubkey="myPubkey" :daily="activeRoom.daily" />
  </div>
</template>

<style scoped>
.scrolly { padding: 1rem; }
.warn { color: var(--gold); font-size: 0.85rem; margin-bottom: 0.8rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; max-width: 760px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 1.1rem; }
.card h3 { color: var(--azure); margin-bottom: 0.7rem; font-size: 1.05rem; }
.lbl { display: block; font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0.6rem 0 0.3rem; }
input, .sel { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 0.55rem; font-size: 0.9rem; font-family: inherit; }
.rtype { display: flex; flex-direction: column; gap: 0.4rem; }
.rtype-opt {
  display: flex; flex-direction: column; gap: 0.1rem; text-align: left;
  background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
  padding: 0.55rem 0.7rem; cursor: pointer; color: var(--text); font-family: inherit;
}
.rtype-opt strong { color: var(--azure); font-size: 0.86rem; }
.rtype-opt span { color: var(--muted); font-size: 0.72rem; }
.rtype-opt.on { border-color: var(--azure); background: var(--panel-2); }
.auto-note { color: var(--muted); font-weight: 400; }

.check { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.7rem; cursor: pointer; }
.check input { width: auto; }
.check span { font-size: 0.85rem; }
.hint { font-size: 0.78rem; color: var(--muted); margin-top: 0.4rem; }
.primary { background: var(--azure); color: #042038; border: none; border-radius: 8px; padding: 0.6rem 1rem; font-weight: 800; cursor: pointer; font-family: inherit; }
.primary.full { width: 100%; margin-top: 0.8rem; }
.primary:disabled { opacity: 0.5; cursor: default; }
.err { color: #ff6b6b; font-size: 0.8rem; margin-top: 0.4rem; }
.status { color: var(--azure); font-size: 0.8rem; margin-top: 0.4rem; }
.empty { color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 0.4rem 0; }

.contribute { border: 1px solid var(--azure); border-radius: 12px; padding: 0.9rem; margin-bottom: 0.9rem; background: rgba(65,180,255,0.06); }
.contribute.friend { border-color: var(--gold); background: rgba(255, 200, 87, 0.05); }
.fwd-note { color: var(--azure); margin-bottom: 0.45rem; }
.contribute-h { font-size: 0.88rem; font-weight: 700; margin-bottom: 0.5rem; }
.pick { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0; }
.pick-nm { font-size: 0.88rem; }
.pick-nm small { color: var(--muted); font-size: 0.72rem; }
.mine-note { font-size: 0.85rem; color: var(--green); margin-bottom: 0.9rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.go { background: var(--azure); color: #042038; border: none; border-radius: 8px; padding: 0.45rem 0.9rem; font-weight: 800; cursor: pointer; white-space: nowrap; font-family: inherit; }
.go.ghost { background: transparent; color: var(--azure); border: 1px solid var(--azure); }
.go.danger { background: transparent; color: #ff6b6b; border: 1px solid #ff6b6b; }
.go:disabled { opacity: 0.5; cursor: default; }
.mini-share { padding: 0.35rem 0.7rem; font-size: 0.78rem; }
.mine-actions { display: inline-flex; gap: 0.4rem; }
.rtabs { display: flex; gap: 0.4rem; margin-bottom: 1rem; max-width: 420px; }
.rtabs button { flex: 1; background: transparent; border: 1px solid var(--line); color: var(--muted); padding: 0.55rem; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 0.85rem; }
.rtabs button.on { background: var(--panel-2); color: var(--text); border-color: var(--azure); }
.grp-h { color: var(--muted); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.1rem 0 0.5rem; }
.invite-box { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.qr { width: 130px; height: 130px; border-radius: 8px; background: #fff; padding: 4px; }
.invite-actions { display: flex; flex-direction: column; gap: 0.5rem; }
.invite-actions .go { padding: 0.55rem 1.1rem; }
.social-row { margin: 0.7rem 0 0.2rem; justify-content: flex-start; }
.contact, .member { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0; border-top: 1px solid var(--line-soft); max-width: 480px; }
.contact { cursor: pointer; }
.c-nm { flex: 1; min-width: 0; font-weight: 700; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.you { font-size: 0.6rem; background: var(--azure); color: #042038; border-radius: 5px; padding: 0 0.25rem; font-weight: 800; margin-left: 0.3rem; }
.mono { font-family: monospace; font-size: 0.66rem; color: var(--muted); }
.badge { font-size: 0.75rem; color: #e0a; }
.badge.ok { color: var(--green); }
.seal { font-size: 0.78rem; cursor: help; flex-shrink: 0; }
.seal.ok { color: var(--green); }
.seal.late, .seal.bad { color: var(--gold); }
.seal.none { color: var(--muted); }
.tag.gold { color: var(--gold); border: 1px solid var(--gold); border-radius: 5px; padding: 0.05rem 0.35rem; font-size: 0.66rem; }
.tag.via { color: var(--azure); border: 1px solid var(--azure); border-radius: 5px; padding: 0.05rem 0.35rem; font-size: 0.66rem; white-space: nowrap; }
.pname { color: var(--muted); font-weight: 400; }
</style>
