<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted, onUnmounted, nextTick, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, type Locale } from './i18n'
import { GROUPS, teamById } from './lib/teams'
import {
  defaultPrediction, clonePrediction, champion, prunePicks,
  confirmStandings, revertDraft, autoConfirmNonBracket, hasPendingChanges, completeness,
  listMissing, type Prediction, type MissingItem,
} from './lib/prediction'
import { GROUP_MATCH_COUNT, computeStandings, type GameMode, type Scope, type Results, type MatchResult } from './lib/standings'
import { encodePrediction, decodePrediction } from './lib/codec'
import {
  parseShareFragment, buildShareUrl, sealPredictionCode, getIdentity, SHARE_BASE,
  bytesToB64url, b64urlToBytes, type PredictionSeal, type IncomingPrediction,
} from './lib/share'
import { useBackLayer } from '@dotrino/nav/vue'
import {
  loadLibrary, saveLibrary, getActiveId, setActiveId, genId, hydrateLibrary, type SavedPrediction,
} from './lib/store'
import {
  fetchOfficialFeed, buildOfficial, buildPublishItems, publishOfficial, isAdminIdentity, type Feed,
} from './lib/officialResults'
import {
  allFixtures, fixturesTodayTomorrow, fixturePredictable, findDailyEntry, ensureDailyEntry,
  applyDailyPicks, sealMissingPicks, shouldShowDailyPopup, nowMs,
} from './lib/matchday'
import GroupCard from './components/GroupCard.vue'
import StandingsTable from './components/StandingsTable.vue'
import ResultsTab from './components/ResultsTab.vue'
import ThirdsBlock from './components/ThirdsBlock.vue'
import BracketTab from './components/BracketTab.vue'
import ScoresTab from './components/ScoresTab.vue'
import ShareModal from './components/ShareModal.vue'
import RoomShareModal from './components/RoomShareModal.vue'
import PrintView from './components/PrintView.vue'
import Sidebar from './components/Sidebar.vue'
import ScoringInfo from './components/ScoringInfo.vue'
import QRCode from 'qrcode'
import IdentityPanel from './components/IdentityPanel.vue'
import RoomsPage from './components/RoomsPage.vue'
import MatchdayPage from './components/MatchdayPage.vue'
import MatchdayPopup from './components/MatchdayPopup.vue'
import { fragKind } from './lib/room'
import { RoomInbox, type IncomingInvite } from './lib/inbox'
import { startReceipts, reportOpen } from './lib/receipts'
import { trackEvent } from './lib/analytics'
import { useRooms } from './composables/useRooms'
import { startAppTutorial } from './lib/tutorial'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const { t, locale } = useI18n()

const library = ref<SavedPrediction[]>([])
const activeId = ref<string | null>(null)
const pred = reactive<Prediction>(defaultPrediction())
const tab = ref<'grupos' | 'resultados' | 'llaves' | 'puntajes'>('grupos')
// El sidebar arranca CERRADO: en móvil (cajón) no tapa la vista al entrar y se
// abre con el botón ☰; en escritorio es barra fija y este flag no afecta el layout.
const sidebarOpen = ref(false)
const shareOpen = ref(false)
const shareEntryId = ref<string | null>(null)
const identityOpen = ref(false)
const scoringOpen = ref(false)
const identityFocus = ref<string | null>(null)
const identityFocusNick = ref<string | null>(null)
const importOpen = ref(false)
const importText = ref('')
const importError = ref('')
const importing = ref(false)

// Volver unificado (@dotrino/nav): el botón físico / chevron
// cierra el panel/modal abierto antes de salir hacia dotrino.com.
useBackLayer(sidebarOpen)
useBackLayer(shareOpen)
useBackLayer(identityOpen)
useBackLayer(scoringOpen)
useBackLayer(importOpen)

// --- Salas (otra "página": barra lateral + contenido propio) ---------------
const section = ref<'predictions' | 'rooms' | 'fecha'>('predictions')
const inviteToast = ref<IncomingInvite | null>(null)
let inbox: RoomInbox | null = null
const {
  rooms,
  initRooms, importRoomInvite, importMemberContrib, applyEnvelope, openRoom, closeRoom,
  ensureSync, stopSync, activeRoom, peerCount, syncStatus, roomShareOpen, recontributeDaily,
} = useRooms()

// Ciclo de sincronización ligado a la sección: solo conectamos al proxy cuando
// estás viendo Salas; al salir, cortamos para no mantener conexiones de fondo.
watch(section, (s) => {
  if (s === 'rooms') ensureSync()
  else stopSync()
  trackEvent('seccion/' + s)
})

// --- Instalación PWA --------------------------------------------------------
// El botón "Instalar App" lo aporta el Web Component <dotrino-install>
// (@dotrino/install): captura beforeinstallprompt, maneja iOS
// con su propio modal (sin alert) y se auto-oculta si ya está instalada.

let loading = false // evita persistir mientras cargamos un pronóstico

const activeEntry = computed(() => library.value.find((p) => p.id === activeId.value) ?? null)
const readonly = computed(() => (activeEntry.value ? !activeEntry.value.mine : false))
// La entrada de RESULTADOS oficiales NO es un pronóstico: solo se cargan los
// marcadores de los partidos; sin modos, sin "Confirmar", sin arrastre. Las
// posiciones y llaves se derivan solas de los resultados.
const isOfficial = computed(() => !!activeEntry.value?.official)
// Entrada de resultados oficiales (base de comparación para los puntajes).
const officialEntry = computed(() => library.value.find((p) => p.official) ?? null)
const championId = computed(() => champion(pred))

// --- Modo de juego y resultados --------------------------------------------
// El modo (tipo) se elige al CREAR el pronóstico y queda FIJO. Para cambiarlo
// se clona a otro tipo (cloneToType). Etiqueta legible del modo activo:
const activeModeName = computed(() => modeName(pred.mode))
// Etiqueta del alcance activo (solo se muestra cuando no es 'all').
const activeScopeName = computed(() => scopeName(pred.scope))

// El scope 'bracket' (Solo llaves) se siembra desde los resultados oficiales de
// grupos, así que se habilita cuando esos resultados están COMPLETOS (72/72).
// Cuenta cualquier llenado de la entrada oficial: el relay (al terminar la fase
// de grupos) o el botón "llenar al azar" — esto último sirve de debug.
const officialGroupsComplete = computed(() => {
  const r = officialEntry.value?.results
  if (!r) return false
  for (let i = 0; i < GROUP_MATCH_COUNT; i++) if (!r[i]) return false
  return true
})
// Alcances ofrecidos en el selector (paso 2). 'bracket' SIEMPRE se muestra, pero
// queda DESHABILITADO (no seleccionable) hasta que los resultados oficiales de
// grupos estén completos: así el usuario ve que existe y cuándo se habilita.
const SCOPE_OPTIONS = computed<Scope[]>(() => ['all', 'groups', 'bracket'])
// ¿Está deshabilitado este alcance en el selector? (solo 'bracket'.)
function scopeDisabled (s: Scope): boolean {
  return s === 'bracket' && !officialGroupsComplete.value
}
// Pestañas válidas según el alcance del pronóstico activo.
function tabAllowed (target: Tab): boolean {
  if (target === 'resultados') return pred.mode !== 'manual' && pred.scope !== 'bracket'
  if (target === 'llaves') return pred.scope !== 'groups'
  if (target === 'grupos') return pred.scope !== 'bracket'
  return true // puntajes
}
// Primera pestaña a mostrar para un (modo, scope) recién creado/seleccionado.
function defaultTab (mode: GameMode, scope: Scope): Tab {
  if (scope === 'bracket') return 'llaves'
  return mode === 'manual' ? 'grupos' : 'resultados'
}

// ¿Hay resultados sin confirmar? (solo aplica en winlose/score). Reactivo: el
// watch profundo de `pred` reevalúa este computed al cambiar resultados/modo.
const pending = computed(() => hasPendingChanges(pred))

// Aplica los resultados a las posiciones confirmadas y poda las llaves.
function confirmChanges () {
  if (readonly.value) return
  confirmStandings(pred) // persiste vía el watch profundo de `pred`
}

// Descarta el reordenamiento en borrador y vuelve a las posiciones confirmadas.
function cancelChanges () {
  if (readonly.value) return
  revertDraft(pred) // persiste vía el watch profundo de `pred`
}

// ---- Sellado persistente del pronóstico ------------------------------------
// El sello (TSA signer.dotrino.com) certifica CUÁNDO existió el pronóstico y
// queda GUARDADO en la entrada: se crea con el botón "Sellar" (sin necesidad de
// compartir) o implícitamente al compartir/aportar a una sala (autosellado), y
// deja de aplicar al editar (code distinto). Compartir REUTILIZA el sello
// vigente: la fecha certificada es la del sellado, no la de cada compartida —
// así un pronóstico viejo no aparece como "sellado tarde" por compartirse tarde.

const sealing = ref(false)
const sealError = ref(false)

// Estado del sello del pronóstico ACTIVO: sin sello / vigente / obsoleto (editado).
const sealState = computed<'none' | 'sealed' | 'stale'>(() => {
  const e = activeEntry.value
  if (!e?.seal) return 'none'
  return e.seal.code === e.code ? 'sealed' : 'stale'
})
const sealDate = computed(() => {
  const ts = activeEntry.value?.seal?.ts
  // Idioma de la APP (no del navegador), como las fechas de ResultsTab.
  return ts ? new Date(ts).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' }) : ''
})

// Sello guardado de una entrada como preset para buildShareUrl (solo si sigue
// correspondiendo al código que se va a compartir).
function presetSealFor (entry: SavedPrediction | null | undefined, code: string): PredictionSeal | null {
  if (!entry?.seal || !entry.mine || entry.official) return null
  if (entry.seal.code !== code) return null
  return { ts: entry.seal.ts, sig: b64urlToBytes(entry.seal.sig) }
}

// Persiste en la entrada el sello usado (botón "Sellar" o autosellado al
// compartir/imprimir/aportar), para reutilizarlo en las próximas compartidas.
// OJO: NO bumpea updatedAt — sellar no debe ganar el last-writer-wins de
// contenido (un dispositivo desactualizado que solo comparte pisaría ediciones
// más nuevas de otro). El sello viaja a la nube porque el ts del registro es
// max(updatedAt, seal.ts) (ver saveLibrary) y hydrateLibrary lo fusiona aparte.
function adoptSeal (entry: SavedPrediction | null | undefined, code: string, seal: PredictionSeal | null) {
  if (!seal || !entry || !entry.mine || entry.official) return
  if (entry.code !== code) return // se editó en el medio: el sello no es del estado actual
  if (entry.seal && entry.seal.code === code && entry.seal.ts === seal.ts) return
  entry.seal = { ts: seal.ts, sig: bytesToB64url(seal.sig), code }
  sealError.value = false // un sello conseguido invalida el error de un intento previo
  saveLibrary(library.value)
}

// Botón "Sellar": pide el sello del código actual y lo guarda (sin compartir).
async function sealActive () {
  const entry = activeEntry.value
  if (!entry || !entry.mine || entry.official || sealing.value) return
  sealing.value = true
  sealError.value = false
  try {
    const code = entry.code
    const seal = await sealPredictionCode(code)
    if (!seal) { sealError.value = true; return }
    adoptSeal(entry, code, seal)
  } finally { sealing.value = false }
}

// Sellar pasa por el mismo aviso de incompleto que compartir/imprimir (sin
// exigir apodo: el sello usa la pubkey, no firma el enlace).
function trySeal () {
  if (!activeId.value) return
  guardComplete(activeId.value, () => { void sealActive() })
}

// "Cancelar edición": descarta TODO lo editado después del sello y vuelve al
// pronóstico sellado (el código lleva posiciones, llaves y resultados). En modo
// manual trabaja en conjunto con "Confirmar cambios (afecta las llaves)": los
// borradores (drafts) no viajan en el código, así que mientras no se confirme
// el sello sigue vigente y basta "Cancelar cambios". En winlose/score los
// RESULTADOS sí viajan en el código: el primer marcador tecleado deja el sello
// obsoleto (aun sin confirmar) y este botón es la única forma de recuperarlo.
function cancelEdit () {
  const entry = activeEntry.value
  if (!entry?.seal || entry.seal.code === entry.code) return
  let p: Prediction
  try { p = decodePrediction(entry.seal.code) } catch { return }
  entry.code = entry.seal.code
  entry.mode = p.mode
  entry.scope = p.scope
  entry.results = p.results
  entry.draftGroupOrder = p.groupOrder.map((a) => [...a])
  entry.draftThirdsRank = [...p.thirdsRank]
  entry.updatedAt = Date.now()
  saveLibrary(library.value)
  select(entry.id) // reaplica la vista desde el código restaurado
}

// Sello a reutilizar en el modal de compartir (el del entry que se comparte).
const shareSeal = computed(() => {
  const e = library.value.find((p) => p.id === shareEntryId.value) ?? activeEntry.value
  return presetSealFor(e, shareCode.value)
})
// Autosellado: el modal avisa con el sello usado y el code que realmente selló
// (capturado antes del await). El guard de adoptSeal (entry.code !== code)
// descarta el sello si el usuario editó mientras respondía el sellador.
function onShareSealed (seal: PredictionSeal, code: string) {
  const e = library.value.find((p) => p.id === shareEntryId.value) ?? activeEntry.value
  adoptSeal(e, code, seal)
}
// Autosellado al aportar a una sala (RoomsPage avisa con el sello usado).
function onRoomSealed (entryId: string, code: string, seal: PredictionSeal) {
  adoptSeal(library.value.find((p) => p.id === entryId), code, seal)
}

// Si un enlace PROPIO importado trae sello válido, lo adopta: al reimportar en
// otro dispositivo se recupera la fecha certificada original (se conserva
// siempre el sello más antiguo, que es el que más vale). Devuelve si cambió.
// `isMine` (autor del enlace == mi identidad) es OBLIGATORIO: el sello viene
// atado a la pubkey del AUTOR del enlace — sin este gate, el enlace de otra
// persona con mi mismo code (p. ej. "editar copia" de mi pronóstico, o dos
// pronósticos por defecto sin editar) inyectaría en mi entrada un sello que
// jamás verificará contra mi clave.
function adoptIncomingSeal (entry: SavedPrediction, parsed: IncomingPrediction, isMine: boolean): boolean {
  if (!isMine || !entry.mine || entry.official || entry.code !== parsed.code) return false
  if (!parsed.sealValid || parsed.sealedAt == null || !parsed.sealSig) return false
  if (entry.seal && entry.seal.code === entry.code && entry.seal.ts <= parsed.sealedAt) return false
  entry.seal = { ts: parsed.sealedAt, sig: bytesToB64url(parsed.sealSig), code: parsed.code }
  return true
}

// ---- Pronóstico de la FECHA (partido a partido, día a día) -----------------
// Entrada ÚNICA por cuenta (flag `daily`; viaja por el store del ecosistema).
// El popup diario ofrece los partidos de HOY; cada pick guardado se SELLA con
// el TSA (sello POR PARTIDO: prueba que existió antes del kickoff). La sección
// "La fecha" permite ver y editar los partidos que aún no se juegan.

const dailyEntry = computed(() => findDailyEntry(library.value))

// Aporte AUTOMÁTICO a las salas de la fecha: al cargar la app, al unirse a una
// sala de la fecha o al cambiar los picks, la entrada diaria se publica sola
// (sin botón "Contribuir"). recontributeDaily omite las salas cuyo aporte ya
// está al día y respeta si el usuario borró su aporte a propósito.
watch(
  () => [rooms.value.filter((r) => r.daily).map((r) => r.id).join(','), dailyEntry.value?.code ?? ''],
  () => {
    const entry = dailyEntry.value
    if (!entry || !Object.keys(entry.results ?? {}).length) return
    void recontributeDaily(entry, { onlyIfChanged: true })
  },
  { immediate: true },
)

function ensureDaily () {
  const { changed } = ensureDailyEntry(library.value, t('daily.entryName'))
  if (changed) saveLibrary(library.value)
}

const dailyPopupOpen = ref(false)
const dailySealing = ref(false)
const dailySealResult = ref<{ sealed: number; failed: number } | null>(null)
useBackLayer(dailyPopupOpen)

// Partidos de HOY y MAÑANA aún pronosticables (para el popup).
const dailyTodayMatches = computed(() => {
  const now = nowMs()
  return fixturesTodayTomorrow(allFixtures(officialEntry.value), now).filter((f) => fixturePredictable(f, now))
})

// Guarda y SELLA picks (popup y sección comparten este camino). Tras guardar,
// refresca en silencio mi aporte en las salas de la fecha donde ya participo.
async function onDailySave (items: { id: number; r: MatchResult }[]) {
  ensureDaily()
  const entry = dailyEntry.value
  if (!entry || dailySealing.value || !items.length) return
  dailySealing.value = true
  try {
    const res = await applyDailyPicks(entry, items)
    saveLibrary(library.value)
    library.value = [...library.value] // recalcula computeds que leen la entrada
    dailySealResult.value = res
    void recontributeDaily(entry)
    trackEvent('fecha/sellado')
    // Popup: tras guardar todo OK se cierra solo (deja ver el ✓ un instante);
    // si quedaron sellos fallidos se mantiene abierto mostrando el aviso.
    if (dailyPopupOpen.value && res.failed === 0) {
      setTimeout(() => { if (dailyPopupOpen.value) closeDailyPopup() }, 1200)
    }
  } finally { dailySealing.value = false }
}

// Reintenta sellar los picks que quedaron sin sello (sellador caído al guardar).
async function onDailyReseal () {
  const entry = dailyEntry.value
  if (!entry) return
  const ok = await sealMissingPicks(entry)
  if (ok) {
    saveLibrary(library.value)
    library.value = [...library.value]
    void recontributeDaily(entry)
  }
}

// Compartir la entrada diaria: firma con identidad (exige apodo). No pasa por el
// aviso de "incompleto" (no aplica: se llena día a día).
function shareDaily () {
  ensureDaily()
  const entry = dailyEntry.value
  if (!entry) return
  ensureNick(() => openShare(entry.id))
}

function closeDailyPopup () {
  dailyPopupOpen.value = false
  dailySealResult.value = null
}

function dailyPopupToSection () {
  closeDailyPopup()
  section.value = 'fecha'
  sidebarOpen.value = false
}

// El popup sale en visitas "limpias" (sin enlace entrante) cuando hay partidos
// de HOY o MAÑANA sin pronosticar. En el primer arranque no compite con el
// tutorial: espera a que termine (o se salte) y sale a continuación.
let tutorialCtl: EventTarget | null = null
function showDailyPopupIfPending () {
  if (shouldShowDailyPopup(allFixtures(officialEntry.value), dailyEntry.value)) {
    dailyPopupOpen.value = true
    trackEvent('fecha/popup')
  }
}
function maybeShowDailyPopup () {
  let tutorialPending = false
  try { tutorialPending = !localStorage.getItem('mundial.tutorial') } catch { /* */ }
  if (tutorialPending && tutorialCtl) {
    tutorialCtl.addEventListener('cc-tutorial-done', () => { showDailyPopupIfPending() }, { once: true })
    return
  }
  showDailyPopupIfPending()
}

// Cambio de pestaña con guarda: si hay cambios sin aplicar (afectan las llaves),
// se pregunta si aplicarlos o ignorarlos antes de cambiar de sección.
type Tab = 'grupos' | 'resultados' | 'llaves' | 'puntajes'
const tabSwitch = ref<Tab | null>(null)
function goTab (target: Tab) {
  if (target === tab.value) return
  if (pending.value && !readonly.value && !isOfficial.value) { tabSwitch.value = target; return }
  tab.value = target
  trackEvent('tab/' + target)
}
function applyAndGo () {
  confirmChanges()
  if (tabSwitch.value) tab.value = tabSwitch.value
  tabSwitch.value = null
}
function ignoreAndGo () {
  if (tabSwitch.value) tab.value = tabSwitch.value
  tabSwitch.value = null
}

// Código a firmar/compartir: el del pronóstico elegido en la barra lateral
// (o el activo si se comparte sin elegir).
const shareCode = computed(() => {
  const entry = library.value.find((p) => p.id === shareEntryId.value)
  if (entry) return entry.id === activeId.value ? encodePrediction(pred) : entry.code
  return encodePrediction(pred)
})

// Nombre del pronóstico que se está compartiendo (viaja en el enlace, máx 50).
const shareName = computed(() => library.value.find((p) => p.id === shareEntryId.value)?.name)
// Enlace original de un pronóstico ajeno (para reusarlo sin re-firmar).
const sharePreset = computed(() => {
  const e = library.value.find((p) => p.id === shareEntryId.value)
  return e && !e.mine ? (e.sharedUrl ?? null) : null
})

function openShare (id: string) {
  shareEntryId.value = id
  shareOpen.value = true
}

// Si el pronóstico está incompleto, avisamos antes de compartir/imprimir/PDF
// (no se bloquea: el usuario puede continuar igual).
// Máximo de faltantes que se listan en el aviso (el resto se resume con "+N").
const WARN_MAX_MISSING = 5
const warn = ref<null | { pct: number; missing: string[]; more: number; run: () => void }>(null)
// Etiqueta de un equipo para el aviso (bandera + código); "?" si la llave aún
// no tiene definido ese cupo.
function teamLabel (id: number | null): string {
  if (id == null) return '?'
  const tm = teamById(id)
  return `${tm.flag} ${tm.code}`
}
function formatMissing (m: MissingItem): string {
  const round = m.kind === 'group' ? t('group.title', { letter: m.letter }) : t('bracket.' + m.round)
  return `${round}: ${teamLabel(m.home)} ${t('common.vs')} ${teamLabel(m.away)}`
}
function guardComplete (id: string, run: () => void) {
  const p = predForEntry(id)
  if (!p) { run(); return }
  const pct = completeness(p).pct
  if (pct >= 100) { run(); return }
  const all = listMissing(p)
  warn.value = {
    pct,
    missing: all.slice(0, WARN_MAX_MISSING).map(formatMissing),
    more: Math.max(0, all.length - WARN_MAX_MISSING),
    run,
  }
}
function confirmWarn () {
  const w = warn.value
  warn.value = null
  w?.run()
}
// Antes de compartir/imprimir, exige tener apodo (para firmar con identidad):
// si no hay, abre el perfil para ponerlo y continúa solo al guardarlo.
const pendingShare = ref<null | (() => void)>(null)
const nickPrompt = ref(false)
async function ensureNick (run: () => void) {
  const idi = await getIdentity()
  if (idi && !idi.me?.nickname) {
    pendingShare.value = run
    nickPrompt.value = true
    identityFocus.value = null
    identityFocusNick.value = null
    identityOpen.value = true
    return
  }
  run()
}
async function onIdentityChanged () {
  library.value = [...library.value]
  const idi = await getIdentity()
  if (pendingShare.value && idi?.me?.nickname) {
    const run = pendingShare.value
    pendingShare.value = null
    nickPrompt.value = false
    identityOpen.value = false
    run()
  }
}
function onIdentityClose () {
  identityOpen.value = false
  pendingShare.value = null
  nickPrompt.value = false
}

// Disponible para componentes hijos (p. ej. aportar a una sala firma con la
// identidad y por eso exige apodo, igual que compartir).
provide('ensureNick', ensureNick)

// Compartir/imprimir un pronóstico AJENO reusa su enlace original (no se firma
// con tu identidad ni se pide apodo, y no aplica el aviso de incompleto: no es
// tuyo para completarlo). Si es propio, exige apodo y avisa si está incompleto.
function shareGuard (id: string, action: (id: string) => void) {
  const e = library.value.find((p) => p.id === id)
  if (e && !e.mine) { action(id); return }
  // Propio: primero el aviso de incompleto (inmediato) y luego, al continuar,
  // se exige el apodo antes de firmar/compartir.
  guardComplete(id, () => ensureNick(() => action(id)))
}
function tryShare (id: string) { shareGuard(id, openShare) }
function tryPrint (id: string) { shareGuard(id, printEntry) }
function tryPdf (id: string) { shareGuard(id, pdfEntry) }

// Datos para la vista de impresión (PrintView).
const printQr = ref('')
const printPred = ref<Prediction | null>(null)
const printTitle = ref('')
const printAuthor = ref<string | undefined>(undefined)
// Modo captura del PrintView: cuando es true, la hoja se renderiza visible
// (fuera de pantalla) para poder rasterizarla con html2canvas.
const pdfCapturing = ref(false)
const printView = ref<HTMLElement | null>(null)

// Pronóstico que se va a imprimir: el del entry compartido. Si es el activo,
// usamos el estado reactivo en vivo; si no, decodificamos su código guardado.
function predForEntry (id: string | null): Prediction | null {
  const entry = library.value.find((p) => p.id === id)
  if (!entry) return clonePrediction(pred)
  if (entry.id === activeId.value) return clonePrediction(pred)
  // Para un pronóstico NO activo, el código solo trae posiciones/llaves; le
  // adjuntamos modo y resultados locales del entry para que PrintView elija el
  // template correcto (Simple/Medio/Completo) y muestre puntos/marcadores.
  try {
    const p = decodePrediction(entry.code)
    if (entry.mode) p.mode = entry.mode
    if (entry.scope) p.scope = entry.scope
    if (entry.results) p.results = JSON.parse(JSON.stringify(entry.results))
    return p
  } catch { return null }
}

// Disparado por ShareModal con la URL firmada ya armada: generamos el QR de esa
// misma URL, poblamos PrintView y lanzamos el diálogo de impresión del navegador.
async function handlePrint (url: string) {
  const entry = library.value.find((p) => p.id === shareEntryId.value)
  printPred.value = predForEntry(shareEntryId.value)
  if (!printPred.value) return
  printTitle.value = entry?.name || activeEntry.value?.name || t('store.defaultTitle')
  printAuthor.value = entry?.author?.nickname ?? activeEntry.value?.author?.nickname
  printQr.value = await QRCode.toDataURL(url, { margin: 1, width: 512 })
  shareOpen.value = false
  await nextTick()
  window.print()
}

// Genera y DESCARGA un PDF con la misma hoja de PrintView, sin pasar por el
// diálogo de impresión: renderiza la hoja en modo captura (oculta fuera de
// pantalla), la rasteriza con html2canvas y la incrusta en un A4 portrait.
function sanitizeFilename (name: string): string {
  // Quita acentos (rango de marcas combinantes ̀-ͯ) y caracteres no seguros.
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-')
  return (base || 'pronostico') + '.pdf'
}

async function downloadPdf (url: string) {
  const entry = library.value.find((p) => p.id === shareEntryId.value)
  printPred.value = predForEntry(shareEntryId.value)
  if (!printPred.value) return
  printTitle.value = entry?.name || activeEntry.value?.name || t('store.defaultTitle')
  printAuthor.value = entry?.author?.nickname ?? activeEntry.value?.author?.nickname
  try {
    printQr.value = await QRCode.toDataURL(url, { margin: 1, width: 512 })
    shareOpen.value = false
    pdfCapturing.value = true
    await nextTick()
    // El contenedor envuelve al PrintView; capturamos su primer hijo (la hoja).
    const el = printView.value?.firstElementChild as HTMLElement | null
    if (!el) throw new Error(t('pdf.sheetNotFound'))
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#fff', useCORS: true })
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    let imgW = pageW
    let imgH = (canvas.height / canvas.width) * imgW
    // Si excede el alto de página, reescalamos para que entre en una página.
    if (imgH > pageH) {
      imgH = pageH
      imgW = (canvas.width / canvas.height) * imgH
    }
    const x = (pageW - imgW) / 2
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, 0, imgW, imgH)
    doc.save(sanitizeFilename(printTitle.value))
  } catch (e: unknown) {
    alert(t('pdf.error') + (e instanceof Error ? e.message : ''))
  } finally {
    pdfCapturing.value = false
  }
}

// Exportar a PDF directamente (sin abrir el modal): firma el código y dispara
// la descarga del PDF con la misma hoja.
// URL para QR/compartir de una entrada: si es AJENA y tenemos su enlace
// original firmado, lo reusamos (no se re-firma con la identidad propia). Si es
// propia, se firma el código actual con tu identidad.
async function urlForEntry (entry: SavedPrediction): Promise<string> {
  if (!entry.mine && entry.sharedUrl) return entry.sharedUrl
  const code = entry.id === activeId.value ? encodePrediction(pred) : entry.code
  // Reutiliza el sello guardado (fecha del sellado original) y persiste el que
  // se use (autosellado: imprimir/PDF también dejan el pronóstico sellado).
  const res = await buildShareUrl(code, entry.name, presetSealFor(entry, code))
  adoptSeal(entry, code, res.seal)
  return res.url
}

async function pdfEntry (id: string) {
  const entry = library.value.find((p) => p.id === id)
  if (!entry) return
  shareEntryId.value = id
  try {
    await downloadPdf(await urlForEntry(entry))
  } catch (e: unknown) {
    alert(t('pdf.error') + (e instanceof Error ? e.message : ''))
  }
}

// Imprimir directamente desde la barra lateral: arma la URL del QR y dispara el
// mismo flujo de impresión que el modal de compartir.
async function printEntry (id: string) {
  const entry = library.value.find((p) => p.id === id)
  if (!entry) return
  shareEntryId.value = id
  try {
    await handlePrint(await urlForEntry(entry))
  } catch (e: unknown) {
    alert(t('pdf.printError') + (e instanceof Error ? e.message : ''))
  }
}

// Cambia el idioma de la interfaz (ES/EN) y persiste la preferencia.
function changeLocale (l: Locale) {
  setLocale(l)
}

function openProfile () {
  identityFocus.value = null
  identityFocusNick.value = null
  identityOpen.value = true
  sidebarOpen.value = false
}

function rateAuthor () {
  // Ya tenemos la clave pública del autor (viene firmada en el link): el panel
  // lo agrega como contacto por su clave (sin token) y permite valorarlo.
  // Apodo: el del autor si lo tiene; si no, el NOMBRE del pronóstico como
  // etiqueta de respaldo (también viaja en el link).
  identityFocus.value = activeEntry.value?.author?.publickey ?? null
  identityFocusNick.value = activeEntry.value?.author?.nickname || activeEntry.value?.name || null
  identityOpen.value = true
}

// Edición inline del nombre del pronóstico activo en la cabecera.
const editingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

function startEditName () {
  if (readonly.value || isOfficial.value || !activeEntry.value) return
  nameDraft.value = activeEntry.value.name
  editingName.value = true
  nextTick(() => nameInput.value?.focus())
}

function commitName () {
  if (!editingName.value) return
  const entry = activeEntry.value
  const name = nameDraft.value.trim()
  if (entry && name) { entry.name = name; saveLibrary(library.value) }
  editingName.value = false
}

function applyPrediction (p: Prediction) {
  loading = true
  pred.mode = p.mode
  pred.scope = p.scope
  pred.results = p.results
  pred.groupOrder = p.groupOrder
  pred.thirdsRank = p.thirdsRank
  pred.draftGroupOrder = p.draftGroupOrder
  pred.draftThirdsRank = p.draftThirdsRank
  pred.picks = p.picks
  nextTick(() => { loading = false })
}

function persistActive () {
  const entry = activeEntry.value
  if (!entry || !entry.mine) return
  // El oficial no es un pronóstico: sus posiciones/llaves se derivan solas de
  // los resultados (sin paso de "Confirmar"). Forzamos modo 'score' y scope 'all'
  // (es la base de comparación de todos los alcances).
  if (entry.official) { pred.mode = 'score'; pred.scope = 'all'; confirmStandings(pred) }
  prunePicks(pred)
  entry.code = encodePrediction(pred)
  // Modo, alcance y resultados son datos locales (no van en el código compartido).
  entry.mode = pred.mode
  entry.scope = pred.scope
  entry.results = pred.results
  entry.draftGroupOrder = pred.draftGroupOrder
  entry.draftThirdsRank = pred.draftThirdsRank
  entry.updatedAt = Date.now()
  saveLibrary(library.value)
}

watch(pred, () => {
  if (loading) return
  // Los reordenamientos que no afectan las llaves se confirman solos (no nag).
  if (!readonly.value) autoConfirmNonBracket(pred)
  persistActive()
}, { deep: true })

function select (id: string) {
  const entry = library.value.find((p) => p.id === id)
  if (!entry) return
  activeId.value = id
  setActiveId(id)
  sealError.value = false // el error de sellado pertenece a la entrada anterior
  try { applyPrediction(decodePrediction(entry.code)) }
  catch { applyPrediction(defaultPrediction()) }
  // Modo/alcance/resultados: si el entry los tiene guardados (míos), úsalos; si
  // no (importados), quedan los que ya trae el código decodificado.
  if (entry.mode) pred.mode = entry.mode
  if (entry.scope) pred.scope = entry.scope
  if (entry.results) pred.results = JSON.parse(JSON.stringify(entry.results))
  // El borrador local del entry, si existe; si no, arranca == confirmado.
  pred.draftGroupOrder = entry.draftGroupOrder
    ? entry.draftGroupOrder.map((a) => [...a])
    : pred.groupOrder.map((a) => [...a])
  pred.draftThirdsRank = entry.draftThirdsRank ? [...entry.draftThirdsRank] : [...pred.thirdsRank]
  // El oficial siempre en modo marcador, alcance completo y abriendo en "Resultados".
  if (entry.official) { pred.mode = 'score'; pred.scope = 'all'; tab.value = 'resultados' }
  // Si la pestaña activa no aplica al (modo, scope) elegido, caemos a una válida.
  else if (!tabAllowed(tab.value)) tab.value = defaultTab(pred.mode, pred.scope)
  // Nota: NO cerramos el sidebar aquí. select() corre también al montar
  // (auto-selección) y queremos que en móvil el cajón arranque ABIERTO. El
  // cierre al elegir un ítem lo hace el handler @select del cajón.
}

// Garantiza que exista EXACTAMENTE una entrada de resultados oficiales. Si no
// hay ninguna, la crea y persiste; no se duplica en cada arranque.
function ensureOfficialEntry () {
  if (library.value.some((p) => p.official)) return
  const entry: SavedPrediction = {
    id: genId(),
    name: t('store.officialName'),
    mine: true,
    official: true,
    mode: 'score',
    scope: 'all',
    results: {},
    code: encodePrediction(defaultPrediction()),
    updatedAt: Date.now(),
  }
  library.value.push(entry)
  saveLibrary(library.value)
}

// ---- Resultados oficiales en vivo (relay results.dotrino.com) ------------
// El relay centraliza ESPN + FIFA (+ overrides manuales firmados) y FIRMA el
// feed. Acá lo traemos, verificamos la firma contra la pubkey pineada y lo
// aplicamos a la entrada oficial (base de comparación de todos los puntajes,
// que se recalculan solos). La app NUNCA pega a ESPN/FIFA: solo al relay.
const officialFeed = ref<Feed | null>(null)
const officialStatus = ref<'idle' | 'loading' | 'ok' | 'offline'>('idle')
const officialUpdatedAt = ref(0)
const publishStatus = ref<'idle' | 'publishing' | 'ok' | 'error' | 'unauthorized' | 'nochange'>('idle')
// ¿Mi identidad está autorizada a publicar? (para mostrar el botón solo al admin)
const isOfficialAdmin = ref(false)
let officialPoll: number | null = null

async function updateAdminStatus (): Promise<void> {
  if (!officialFeed.value) { isOfficialAdmin.value = false; return }
  const idi = await getIdentity()
  isOfficialAdmin.value = await isAdminIdentity(officialFeed.value, idi?.me?.publickey ?? null)
}

function applyOfficialBuild (build: ReturnType<typeof buildOfficial>): boolean {
  ensureOfficialEntry()
  const off = library.value.find((p) => p.official)
  if (!off) return false
  const newResults = JSON.parse(JSON.stringify(build.results)) as Prediction['results']
  if (off.code === build.code && JSON.stringify(off.results ?? {}) === JSON.stringify(newResults)) return false
  off.results = newResults
  off.code = build.code
  off.mode = 'score'
  off.scope = 'all'
  off.updatedAt = Date.now()
  // Si la entrada oficial está activa, refrescamos también la vista en vivo.
  if (activeEntry.value?.id === off.id) {
    loading = true
    try { applyPrediction(decodePrediction(off.code)) } catch { /* code inválido: dejamos la vista */ }
    pred.mode = 'score'; pred.scope = 'all'
    pred.results = JSON.parse(JSON.stringify(off.results))
    nextTick(() => { loading = false })
  }
  saveLibrary(library.value)
  library.value = [...library.value] // fuerza recálculo de computeds (officialEntry/scores)
  return true
}

// Trae el feed del relay y lo aplica. `force`: aplica aunque la entrada oficial
// esté activa (botón/arranque). Sin force (polling) NO pisa la edición del admin.
async function refreshOfficial (force = false): Promise<void> {
  officialStatus.value = 'loading'
  const sf = await fetchOfficialFeed()
  if (!sf) { officialStatus.value = 'offline'; return }
  officialFeed.value = sf.data
  officialUpdatedAt.value = sf.data.updatedAt || Date.now()
  void updateAdminStatus()
  if (force || !activeEntry.value?.official) applyOfficialBuild(buildOfficial(sf.data))
  officialStatus.value = 'ok'
}

// Publica las correcciones manuales (lo que DIFIERE del proveedor) firmadas por
// el vault del admin. Solo el admin (pubkey en la allowlist del relay) es aceptado.
async function publishOfficialResults (): Promise<void> {
  if (!officialFeed.value) await refreshOfficial(true)
  if (!officialFeed.value) { publishStatus.value = 'error'; return }
  const items = buildPublishItems(pred, officialFeed.value)
  if (!items.length) { publishStatus.value = 'nochange'; return }
  publishStatus.value = 'publishing'
  const idi = await getIdentity()
  if (!idi) { publishStatus.value = 'error'; return }
  const r = await publishOfficial(items, idi)
  if (r.ok) { publishStatus.value = 'ok'; await refreshOfficial(true) }
  else if (r.status === 403) publishStatus.value = 'unauthorized'
  else publishStatus.value = 'error'
}

function officialHasLive (): boolean {
  return !!officialFeed.value?.matches?.some((m) => m.status === 'in')
}
function scheduleOfficialPoll (): void {
  if (officialPoll != null) { clearTimeout(officialPoll); officialPoll = null }
  if (typeof document !== 'undefined' && document.hidden) return
  const delay = officialHasLive() ? 60_000 : 5 * 60_000
  officialPoll = window.setTimeout(async () => { await refreshOfficial(false); scheduleOfficialPoll() }, delay)
}
function onOfficialVisibility (): void {
  if (document.hidden) { if (officialPoll != null) { clearTimeout(officialPoll); officialPoll = null } }
  else { void refreshOfficial(false); scheduleOfficialPoll() }
}

function uniqueName () {
  const n = library.value.filter((p) => p.mine).length + 1
  return t('store.defaultName', { n })
}

// Nombre legible del modo (para nombres de clones, etc.).
function modeName (m: GameMode): string {
  return m === 'winlose' ? t('modes.medium') : m === 'score' ? t('modes.full') : t('modes.simple')
}

// Nombre legible del alcance (scope).
function scopeName (s: Scope): string {
  return s === 'groups' ? t('scopes.groups') : s === 'bracket' ? t('scopes.bracket') : t('scopes.all')
}

// Nombre de un pronóstico clonado: añade el modo y, si no es 'all', el scope.
function typeSuffix (mode: GameMode, scope: Scope): string {
  const m = ' · ' + modeName(mode)
  return scope === 'all' ? m : m + ' · ' + scopeName(scope)
}

// Crea un pronóstico NUEVO con un tipo (modo) y alcance (scope) fijos al crearlo.
// Siembra de 'Solo llaves': la fase de grupos NO la pronostica el usuario, sale
// de los RESULTADOS OFICIALES (la misma base que habilitó el alcance). Copia los
// resultados de grupos del oficial y deriva posiciones/terceros reales; el
// usuario solo elige quién avanza en las llaves.
function seedBracketFromOfficial (p: Prediction): void {
  const off = officialEntry.value
  if (!off?.results) return
  const groupResults: Results = {}
  for (let i = 0; i < GROUP_MATCH_COUNT; i++) {
    const r = off.results[i]
    if (r) groupResults[i] = JSON.parse(JSON.stringify(r))
  }
  const st = computeStandings(groupResults, off.mode ?? 'score')
  if (p.mode !== 'manual') p.results = groupResults
  p.groupOrder = st.groupOrder.map((g) => [...g])
  p.thirdsRank = [...st.thirdsRank]
  p.draftGroupOrder = st.groupOrder.map((g) => [...g])
  p.draftThirdsRank = [...st.thirdsRank]
  prunePicks(p)
}

function create (mode: GameMode = 'manual', scope: Scope = 'all') {
  const p = defaultPrediction()
  p.mode = mode
  p.scope = scope
  if (scope === 'bracket') seedBracketFromOfficial(p)
  const entry: SavedPrediction = {
    id: genId(), name: uniqueName(),
    code: encodePrediction(p), mode, scope, results: p.results,
    draftGroupOrder: p.draftGroupOrder, draftThirdsRank: p.draftThirdsRank,
    updatedAt: Date.now(), mine: true,
  }
  library.value.push(entry)
  saveLibrary(library.value)
  select(entry.id)
  tab.value = defaultTab(mode, scope)
}

// Clona un pronóstico a OTRO tipo (modo + scope): conserva sus datos.
function cloneToType (id: string, mode: GameMode, scope: Scope) {
  const src = library.value.find((p) => p.id === id)
  if (!src) return
  let p: Prediction
  try { p = decodePrediction(src.code) } catch { p = defaultPrediction() }
  p.mode = mode
  p.scope = scope
  if (src.results) p.results = JSON.parse(JSON.stringify(src.results))
  // A 'Solo llaves': los grupos se re-siembran del oficial (los picks de llaves
  // del original se conservan; los que dejen de ser válidos se podan solos).
  if (scope === 'bracket') seedBracketFromOfficial(p)
  const entry: SavedPrediction = {
    id: genId(), name: src.name + typeSuffix(mode, scope),
    code: encodePrediction(p), mode, scope, results: p.results,
    draftGroupOrder: scope === 'bracket' ? p.draftGroupOrder : src.draftGroupOrder,
    draftThirdsRank: scope === 'bracket' ? p.draftThirdsRank : src.draftThirdsRank,
    updatedAt: Date.now(), mine: true,
  }
  library.value.push(entry)
  saveLibrary(library.value)
  select(entry.id)
  tab.value = defaultTab(mode, scope)
}

// Selector de tipo (modal), en DOS pasos: primero el modo (Simple/Medio/
// Completo), luego el alcance (Todo/Grupos/Llaves). `mode` se fija al elegir el
// paso 1 y avanza al paso 2; null = aún en el paso 1.
const typePicker = ref<null | { action: 'new' | 'clone'; id?: string; mode?: GameMode }>(null)
function cloneActive () {
  if (activeId.value) typePicker.value = { action: 'clone', id: activeId.value }
}
// Paso 1: elegir modo → avanza al paso 2 (scope).
function pickMode (mode: GameMode) {
  if (!typePicker.value) return
  typePicker.value = { ...typePicker.value, mode }
}
// Volver del paso 2 (scope) al paso 1 (modo).
function pickerBack () {
  if (typePicker.value) typePicker.value = { action: typePicker.value.action, id: typePicker.value.id }
}
// Paso 2: elegir scope → crea o clona y cierra.
function pickScope (scope: Scope) {
  if (scopeDisabled(scope)) return // 'bracket' aún no habilitado
  const p = typePicker.value
  typePicker.value = null
  if (!p || !p.mode) return
  if (p.action === 'new') create(p.mode, scope)
  else if (p.id) cloneToType(p.id, p.mode, scope)
}

function remove (id: string) {
  const entry = library.value.find((p) => p.id === id)
  if (!entry || entry.daily) return // la entrada diaria es única por cuenta: no se borra
  if (!confirm(t('store.confirmDelete', { name: entry.name }))) return
  library.value = library.value.filter((p) => p.id !== id)
  saveLibrary(library.value)
  if (activeId.value === id) {
    const next = library.value[0]
    if (next) select(next.id)
    else create()
  }
}

function rename (id: string) {
  const entry = library.value.find((p) => p.id === id)
  if (!entry) return
  const name = prompt(t('store.promptRename'), entry.name)
  if (name && name.trim()) { entry.name = name.trim(); saveLibrary(library.value) }
}

function copyToMine (id: string) {
  const entry = library.value.find((p) => p.id === id)
  if (!entry) return
  const copy: SavedPrediction = {
    id: genId(), name: entry.name + t('store.copySuffix'), code: entry.code,
    updatedAt: Date.now(), mine: true,
  }
  library.value.push(copy)
  saveLibrary(library.value)
  select(copy.id)
}

function extractFragment (text: string): string {
  const t = text.trim()
  const hash = t.lastIndexOf('#')
  return hash >= 0 ? t.slice(hash + 1) : t
}

async function doImport () {
  importError.value = ''
  importing.value = true
  try {
    const frag = extractFragment(importText.value)
    const parsed = await parseShareFragment(frag)
    if (!parsed) throw new Error(t('store.invalidLink'))
    decodePrediction(parsed.code) // valida
    const isMine = parsed.verified && await isOwnAuthor(parsed.publickey)
    // Acuse de apertura al autor (si es de otra persona). Throttle 24h en el motor.
    if (!isMine) void reportOpen(parsed.publickey, `${SHARE_BASE}#${frag}`, parsed.name)
    // ¿Ya lo tenemos? lo seleccionamos en vez de duplicar. (La entrada diaria no
    // cuenta: no se abre como pronóstico clásico; el enlace entra como copia.)
    const existing = library.value.find((p) => !p.official && !p.daily && p.code === parsed.code)
    if (existing) {
      if (adoptIncomingSeal(existing, parsed, isMine)) saveLibrary(library.value)
      select(existing.id)
    } else {
      const entry = buildIncomingEntry(parsed, frag, isMine)
      library.value.push(entry)
      saveLibrary(library.value)
      select(entry.id)
    }
    tab.value = 'llaves'
    importOpen.value = false
    importText.value = ''
  } catch (e: unknown) {
    importError.value = e instanceof Error ? e.message : String(e)
  } finally {
    importing.value = false
  }
}

// Construye la entrada de un pronóstico recibido. Si el autor es uno mismo
// (misma clave pública), se guarda como PROPIO y editable; si no, como ajeno
// (solo lectura) conservando su enlace original firmado.
function buildIncomingEntry (parsed: NonNullable<Awaited<ReturnType<typeof parseShareFragment>>>, frag: string, isMine: boolean): SavedPrediction {
  if (isMine) {
    const p = decodePrediction(parsed.code)
    const entry: SavedPrediction = {
      id: genId(), name: parsed.name || t('store.sharedName'), code: parsed.code,
      updatedAt: Date.now(), mine: true,
      mode: p.mode, scope: p.scope, results: p.results,
      draftGroupOrder: p.groupOrder.map((a) => [...a]), draftThirdsRank: [...p.thirdsRank],
    }
    adoptIncomingSeal(entry, parsed, true) // rama isMine: el enlace propio trae su sello
    return entry
  }
  return {
    id: genId(), name: parsed.name || parsed.nickname || t('store.sharedName'),
    code: parsed.code, updatedAt: Date.now(), mine: false,
    author: { publickey: parsed.publickey, nickname: parsed.nickname, verified: parsed.verified },
    sharedUrl: `${SHARE_BASE}#${frag}`,
  }
}

// ¿La clave pública del autor recibido es la mía? (entonces el pronóstico es propio)
async function isOwnAuthor (publickey: string): Promise<boolean> {
  const idi = await getIdentity()
  return !!idi?.me?.publickey && idi.me.publickey === publickey
}

// Despacha un #fragmento según su tipo: invitación de sala, contribución de un
// miembro o (por defecto) un pronóstico compartido.
async function handleHash (frag: string): Promise<boolean> {
  const kind = fragKind(frag)
  if (kind === 'room') return handleRoomInvite(frag)
  if (kind === 'member') return handleMemberContrib(frag)
  return importFromHash(frag)
}

// Invitación de sala (#room=…): verifica el descriptor firmado, guarda la sala
// (si es nueva) y la abre en la sección Salas.
async function handleRoomInvite (frag: string): Promise<boolean> {
  history.replaceState(null, '', location.pathname + location.search)
  const id = await importRoomInvite(frag)
  if (!id) { alert(t('rooms.invalidInvite')); return false }
  section.value = 'rooms'
  openRoom(id)
  sidebarOpen.value = false
  return true
}

// Contribución de un miembro (#rm=…): asocia su pronóstico firmado a la sala.
async function handleMemberContrib (frag: string): Promise<boolean> {
  history.replaceState(null, '', location.pathname + location.search)
  const res = await importMemberContrib(frag)
  if (res === 'NOROOM') { alert(t('rooms.needRoomFirst')); return false }
  if (!res) { alert(t('rooms.contribInvalid')); return false }
  section.value = 'rooms'
  openRoom(res)
  sidebarOpen.value = false
  return true
}

// Desde la barra de SALAS: abrir los Resultados oficiales para simular/cargar
// marcadores y ver cómo cambian los puntajes de la sala. Selecciona la entrada
// oficial y muestra su pestaña Resultados (en la sección de pronósticos).
function openOfficialResults () {
  const off = officialEntry.value
  if (off) select(off.id)
  section.value = 'predictions'
  tab.value = 'resultados'
  sidebarOpen.value = false
}

// Acepta una invitación recibida en vivo (toast del buzón).
async function acceptInvite () {
  const inv = inviteToast.value
  inviteToast.value = null
  if (!inv) return
  const frag = inv.url.includes('#') ? inv.url.slice(inv.url.indexOf('#') + 1) : inv.url
  await handleRoomInvite(frag)
}

// Importa el pronóstico que viene en el #fragmento. Devuelve true si lo importó
// (o si ya existía y lo seleccionó). Limpia el hash de la URL al terminar.
async function importFromHash (frag: string): Promise<boolean> {
  // Borramos el hash apenas lo leemos (antes de la verificación async), para que
  // no quede en la URL ni se reprocese.
  history.replaceState(null, '', location.pathname + location.search)
  const parsed = await parseShareFragment(frag)
  if (!parsed) return false
  try { decodePrediction(parsed.code) } catch { return false }
  const isMine = parsed.verified && await isOwnAuthor(parsed.publickey)
  // Acuse de apertura: si el pronóstico es de OTRA persona, avisarle (por su
  // pubkey, que viene en el enlace) que lo abrimos. Throttle 24h en el motor.
  if (!isMine) void reportOpen(parsed.publickey, `${SHARE_BASE}#${frag}`, parsed.name)
  // Si ya lo tenemos (propio o de amigo), no duplicamos: lo seleccionamos. (La
  // entrada diaria no cuenta: no se abre como pronóstico clásico.)
  const existing = library.value.find((p) => !p.official && !p.daily && p.code === parsed.code)
  if (existing) {
    if (parsed.name && !existing.mine) existing.name = parsed.name
    if (adoptIncomingSeal(existing, parsed, isMine)) saveLibrary(library.value)
    select(existing.id)
    tab.value = 'llaves'
    return true
  }
  const entry = buildIncomingEntry(parsed, frag, isMine)
  library.value.push(entry)
  saveLibrary(library.value)
  select(entry.id)
  tab.value = 'llaves'
  return true
}

// Si el hash cambia estando la app ya cargada (pegar otro link en la misma
// pestaña no recarga la página), reimportamos.
async function onHashChange () {
  const frag = location.hash.replace(/^#/, '')
  if (frag) await handleHash(frag)
}

// Inicia el buzón de invitaciones a salas (si hay identidad), para recibir en
// vivo invitaciones de contactos mientras la app está abierta.
async function startInbox () {
  const idi = await getIdentity()
  if (!idi?.me?.publickey || inbox) return
  inbox = new RoomInbox(
    (inv) => { inviteToast.value = inv },
    (env) => { void applyEnvelope(env) },
  )
  inbox.start()
  // Acuses de apertura: notificar cuando un tercero abre un pronóstico compartido.
  void startReceipts()
}

onMounted(async () => {
  window.addEventListener('hashchange', onHashChange)

  library.value = loadLibrary()
  ensureOfficialEntry()
  ensureDaily()

  // Estado compartido de salas (carga salas + identidad para autoría).
  await initRooms()

  const frag = location.hash.replace(/^#/, '')
  if (frag) {
    const kind = fragKind(frag)
    const handled = await handleHash(frag)
    // Un pronóstico compartido ya quedó seleccionado por importFromHash; las
    // salas, en cambio, se superponen y debajo igual necesitamos una selección.
    if (handled && kind === 'prediction') { startInbox(); return }
  }

  const saved = getActiveId()
  if (saved && library.value.some((p) => p.id === saved)) select(saved)
  else if (library.value.length) select(library.value[0]!.id)
  else create()

  // El buzón de invitaciones corre en segundo plano (no bloquea el arranque).
  startInbox()

  // Tutorial guiado (una sola vez por dispositivo). Solo en visita "limpia" (sin
  // enlace entrante), para no interrumpir a quien llega por un enlace compartido.
  if (!frag) {
    tutorialCtl = startAppTutorial({
      lang: () => locale.value,
      setSection: (s) => { section.value = s },
      setSidebar: (open) => { sidebarOpen.value = open },
      hasRoom: () => rooms.value.length > 0,
    })
  }

  // Rehidratación de pronósticos desde el store del ecosistema (segundo plano):
  // fusiona lo que haya en la nube (otros dispositivos) sin interrumpir la vista.
  hydrateLibrary(library.value)
    .then(({ list, changed }) => {
      if (!changed) return
      library.value = list
      saveLibrary(list)
      ensureOfficialEntry()
      // La entrada diaria es única por cuenta: si la nube trajo otra (creada en
      // paralelo en otro dispositivo), ensureDaily la fusiona pick a pick.
      ensureDaily()
      // Si el pronóstico activo llegó actualizado desde la nube, refrescamos la vista.
      if (activeId.value && library.value.some((p) => p.id === activeId.value)) select(activeId.value)
    })
    .catch(() => { /* sin nube, seguimos local */ })
    // El popup diario espera a la rehidratación: así no ofrece partidos que ya
    // se pronosticaron en otro dispositivo de la misma cuenta.
    .finally(() => { if (!frag) maybeShowDailyPopup() })

  // Resultados oficiales en vivo: traer del relay al abrir y mantener al día
  // (poll mientras la página esté visible; más seguido si hay partido en juego).
  void refreshOfficial(true).then(scheduleOfficialPoll)
  document.addEventListener('visibilitychange', onOfficialVisibility)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', onHashChange)
  document.removeEventListener('visibilitychange', onOfficialVisibility)
  if (officialPoll != null) clearTimeout(officialPoll)
  inbox?.stop()
  stopSync()
})
</script>

<template>
  <div class="shell">
    <Sidebar
      :open="sidebarOpen"
      :library="library"
      :active-id="activeId"
      @close="sidebarOpen = false"
      @select="(id) => { select(id); sidebarOpen = false }"
      @create="typePicker = { action: 'new' }; sidebarOpen = false"
      @import="importOpen = true; sidebarOpen = false"
      @remove="remove"
      @rename="rename"
      @copy="copyToMine"
      @clonetype="(id) => { typePicker = { action: 'clone', id }; sidebarOpen = false }"
      @share="tryShare"
      @print="tryPrint"
      @pdf="tryPdf"
      @scoring="scoringOpen = true; sidebarOpen = false"
      :section="section"
      @setsection="section = $event"
      @openresults="openOfficialResults"
      @sharedaily="shareDaily(); sidebarOpen = false"
    />
    <div class="main">
    <header class="scoreboard">
      <button class="menu" data-testid="menu-btn" @click="sidebarOpen = true" :aria-label="t('header.menu')">☰</button>
      <!-- En móvil el chevron va a la izquierda del logo; en web vive en el
           sidebar, junto a "Pronósticos" (ver Sidebar.vue). -->
      <dotrino-back class="cc-back cc-back-sc"></dotrino-back>
      <img src="/favicon.svg" :alt="t('header.logo')" class="brand-logo" />
      <div class="title">
        <span class="cup">{{ t('header.cup') }}</span>
        <h1>{{ t('header.title') }} <em>2026</em></h1>
      </div>
      <div class="hdr-right">
        <!-- Selector de idioma compacto (ES | EN) -->
        <div class="lang-selector" data-testid="lang-selector" role="group" :aria-label="t('lang.label')">
          <button data-testid="lang-es" :class="{ on: locale === 'es' }" @click="changeLocale('es')">{{ t('lang.es') }}</button>
          <button data-testid="lang-en" :class="{ on: locale === 'en' }" @click="changeLocale('en')">{{ t('lang.en') }}</button>
        </div>
        <!-- Botón circular de identidad (siempre visible), a la izquierda de la
             moneda de soporte, igual que en dotrino.com. -->
        <button class="identity-btn" data-testid="identity-btn" @click="openProfile" :aria-label="t('header.identity')" :title="t('header.identity')">👤</button>
        <dotrino-support href="https://ko-fi.com/dotrino" repo="dotrino/pronostico-mundialista" discord="https://discord.gg/D648uq7cth" :lang="locale"></dotrino-support>
      </div>
    </header>

    <!-- Barra activa de SALA: muestra claramente en qué sala estás. -->
    <div v-if="section === 'rooms' && activeRoom" class="active-bar rooms-bar" data-testid="room-active-bar">
      <span class="dot"></span>
      <span class="active-name">🏟 {{ activeRoom.name }}</span>
      <span class="room-status" :class="syncStatus">
        {{ syncStatus === 'online' ? t('rooms.live', { n: peerCount }) : t('rooms.offline') }}
      </span>
      <div class="bar-actions" data-testid="room-bar-actions">
        <button class="share-i" data-testid="room-bar-share" :title="t('common.share')" @click="roomShareOpen = true">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
          </svg>
        </button>
      </div>
      <button class="mini" @click="closeRoom">‹ {{ t('rooms.back') }}</button>
    </div>

    <template v-if="section === 'predictions'">
    <div class="active-bar">
      <span class="dot" :class="{ ro: readonly }"></span>
      <input
        v-if="editingName"
        ref="nameInput"
        v-model="nameDraft"
        class="name-input"
        data-testid="name-input"
        maxlength="40"
        @keydown.enter="commitName"
        @keydown.esc="editingName = false"
        @blur="commitName"
      />
      <button
        v-else
        class="active-name"
        data-testid="active-name"
        :class="{ editable: !readonly && !isOfficial }"
        :title="(readonly || isOfficial) ? '' : t('active.editName')"
        @click="startEditName"
      >
        {{ activeEntry?.name || t('active.placeholder') }}<span v-if="!readonly && !isOfficial" class="pen">✎</span>
      </button>
      <span v-if="readonly" class="ro-badge">
        {{ activeEntry?.author?.verified ? t('active.signed') : t('active.unverified') }}
        · {{ activeEntry?.author?.nickname || t('common.anonymous') }}
        <button class="mini" @click="rateAuthor">{{ t('active.rateAuthor') }}</button>
        <button class="mini" @click="activeEntry && copyToMine(activeEntry.id)">{{ t('active.editCopy') }}</button>
      </span>
      <span v-else-if="championId != null" class="champ-chip">
        🏆 {{ teamById(championId).flag }} {{ teamById(championId).code }}
      </span>

      <dotrino-install class="cc-install" :lang="locale" data-testid="install-btn"></dotrino-install>

      <!-- Acciones del pronóstico ACTIVO (alineadas a la derecha) -->
      <div v-if="activeId" class="bar-actions" data-testid="bar-actions">
        <button class="share-i" data-testid="bar-share" :title="t('common.share')" @click="tryShare(activeId)">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
          </svg>
        </button>
        <button :title="t('common.print')" data-testid="bar-print" @click="tryPrint(activeId)">🖨</button>
        <button class="pdf-i" data-testid="bar-pdf" :title="t('common.pdf')" @click="tryPdf(activeId)">
          <img src="/pdf.svg" alt="PDF" class="pdf-img" />
        </button>
        <button v-if="!isOfficial" class="clone-i" :title="t('modes.cloneToType')" data-testid="bar-clone" @click="cloneActive()">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
          </svg>
        </button>
        <button v-if="!readonly && !isOfficial" :title="t('common.rename')" data-testid="bar-rename" @click="startEditName">✎</button>
        <button v-if="readonly" :title="t('common.editCopy')" data-testid="bar-copy" @click="copyToMine(activeId)">⎘</button>
        <button v-if="!isOfficial" class="danger-i" data-testid="bar-delete" :title="t('common.delete')" @click="remove(activeId)">🗑</button>
      </div>
    </div>

    <!-- Selector de modo de juego (oculto en pronósticos importados). -->
    <!-- El tipo (modo) se fija al crear; aquí solo se muestra y se puede clonar
         a otro tipo. -->
    <div v-if="!readonly && !isOfficial" class="mode-bar" data-testid="mode-bar">
      <span class="mode-label">{{ t('modes.label') }} <strong class="mode-cur">{{ activeModeName }}</strong></span>
      <span class="mode-label scope-label">{{ t('scopes.label') }} <strong class="mode-cur">{{ activeScopeName }}</strong></span>
    </div>

    <!-- Franja de confirmación: visible cuando hay resultados sin aplicar. -->
    <div v-if="!readonly && !isOfficial && pending" class="confirm-bar" data-testid="confirm-bar">
      <span class="confirm-msg">{{ t('confirm.msg') }}</span>
      <div class="confirm-actions">
        <button class="confirm-btn" data-testid="confirm-btn" @click="confirmChanges">{{ t('confirm.btn') }}</button>
        <button v-if="pred.mode === 'manual'" class="cancel-btn" data-testid="cancel-btn" @click="cancelChanges">{{ t('confirm.cancel') }}</button>
      </div>
    </div>

    <!-- Franja de sellado: certifica la fecha del pronóstico sin compartirlo.
         El sello queda guardado; al editar deja de aplicar y se puede volver a
         sellar o cancelar la edición (volver al pronóstico sellado). -->
    <div v-if="!readonly && !isOfficial && activeEntry" class="seal-bar" :class="sealState" data-testid="seal-bar">
      <template v-if="sealState === 'sealed'">
        <span class="seal-msg" data-testid="seal-status">{{ t('seal.sealedAt', { date: sealDate }) }}</span>
      </template>
      <template v-else-if="sealState === 'stale'">
        <span class="seal-msg" data-testid="seal-status">{{ t('seal.stale') }}</span>
        <div class="seal-actions">
          <button class="seal-btn" data-testid="seal-btn" :disabled="sealing" @click="trySeal">{{ sealing ? '…' : t('seal.resealBtn') }}</button>
          <button class="seal-cancel" data-testid="seal-cancel-edit" :title="t('seal.cancelEditTitle')" @click="cancelEdit">{{ t('seal.cancelEdit') }}</button>
        </div>
      </template>
      <template v-else>
        <span class="seal-msg" data-testid="seal-status">{{ t('seal.hint') }}</span>
        <button class="seal-btn" data-testid="seal-btn" :disabled="sealing" @click="trySeal">{{ sealing ? '…' : t('seal.btn') }}</button>
      </template>
      <span v-if="sealError" class="seal-err" data-testid="seal-error">{{ t('seal.error') }}</span>
    </div>

    <nav class="tabs">
      <button v-if="tabAllowed('grupos')" data-testid="tab-grupos" :class="{ active: tab === 'grupos' }" @click="goTab('grupos')">{{ t('tabs.groups') }}</button>
      <button v-if="tabAllowed('llaves')" data-testid="tab-llaves" :class="{ active: tab === 'llaves' }" @click="goTab('llaves')">{{ t('tabs.bracket') }}</button>
      <button
        v-if="tabAllowed('resultados')"
        data-testid="tab-resultados"
        :class="{ active: tab === 'resultados' }"
        @click="goTab('resultados')"
      >{{ t('tabs.results') }}</button>
      <button
        v-if="!isOfficial"
        data-testid="tab-puntajes"
        :class="{ active: tab === 'puntajes' }"
        @click="goTab('puntajes')"
      >{{ t('tabs.scores') }}</button>
    </nav>
    </template>

    <main class="content">
      <RoomsPage v-if="section === 'rooms'" :library="library" :official="officialEntry" @sealed="onRoomSealed" />
      <MatchdayPage
        v-else-if="section === 'fecha'"
        :entry="dailyEntry"
        :official="officialEntry"
        @save="onDailySave"
        @share="shareDaily"
        @reseal="onDailyReseal"
      />
      <template v-else>
      <section v-show="tab === 'grupos'" class="scrolly" data-testid="zone-grupos">
        <!-- Modo manual: tablas arrastrables (comportamiento clásico). -->
        <template v-if="pred.mode === 'manual'">
          <p class="tab-hint">
            {{ readonly ? t('groupsTab.hintReadonly') : t('groupsTab.hintDrag') }}
          </p>
          <div class="groups-grid">
            <GroupCard
              v-for="(g, i) in GROUPS"
              :key="g.letter"
              :pred="pred"
              :group="i"
              :letter="g.letter"
              :readonly="readonly"
            />
          </div>
          <ThirdsBlock v-if="pred.scope !== 'groups'" :pred="pred" :readonly="readonly" class="thirds-wrap" />
        </template>

        <!-- Modos winlose/score: tablas CALCULADAS en solo lectura. -->
        <template v-else>
          <p class="tab-hint">
            {{ t('groupsTab.hintCalc') }}
          </p>
          <div class="groups-grid">
            <StandingsTable
              v-for="(g, i) in GROUPS"
              :key="g.letter"
              :pred="pred"
              :group="i"
              :letter="g.letter"
            />
          </div>
        </template>
      </section>

      <section v-show="tab === 'resultados' && pred.mode !== 'manual'" class="scrolly" data-testid="zone-resultados">
        <ResultsTab
          :pred="pred"
          :readonly="readonly"
          :official="isOfficial ? null : officialEntry"
          :is-official="isOfficial"
          :is-admin="isOfficialAdmin"
          :official-status="officialStatus"
          :official-feed="officialFeed"
          :official-updated-at="officialUpdatedAt"
          :publish-status="publishStatus"
          @refresh-official="refreshOfficial(true)"
          @publish-official="publishOfficialResults"
        />
      </section>

      <section v-show="tab === 'llaves'" data-testid="zone-llaves">
        <BracketTab :pred="pred" :readonly="readonly || isOfficial" :official="isOfficial ? null : officialEntry" />
      </section>

      <section v-show="tab === 'puntajes'" class="scrolly" data-testid="zone-puntajes">
        <ScoresTab :entry="activeEntry" :official="officialEntry" />
      </section>
      </template>
    </main>

    <footer class="footer">
      <span class="eco">{{ t('footer.eco') }} <a href="https://dotrino.com" target="_blank" rel="noopener">Dotrino</a></span>
    </footer>

    <ShareModal
      :code="shareCode"
      :name="shareName"
      :preset-url="sharePreset"
      :preset-seal="shareSeal"
      :open="shareOpen"
      @close="shareOpen = false"
      @print="handlePrint"
      @pdf="downloadPdf"
      @sealed="onShareSealed"
    />

    <RoomShareModal />

    <!-- Popup diario del pronóstico de la fecha (partidos de HOY). -->
    <MatchdayPopup
      :open="dailyPopupOpen"
      :matches="dailyTodayMatches"
      :picks="dailyEntry?.results ?? {}"
      :sealing="dailySealing"
      :seal-result="dailySealResult"
      @save="onDailySave"
      @close="closeDailyPopup"
      @gosection="dailyPopupToSection"
    />

    <ScoringInfo :open="scoringOpen" @close="scoringOpen = false" />

    <IdentityPanel
      :open="identityOpen"
      :focus-pubkey="identityFocus"
      :focus-nick="identityFocusNick"
      :require-nick="nickPrompt"
      @close="onIdentityClose"
      @changed="onIdentityChanged"
    />

    <!-- Invitación a sala recibida en vivo (buzón). -->
    <div v-if="inviteToast" class="invite-toast" data-testid="invite-toast">
      <span class="it-msg">🏟 {{ t('rooms.inviteReceived', { who: inviteToast.nick || t('common.anonymous') }) }}</span>
      <div class="it-actions">
        <button class="it-ignore" @click="inviteToast = null">{{ t('common.close') }}</button>
        <button class="it-open" @click="acceptInvite">{{ t('rooms.openInvite') }}</button>
      </div>
    </div>

    <!-- Cambios sin aplicar al cambiar de sección: aplicar o ignorar. -->
    <div v-if="tabSwitch" class="overlay" @click.self="tabSwitch = null">
      <div class="warn-modal" data-testid="tabswitch-modal">
        <h3>⚠ {{ t('tabSwitch.title') }}</h3>
        <p>{{ t('tabSwitch.msg') }}</p>
        <div class="warn-actions">
          <button class="warn-cancel" data-testid="tabswitch-ignore" @click="ignoreAndGo">{{ t('tabSwitch.ignore') }}</button>
          <button class="warn-go" data-testid="tabswitch-apply" @click="applyAndGo">{{ t('tabSwitch.apply') }}</button>
        </div>
      </div>
    </div>

    <!-- Aviso de pronóstico incompleto al compartir/imprimir. -->
    <div v-if="warn" class="overlay" @click.self="warn = null">
      <div class="warn-modal" data-testid="warn-incomplete">
        <h3>⚠ {{ t('warn.title') }}</h3>
        <p>{{ t('warn.msg', { pct: warn.pct }) }}</p>
        <ul v-if="warn.missing.length" class="warn-list" data-testid="warn-missing">
          <li v-for="(item, i) in warn.missing" :key="i">{{ item }}</li>
          <li v-if="warn.more" class="warn-more">{{ t('warn.more', { n: warn.more }) }}</li>
        </ul>
        <div class="warn-actions">
          <button class="warn-cancel" @click="warn = null">{{ t('warn.cancel') }}</button>
          <button class="warn-go" @click="confirmWarn">{{ t('warn.continue') }}</button>
        </div>
      </div>
    </div>

    <!-- Selector de tipo (Nuevo / Clonar), en DOS pasos: 1) modo, 2) alcance. -->
    <div v-if="typePicker" class="overlay" @click.self="typePicker = null">
      <div class="type-modal" data-testid="type-picker">
        <button class="x" @click="typePicker = null" :aria-label="t('common.close')">×</button>

        <!-- Paso 1: MODO (Simple / Medio / Completo). -->
        <template v-if="!typePicker.mode">
          <h3>{{ typePicker.action === 'new' ? t('typePicker.newTitle') : t('typePicker.cloneTitle') }}</h3>
          <p class="step-hint">{{ t('typePicker.step1') }}</p>
          <button class="type-opt" data-testid="type-manual" @click="pickMode('manual')">
            <strong>{{ t('modes.simple') }}</strong><span>{{ t('typePicker.simpleDesc') }}</span>
          </button>
          <button class="type-opt" data-testid="type-winlose" @click="pickMode('winlose')">
            <strong>{{ t('modes.medium') }}</strong><span>{{ t('typePicker.mediumDesc') }}</span>
          </button>
          <button class="type-opt" data-testid="type-score" @click="pickMode('score')">
            <strong>{{ t('modes.full') }}</strong><span>{{ t('typePicker.fullDesc') }}</span>
          </button>
        </template>

        <!-- Paso 2: ALCANCE (Todo / Grupos / Llaves). -->
        <template v-else>
          <h3>{{ t('typePicker.step2Title') }}</h3>
          <p class="step-hint">
            {{ t('typePicker.step2', { mode: modeName(typePicker.mode) }) }}
            <button class="step-back" data-testid="type-back" @click="pickerBack()">‹ {{ t('typePicker.back') }}</button>
          </p>
          <button
            v-for="s in SCOPE_OPTIONS"
            :key="s"
            class="type-opt"
            :class="{ 'type-opt-disabled': scopeDisabled(s) }"
            :data-testid="'scope-' + s"
            :disabled="scopeDisabled(s)"
            @click="pickScope(s)"
          >
            <strong>{{ scopeName(s) }}</strong>
            <span>{{ s === 'groups' ? t('scopes.groupsDesc') : s === 'bracket' ? t('scopes.bracketDesc') : t('scopes.allDesc') }}</span>
            <span v-if="scopeDisabled(s)" class="type-opt-soon">{{ t('scopes.bracketSoon') }}</span>
          </button>
        </template>
      </div>
    </div>

    <div v-if="importOpen" class="overlay" @click.self="importOpen = false">
      <div class="import-modal" data-testid="import-modal">
        <button class="x" @click="importOpen = false" :aria-label="t('common.close')">×</button>
        <h3>{{ t('import.title') }}</h3>
        <p class="imp-help">{{ t('import.help', { hash: '#' }) }}</p>
        <textarea
          v-model="importText"
          rows="3"
          :placeholder="t('import.placeholder')"
          @keydown.stop
        ></textarea>
        <p v-if="importError" class="imp-err">{{ importError }}</p>
        <button class="imp-go" :disabled="importing || !importText.trim()" @click="doImport">
          {{ importing ? t('import.verifying') : t('import.go') }}
        </button>
      </div>
    </div>
    </div>
  </div>

  <!-- Hoja de impresión / captura. Durante la captura de PDF la posicionamos
       fuera de pantalla (el usuario no la ve) para rasterizarla con html2canvas. -->
  <div
    ref="printView"
    :class="{ 'print-host': true, capturing: pdfCapturing }"
  >
    <PrintView
      v-if="printPred"
      :pred="printPred"
      :title="printTitle"
      :author="printAuthor"
      :qr-data-url="printQr"
      :capture="pdfCapturing"
    />
  </div>
</template>

<style scoped>
/* Contenedor de la hoja de impresión/captura. En captura lo sacamos de la
   vista (fuera de pantalla) para que html2canvas lea la hoja sin mostrarla. */
.print-host.capturing {
  position: fixed; left: -10000px; top: 0; z-index: -1;
}

.shell { width: 100%; max-width: 100%; margin: 0; min-height: 100vh; }
.main { display: flex; flex-direction: column; min-height: 100vh; min-width: 0; }

/* En escritorio: layout tipo "app-shell". La barra lateral ocupa el 100% del
   alto del viewport y la página no scrollea; es el área de contenido la que
   maneja (si hace falta) su propio scroll interno. */
@media (min-width: 960px) {
  /* App-shell: la barra lateral ocupa todo el alto y NO scrollea la página.
     El área de contenido tiene su PROPIO scroll, así nada se recorta y la
     barra lateral siempre llega al fondo. */
  .shell { display: flex; align-items: stretch; height: 100vh; overflow: hidden; }
  .main { flex: 1; height: 100vh; min-height: 0; display: flex; flex-direction: column; }
  .menu { display: none; }
  /* En web el chevron vive en el sidebar (junto a "Pronósticos"), no en el header. */
  .cc-back-sc { display: none; }
  .scoreboard { padding-left: 1.2rem; }

  /* El contenido scrollea internamente (grupos+terceros o llaves completas). */
  .content { flex: 1; min-height: 0; overflow-y: auto; }
  .footer { flex-shrink: 0; }
}

/* XL: en pantallas muy anchas acolchamos el contenido a los lados para que el
   ancho útil quede parecido al de "lg" (no se estira de borde a borde). */
@media (min-width: 1400px) {
  .content { padding-inline: clamp(1rem, calc((100% - 1100px) / 2), 16rem); }
  .active-bar { padding-inline: clamp(1rem, calc((100% - 1100px) / 2), 16rem); }
}

.hdr-right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
/* Selector de idioma compacto (ES | EN) */
.lang-selector {
  display: inline-flex; border: 1px solid var(--line); border-radius: 8px;
  overflow: hidden; background: rgba(65, 180, 255, 0.08);
}
.lang-selector button {
  background: transparent; color: var(--muted); border: none; cursor: pointer;
  font-family: inherit; font-weight: 800; font-size: 0.72rem; letter-spacing: 0.04em;
  padding: 0.35rem 0.5rem; line-height: 1;
}
.lang-selector button:hover { background: rgba(65, 180, 255, 0.16); color: var(--text); }
.lang-selector button.on { background: var(--azure); color: #042038; }
.identity-btn {
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 42px; height: 42px; border-radius: 50%; font-size: 1.2rem; cursor: pointer;
  background: rgba(65, 180, 255, 0.12); color: var(--text); border: 1px solid var(--line);
}
.identity-btn:hover { background: rgba(65, 180, 255, 0.22); }
/* Botón "Instalar App" en el flujo de la barra, centrado (no flota, no tapa). */
/* Botón "Instalar App" (Web Component <dotrino-install>): reusa el look del
   antiguo .install-inline vía custom properties + ::part(button). */
.cc-install {
  margin-left: auto; flex-shrink: 0;
  --cc-install-color: #042038;
  --cc-install-bg-hover: var(--azure);
  --cc-install-radius: 50px;
  --cc-install-font-size: 0.82rem;
  --cc-install-gap: 6px;
  --cc-install-icon: 15px;
  --cc-install-accent: var(--azure);
}
.cc-install::part(button) {
  background: var(--azure); color: #042038; border: none;
  padding: 0.28rem 0.85rem; font-weight: 800; white-space: nowrap;
}
.cc-install::part(button):hover { filter: brightness(1.06); }

/* Scoreboard header */
.scoreboard {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.7rem 0.9rem; position: sticky; top: 0; z-index: 50;
  background: linear-gradient(180deg, rgba(16, 42, 82, 0.96), rgba(10, 23, 48, 0.96));
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.cc-back { color: var(--text, #fff); --cc-back-size: 40px; flex-shrink: 0; }
.menu {
  background: rgba(65, 180, 255, 0.12); color: var(--text);
  border: 1px solid var(--line); border-radius: 10px; cursor: pointer;
  width: 42px; height: 42px; font-size: 1.3rem; flex-shrink: 0;
}
.menu:hover { background: rgba(65, 180, 255, 0.22); }
.brand-logo { width: 38px; height: 38px; flex-shrink: 0; object-fit: contain; }
.title { flex: 1; text-align: center; line-height: 1; }
.cup { font-size: 0.6rem; letter-spacing: 0.28em; color: var(--azure); font-weight: 700; text-transform: uppercase; }
.title h1 { font-size: 1.5rem; margin-top: 2px; }
.title h1 em { color: var(--azure); font-style: normal; }

.active-bar {
  position: relative;
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 1rem; font-size: 0.85rem;
  background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid var(--line-soft);
}
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--azure); box-shadow: 0 0 8px var(--azure); }
.dot.ro { background: var(--gold); box-shadow: 0 0 8px var(--gold); }
.active-name {
  font-weight: 700; background: none; border: none; color: var(--text);
  font-size: 0.85rem; cursor: default; padding: 0.1rem 0.2rem; border-radius: 6px;
  display: inline-flex; align-items: center; gap: 0.35rem; font-family: inherit;
}
.active-name.editable { cursor: pointer; }
.active-name.editable:hover { background: rgba(255, 255, 255, 0.06); }
.active-name .pen { color: var(--azure); font-size: 0.75rem; opacity: 0.7; }
.name-input {
  background: var(--bg); border: 1px solid var(--azure); border-radius: 6px;
  color: var(--text); font-size: 0.85rem; font-weight: 700; padding: 0.2rem 0.45rem;
  font-family: inherit; max-width: 220px;
}
.ro-badge { color: var(--muted); font-size: 0.78rem; }
.mini { background: none; border: 1px solid var(--line); color: var(--azure); border-radius: 6px; padding: 0.05rem 0.4rem; margin-left: 0.3rem; cursor: pointer; font-size: 0.72rem; }
.champ-chip { margin-left: auto; color: var(--gold); font-weight: 700; }
/* Acciones-ícono del pronóstico activo, alineadas a la derecha (coherente con .tools del Sidebar). */
.bar-actions { display: flex; align-items: center; gap: 0.15rem; margin-left: auto; flex-shrink: 0; }
.bar-actions button {
  background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 0.85rem; line-height: 1; padding: 0.2rem 0.35rem; border-radius: 5px;
  font-family: inherit; display: inline-flex; align-items: center; justify-content: center;
}
.bar-actions svg { display: block; }
.bar-actions .pdf-img { display: block; width: 15px; height: 18px; }
.bar-actions button:hover { background: rgba(255, 255, 255, 0.1); color: var(--text); }

/* En táctil (mobile) los íconos de acción son difíciles de tocar: agrandamos el
   área de toque (~44px) y los íconos. En escritorio (mouse) quedan como están. */
@media (hover: none) and (pointer: coarse) {
  .bar-actions { gap: 0.3rem; }
  .bar-actions button { padding: 0.55rem; min-width: 44px; min-height: 44px; }
  .bar-actions svg { width: 22px; height: 22px; }
  .bar-actions .pdf-img { width: 19px; height: 23px; }
  .mini { padding: 0.45rem 0.7rem; font-size: 0.8rem; }
}
.bar-actions .share-i { color: var(--azure); }
.bar-actions .share-i:hover { background: rgba(65, 180, 255, 0.18); color: var(--azure); }
.bar-actions .danger-i:hover { background: rgba(255, 80, 80, 0.18); color: #ff8585; }

/* Selector de modo de juego */
.mode-bar {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
  padding: 0.5rem 1rem; border-bottom: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.015);
}
.mode-label { color: var(--muted); font-size: 0.8rem; font-weight: 700; }
.scope-label { padding-left: 0.6rem; border-left: 1px solid var(--line); }
.mode-cur { color: var(--azure); }
.mode-clone {
  margin-left: auto; background: transparent; color: var(--azure);
  border: 1px solid var(--line); border-radius: 50px; padding: 0.3rem 0.8rem;
  cursor: pointer; font-family: inherit; font-weight: 700; font-size: 0.78rem;
}
.mode-clone:hover { background: rgba(65, 180, 255, 0.14); }

/* Modal selector de tipo (Nuevo / Clonar) */
.type-modal {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 1.4rem; max-width: 360px; width: 100%; position: relative; box-shadow: var(--shadow);
}
.type-modal h3 { color: var(--azure); margin-bottom: 0.5rem; }
.step-hint {
  color: var(--muted); font-size: 0.78rem; margin-bottom: 0.8rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
}
.step-back {
  background: none; border: 1px solid var(--line); color: var(--azure); border-radius: 6px;
  padding: 0.1rem 0.5rem; cursor: pointer; font-family: inherit; font-weight: 700;
  font-size: 0.72rem; white-space: nowrap; flex-shrink: 0;
}
.step-back:hover { background: rgba(65, 180, 255, 0.12); }
.type-opt {
  display: flex; flex-direction: column; gap: 0.15rem; width: 100%; text-align: left;
  background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
  padding: 0.7rem 0.85rem; margin-bottom: 0.5rem; cursor: pointer; color: var(--text);
}
.type-opt:hover { border-color: var(--azure); background: var(--panel-2); }
.type-opt strong { color: var(--azure); }
.type-opt span { color: var(--muted); font-size: 0.78rem; }
/* Alcance aún no habilitado: visible pero apagado y no seleccionable. */
.type-opt-disabled { cursor: not-allowed; opacity: 0.55; }
.type-opt-disabled:hover { border-color: var(--line); background: var(--bg); }
.type-opt-disabled strong { color: var(--muted); }
.type-opt-soon {
  margin-top: 0.2rem; font-weight: 600; color: var(--azure) !important;
  font-size: 0.74rem !important;
}
.type-modal .x {
  position: absolute; top: 0.5rem; right: 0.7rem; background: none; border: none;
  color: var(--muted); font-size: 1.5rem; cursor: pointer; line-height: 1;
}

/* Aviso de incompleto */
.warn-modal {
  background: var(--panel); border: 1px solid var(--gold); border-radius: 16px;
  padding: 1.4rem; max-width: 360px; width: 100%; box-shadow: var(--shadow);
}
.warn-modal h3 { color: var(--gold); margin-bottom: 0.6rem; }
.warn-modal p { font-size: 0.88rem; color: var(--text); margin-bottom: 0.7rem; }
.warn-list {
  list-style: none; margin: 0 0 1rem; padding: 0.55rem 0.7rem;
  background: rgba(255, 207, 63, 0.08); border: 1px solid var(--line); border-radius: 10px;
  font-size: 0.84rem; color: var(--text); max-height: 9.5rem; overflow-y: auto;
}
.warn-list li { padding: 0.18rem 0; font-variant-numeric: tabular-nums; }
.warn-list li + li { border-top: 1px solid rgba(255, 255, 255, 0.05); }
.warn-list .warn-more { color: var(--muted); font-style: italic; }
.warn-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.warn-cancel {
  background: transparent; color: var(--muted); border: 1px solid var(--line);
  border-radius: 8px; padding: 0.5rem 1rem; cursor: pointer; font-weight: 700;
}
.warn-go {
  background: var(--gold); color: #3a2e00; border: none; border-radius: 8px;
  padding: 0.5rem 1rem; cursor: pointer; font-weight: 800;
}

/* Franja de confirmación de cambios pendientes */
.confirm-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 0.7rem;
  flex-wrap: wrap; padding: 0.6rem 1rem;
  background: linear-gradient(90deg, rgba(255, 207, 63, 0.16), rgba(255, 207, 63, 0.06));
  border-bottom: 1px solid var(--gold);
}
.confirm-msg { color: var(--gold); font-size: 0.82rem; font-weight: 700; }
.confirm-btn {
  background: var(--gold); color: #2a1d00; border: none; border-radius: 50px;
  padding: 0.5rem 1.1rem; font-weight: 800; cursor: pointer; font-family: inherit;
  font-size: 0.85rem; white-space: nowrap; box-shadow: 0 4px 16px rgba(255, 207, 63, 0.35);
}
.confirm-btn:hover { filter: brightness(1.06); }
.confirm-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.cancel-btn {
  background: transparent; color: var(--gold); border: 1px solid var(--gold); border-radius: 50px;
  padding: 0.5rem 1rem; font-weight: 700; cursor: pointer; font-family: inherit;
  font-size: 0.85rem; white-space: nowrap;
}
.cancel-btn:hover { background: rgba(255, 207, 63, 0.12); }

/* Franja de sellado del pronóstico (certificar fecha / cancelar edición) */
.seal-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 0.7rem;
  flex-wrap: wrap; padding: 0.45rem 1rem;
  border-bottom: 1px solid var(--line);
}
.seal-bar.sealed { background: rgba(46, 204, 113, 0.07); border-bottom-color: rgba(46, 204, 113, 0.45); }
.seal-bar.stale {
  background: linear-gradient(90deg, rgba(255, 207, 63, 0.14), rgba(255, 207, 63, 0.05));
  border-bottom-color: var(--gold);
}
.seal-msg { color: var(--muted); font-size: 0.8rem; font-weight: 700; }
.seal-bar.sealed .seal-msg { color: var(--green); }
.seal-bar.stale .seal-msg { color: var(--gold); }
.seal-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.seal-btn {
  background: var(--azure); color: #042038; border: none; border-radius: 50px;
  padding: 0.42rem 1rem; font-weight: 800; cursor: pointer; font-family: inherit;
  font-size: 0.82rem; white-space: nowrap;
}
.seal-btn:hover { filter: brightness(1.06); }
.seal-btn:disabled { opacity: 0.55; cursor: default; }
.seal-cancel {
  background: transparent; color: var(--gold); border: 1px solid var(--gold); border-radius: 50px;
  padding: 0.42rem 0.9rem; font-weight: 700; cursor: pointer; font-family: inherit;
  font-size: 0.82rem; white-space: nowrap;
}
.seal-cancel:hover { background: rgba(255, 207, 63, 0.12); }
.seal-err { color: #ff6b6b; font-size: 0.78rem; flex-basis: 100%; }

.tabs { display: flex; gap: 0.4rem; padding: 0.8rem 1rem 0; }
.tabs button {
  flex: 1; max-width: 240px; background: transparent; color: var(--muted);
  border: 1px solid var(--line); border-bottom: none;
  padding: 0.7rem; border-radius: 10px 10px 0 0; cursor: pointer; font-weight: 700;
  font-family: var(--font-display); letter-spacing: 0.02em; font-size: 0.76rem;
}
.tabs button.active { background: var(--panel); color: var(--text); border-color: var(--azure); box-shadow: 0 -2px 12px rgba(65,180,255,0.15); }

.content { flex: 1; padding: 1rem; }
.tab-hint { color: var(--muted); font-size: 0.83rem; margin-bottom: 0.9rem; text-align: center; }

.groups-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.85rem; }
.thirds-wrap { display: block; margin-top: 1.2rem; max-width: 520px; }

.footer { display: flex; justify-content: center; padding: 1.5rem 1rem; color: var(--muted); font-size: 0.82rem; }

/* Import modal */
.overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
  display: flex; align-items: center; justify-content: center; z-index: 300; padding: 1rem;
}
.import-modal {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 1.4rem; max-width: 380px; width: 100%; position: relative; box-shadow: var(--shadow);
}
.import-modal .x { position: absolute; top: 0.5rem; right: 0.7rem; background: none; border: none; color: var(--muted); font-size: 1.5rem; cursor: pointer; }
.import-modal h3 { color: var(--azure); margin-bottom: 0.4rem; }
.imp-help { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.7rem; }
.import-modal textarea {
  width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
  color: var(--text); padding: 0.6rem; font-size: 0.85rem; resize: vertical; font-family: monospace;
}
.imp-err { color: #ff6b6b; font-size: 0.8rem; margin-top: 0.5rem; }
.imp-go {
  margin-top: 0.8rem; width: 100%; background: var(--azure); color: #042038; border: none;
  border-radius: 10px; padding: 0.7rem; font-weight: 800; cursor: pointer;
}
.imp-go:disabled { opacity: 0.5; cursor: default; }

/* Barra activa de SALA */
.rooms-bar .active-name { font-weight: 800; color: var(--text); }
.room-status {
  font-size: 0.72rem; font-weight: 700; border: 1px solid var(--line);
  border-radius: 6px; padding: 0.1rem 0.45rem; color: var(--muted);
}
.room-status.online { color: var(--green); border-color: var(--green); }
/* Un único margin-left:auto (en el grupo de acciones) empuja acciones + "volver"
   a la derecha; "volver" queda al borde, a la derecha del botón de compartir.
   (Dos autos repartirían el espacio y dejarían "volver" al centro.) */
.rooms-bar .bar-actions { margin-left: auto; }

/* Toast de invitación a sala (buzón en vivo) */
.invite-toast {
  position: fixed; left: 50%; bottom: 1.2rem; transform: translateX(-50%);
  z-index: 500; background: var(--panel); border: 1px solid var(--azure);
  border-radius: 12px; padding: 0.8rem 1rem; box-shadow: var(--shadow);
  display: flex; align-items: center; gap: 0.9rem; max-width: 92vw;
}
.invite-toast .it-msg { font-size: 0.85rem; font-weight: 700; }
.invite-toast .it-actions { display: flex; gap: 0.4rem; }
.invite-toast .it-open {
  background: var(--azure); color: #042038; border: none; border-radius: 8px;
  padding: 0.4rem 0.8rem; font-weight: 800; cursor: pointer;
}
.invite-toast .it-ignore {
  background: transparent; color: var(--muted); border: 1px solid var(--line);
  border-radius: 8px; padding: 0.4rem 0.7rem; cursor: pointer;
}

@media (max-width: 480px) {
  .title h1 { font-size: 1.25rem; }
  .cup { letter-spacing: 0.2em; }
}
</style>
