<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SavedPrediction } from '../lib/store'
import { scoreEntry } from '../lib/scoring'
import { decodePrediction } from '../lib/codec'
import { completeness } from '../lib/prediction'
import { useRooms } from '../composables/useRooms'

const { t } = useI18n()

// Estado compartido de salas (para listar/seleccionar la sala activa).
const { rooms, activeRoomId, openRoom, shareRoom, closeRoom, leaveRoom } = useRooms()

// Etiqueta corta del tipo (modo) del pronóstico. Si el entry no lo guarda
// (importados), se lee del código.
function modeLabel (p: SavedPrediction): string {
  let m = p.mode
  if (!m) { try { m = decodePrediction(p.code).mode } catch { m = 'manual' } }
  return m === 'winlose' ? t('modes.medium') : m === 'score' ? t('modes.full') : t('modes.simple')
}

// Etiqueta del alcance (scope); vacía para 'all' (no se muestra chip).
function scopeTag (p: SavedPrediction): string {
  let s = p.scope
  if (!s) { try { s = decodePrediction(p.code).scope } catch { s = 'all' } }
  return s === 'groups' ? t('scopes.groups') : s === 'bracket' ? t('scopes.bracket') : ''
}

// % de llenado del pronóstico (para el chip de progreso).
function fillPct (p: SavedPrediction): number {
  try {
    const pred = decodePrediction(p.code)
    if (p.mode) pred.mode = p.mode
    if (p.results) pred.results = p.results
    return completeness(pred).pct
  } catch { return 0 }
}

const props = defineProps<{
  open: boolean
  library: SavedPrediction[]
  activeId: string | null
  section: 'predictions' | 'rooms' | 'fecha'
}>()
const emit = defineEmits<{
  close: []
  select: [id: string]
  create: []
  import: []
  remove: [id: string]
  rename: [id: string]
  copy: [id: string]
  clonetype: [id: string]
  share: [id: string]
  print: [id: string]
  pdf: [id: string]
  scoring: []
  setsection: [s: 'predictions' | 'rooms' | 'fecha']
  openresults: []
  sharedaily: []
}>()

function modeTag (m: string): string {
  return m === 'free' ? t('rooms.modeFree') : m === 'winlose' ? t('modes.medium') : m === 'score' ? t('modes.full') : t('modes.simple')
}
// Etiqueta de alcance de una sala; vacía para 'free'/ausente (no se muestra chip).
function roomScopeTag (s?: string): string {
  if (!s || s === 'free') return ''
  return s === 'groups' ? t('scopes.groups') : s === 'bracket' ? t('scopes.bracket') : t('scopes.all')
}
function selectRoom (id: string) { openRoom(id); emit('close') }
function onShareRoom (id: string) { shareRoom(id); emit('close') }
function newRoom () { closeRoom(); emit('close') }
function onLeaveRoom (id: string, name: string) {
  if (confirm(t('rooms.confirmLeave', { name }))) leaveRoom(id)
}
const sortedRooms = computed(() => [...rooms.value].sort((a, b) => b.updatedAt - a.updatedAt))

// La entrada DIARIA (pronóstico de la fecha) tiene su propia sección: no se
// lista entre los pronósticos clásicos.
const mine = computed(() => props.library.filter((p) => p.mine && !p.official && !p.daily).sort((a, b) => b.updatedAt - a.updatedAt))
const daily = computed(() => props.library.find((p) => p.daily) ?? null)
const imported = computed(() => props.library.filter((p) => !p.mine).sort((a, b) => b.updatedAt - a.updatedAt))
// Resultados REALES/oficiales: entradas marcadas con `official`.
const official = computed(() => props.library.filter((p) => p.official).sort((a, b) => b.updatedAt - a.updatedAt))

// Entrada oficial (base de comparación) y mapa id→puntaje total.
const officialEntry = computed<SavedPrediction | null>(() => props.library.find((p) => p.official) ?? null)
const scores = computed<Record<string, number>>(() => {
  const o = officialEntry.value
  const map: Record<string, number> = {}
  if (!o) return map
  for (const p of props.library) {
    if (p.official || p.daily) continue // la diaria puntúa con su propia regla (sección La fecha)
    map[p.id] = scoreEntry(p, o).total
  }
  return map
})
</script>

<template>
  <div class="drawer-root" :class="{ open }">
    <div class="scrim" @click="emit('close')"></div>
    <aside class="drawer">
      <header class="dh">
        <!-- En web el chevron de volver vive aquí, junto al título "Pronósticos".
             En móvil el sidebar es un cajón, así que el chevron va en el header
             (App.vue) y este se oculta. -->
        <dotrino-back class="cc-back-sb"></dotrino-back>
        <span>{{ section === 'rooms' ? t('rooms.title') : section === 'fecha' ? t('daily.title') : t('sidebar.title') }}</span>
        <button class="x" @click="emit('close')" :aria-label="t('common.close')">×</button>
      </header>

      <!-- Conmutador de sección: Pronósticos / Salas -->
      <nav class="section-tabs" data-testid="sb-sections">
        <button :class="{ on: section === 'predictions' }" data-testid="sb-tab-predictions" @click="emit('setsection', 'predictions')">📋 {{ t('sidebar.tabPredictions') }}</button>
        <button :class="{ on: section === 'fecha' }" data-testid="sb-tab-fecha" @click="emit('setsection', 'fecha')">📅 {{ t('sidebar.tabDaily') }}</button>
        <button :class="{ on: section === 'rooms' }" data-testid="sb-tab-rooms" @click="emit('setsection', 'rooms')">🏟 {{ t('sidebar.tabRooms') }}</button>
      </nav>

      <!-- ===== SECCIÓN PRONÓSTICOS ===== -->
      <template v-if="section === 'predictions'">
      <div class="actions">
        <button class="act new" data-testid="sb-new" @click="emit('create')">{{ t('sidebar.new') }}</button>
        <button class="act imp" data-testid="sb-import" @click="emit('import')">{{ t('sidebar.import') }}</button>
      </div>

      <button class="scoring-btn" data-testid="sb-scoring" @click="emit('scoring')">{{ t('sidebar.scoring') }}</button>

      <section class="group" data-testid="sb-section-mine">
        <h4>{{ t('sidebar.mine') }}</h4>
        <p v-if="!mine.length" class="empty">{{ t('sidebar.emptyMine') }}</p>
        <div
          v-for="p in mine"
          :key="p.id"
          class="item"
          data-testid="pred-item"
          :data-id="p.id"
          :class="{ active: p.id === activeId }"
          @click="emit('select', p.id)"
        >
          <span class="nm">
            <span class="nm-row">{{ p.name }} <small class="mode-tag">{{ modeLabel(p) }}</small> <small v-if="scopeTag(p)" class="scope-tag">{{ scopeTag(p) }}</small> <small class="fill-tag" :class="{ full: fillPct(p) >= 100 }">{{ fillPct(p) }}%</small></span>
            <span v-if="officialEntry" class="score-chip" :title="t('sidebar.pointsTitle')">▦ {{ t('sidebar.points', { n: scores[p.id] ?? 0 }) }}</span>
          </span>
          <span class="tools">
            <button class="share-i" :title="t('common.share')" @click.stop="emit('share', p.id)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
              </svg>
            </button>
            <button :title="t('common.print')" @click.stop="emit('print', p.id)">🖨</button>
            <button class="pdf-i" :title="t('common.pdf')" @click.stop="emit('pdf', p.id)">
              <img src="/pdf.svg" alt="PDF" class="pdf-img" />
            </button>
            <button :title="t('modes.cloneToType')" @click.stop="emit('clonetype', p.id)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
              </svg>
            </button>
            <button :title="t('common.rename')" @click.stop="emit('rename', p.id)">✎</button>
            <button :title="t('common.delete')" @click.stop="emit('remove', p.id)">🗑</button>
          </span>
        </div>
      </section>

      <section class="group" data-testid="sb-section-imported">
        <h4>{{ t('sidebar.friends') }}</h4>
        <p v-if="!imported.length" class="empty">{{ t('sidebar.emptyFriends') }}</p>
        <div
          v-for="p in imported"
          :key="p.id"
          class="item"
          data-testid="pred-item"
          :data-id="p.id"
          :class="{ active: p.id === activeId }"
          @click="emit('select', p.id)"
        >
          <span class="nm">
            <span class="nm-row">{{ p.name }} <small class="mode-tag">{{ modeLabel(p) }}</small> <small v-if="scopeTag(p)" class="scope-tag">{{ scopeTag(p) }}</small> <small class="fill-tag" :class="{ full: fillPct(p) >= 100 }">{{ fillPct(p) }}%</small></span>
            <small class="auth" :class="{ ok: p.author?.verified }">
              {{ p.author?.verified ? '✓' : '⚠' }} {{ p.author?.nickname || t('common.anonymous') }}
            </small>
            <span v-if="officialEntry" class="score-chip" :title="t('sidebar.pointsTitle')">▦ {{ t('sidebar.points', { n: scores[p.id] ?? 0 }) }}</span>
          </span>
          <span class="tools">
            <button class="share-i" :title="t('common.share')" @click.stop="emit('share', p.id)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
              </svg>
            </button>
            <button :title="t('common.print')" @click.stop="emit('print', p.id)">🖨</button>
            <button class="pdf-i" :title="t('common.pdf')" @click.stop="emit('pdf', p.id)">
              <img src="/pdf.svg" alt="PDF" class="pdf-img" />
            </button>
            <button :title="t('modes.cloneToType')" @click.stop="emit('clonetype', p.id)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
              </svg>
            </button>
            <button :title="t('common.delete')" @click.stop="emit('remove', p.id)">🗑</button>
          </span>
        </div>
      </section>

      <section class="group" data-testid="sb-section-official">
        <h4>{{ t('sidebar.results') }}</h4>
        <p v-if="!official.length" class="empty">{{ t('sidebar.emptyOfficial') }}</p>
        <div
          v-for="p in official"
          :key="p.id"
          class="item"
          data-testid="pred-item"
          :data-id="p.id"
          :class="{ active: p.id === activeId }"
          @click="emit('select', p.id)"
        >
          <span class="nm">{{ p.name }}</span>
          <!-- No se elimina ni renombra; solo compartir/imprimir. -->
          <span class="tools">
            <button class="share-i" :title="t('common.share')" @click.stop="emit('share', p.id)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
              </svg>
            </button>
            <button :title="t('common.print')" @click.stop="emit('print', p.id)">🖨</button>
            <button class="pdf-i" :title="t('common.pdf')" @click.stop="emit('pdf', p.id)">
              <img src="/pdf.svg" alt="PDF" class="pdf-img" />
            </button>
          </span>
        </div>
      </section>
      </template>

      <!-- ===== SECCIÓN LA FECHA (pronóstico diario, único por cuenta) ===== -->
      <template v-else-if="section === 'fecha'">
        <section class="group" data-testid="sb-section-daily">
          <h4>{{ t('daily.title') }}</h4>
          <p class="daily-hint">{{ t('daily.sidebarHint') }}</p>
          <div v-if="daily" class="item" data-testid="daily-item" @click="emit('close')">
            <span class="nm"><span class="nm-row">📅 {{ daily.name }}</span></span>
            <span class="tools">
              <button class="share-i" :title="t('common.share')" @click.stop="emit('sharedaily')">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
                </svg>
              </button>
            </span>
          </div>
        </section>
      </template>

      <!-- ===== SECCIÓN SALAS ===== -->
      <template v-else>
        <div class="actions">
          <button class="act new" data-testid="sb-new-room" @click="newRoom">➕ {{ t('rooms.create') }}</button>
        </div>
        <button class="scoring-btn" data-testid="sb-room-results" @click="emit('openresults')">▦ {{ t('rooms.simulateResults') }}</button>
        <section class="group" data-testid="sb-section-rooms">
          <h4>{{ t('rooms.mine') }}</h4>
          <p v-if="!sortedRooms.length" class="empty">{{ t('rooms.emptyRooms') }}</p>
          <div
            v-for="r in sortedRooms"
            :key="r.id"
            class="item"
            data-testid="room-item"
            :data-id="r.id"
            :class="{ active: r.id === activeRoomId }"
            @click="selectRoom(r.id)"
          >
            <span class="nm">
              <span class="nm-row">{{ r.name }}</span>
              <span class="room-meta">
                <small v-if="r.daily" class="mode-tag">📅 {{ t('rooms.dailyTag') }}</small>
                <template v-else>
                  <small class="mode-tag">{{ modeTag(r.mode) }}</small>
                  <small v-if="roomScopeTag(r.scope)" class="scope-tag">{{ roomScopeTag(r.scope) }}</small>
                </template>
                <small class="fill-tag">👥 {{ r.members.length }}</small>
                <small v-if="r.sealedUntil > Date.now()" class="seal-tag">🔒</small>
                <small v-if="r.mine" class="host-tag">{{ t('rooms.host') }}</small>
              </span>
            </span>
            <span class="tools">
              <button class="share-i" :title="t('common.share')" @click.stop="onShareRoom(r.id)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /><path d="m21 3-9 9" /><path d="M15 3h6v6" /></g>
                </svg>
              </button>
              <button :title="t('rooms.leave')" @click.stop="onLeaveRoom(r.id, r.name)">🗑</button>
            </span>
          </div>
        </section>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.drawer-root { position: fixed; inset: 0; z-index: 200; pointer-events: none; }
.drawer-root.open { pointer-events: auto; }
.scrim {
  position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5);
  opacity: 0; transition: opacity 0.25s;
}
.drawer-root.open .scrim { opacity: 1; }
.drawer {
  position: absolute; top: 0; left: 0; height: 100%; width: 290px; max-width: 85vw;
  background: var(--bg-2); border-right: 1px solid var(--line);
  transform: translateX(-100%); transition: transform 0.25s ease;
  display: flex; flex-direction: column; box-shadow: var(--shadow);
}
.drawer-root.open .drawer { transform: translateX(0); }
.dh {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem; font-weight: 700; background: var(--green-d);
}
.x { background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer; line-height: 1; }
.actions { display: flex; gap: 0.5rem; padding: 0.8rem; }
.act { flex: 1; border: none; border-radius: 8px; padding: 0.6rem; font-weight: 700; cursor: pointer; }
.act.new { background: var(--green); color: #04210f; }
.act.imp { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); }
.group { padding: 0.4rem 0.8rem; overflow-y: auto; }
.group h4 { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0.6rem 0 0.4rem; }
.empty { color: var(--muted); font-size: 0.8rem; font-style: italic; padding: 0.3rem 0; }
.item {
  display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;
  padding: 0.55rem 0.6rem; border-radius: 8px; cursor: pointer; margin-bottom: 0.3rem;
  background: var(--panel); border: 1px solid transparent;
}
.item:hover { background: var(--panel-2); }
.item.active { border-color: var(--green); background: var(--panel-2); }
.scoring-btn {
  margin: 0 0.8rem 0.2rem; padding: 0.5rem; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--azure); border: 1px solid var(--azure);
  font-weight: 700; font-size: 0.82rem;
}
.scoring-btn:hover { background: rgba(65, 180, 255, 0.12); }

/* Conmutador de sección Pronósticos / Salas */
.section-tabs { display: flex; gap: 0.3rem; padding: 0.7rem 0.8rem 0.3rem; }
.section-tabs button {
  flex: 1; background: transparent; border: 1px solid var(--line); color: var(--muted);
  padding: 0.5rem; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 0.8rem;
}
.section-tabs button.on { background: var(--green); color: #04210f; border-color: var(--green); }

.daily-hint { color: var(--muted); font-size: 0.76rem; margin-bottom: 0.5rem; }

.room-meta { display: inline-flex; gap: 0.3rem; align-items: center; margin-top: 0.2rem; flex-wrap: wrap; }
.seal-tag { font-size: 0.62rem; }
.host-tag {
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: var(--green);
  border: 1px solid var(--green); border-radius: 5px; padding: 0 0.25rem;
}
.nm { display: flex; flex-direction: column; align-items: flex-start; font-size: 0.9rem; min-width: 0; }
.nm-row { display: inline-flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
.mode-tag {
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--azure); border: 1px solid var(--line); border-radius: 5px; padding: 0 0.25rem;
}
.scope-tag {
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--green); border: 1px solid var(--line); border-radius: 5px; padding: 0 0.25rem;
}
.fill-tag { font-size: 0.62rem; font-weight: 700; color: var(--muted); }
.fill-tag.full { color: var(--green); }
.score-chip {
  margin-top: 0.2rem; align-self: flex-start; background: var(--azure); color: #04210f;
  font-weight: 800; font-size: 0.7rem; border-radius: 6px; padding: 0.05rem 0.4rem; white-space: nowrap;
}
.nm .auth { font-size: 0.68rem; color: #e0a; }
.nm .auth.ok { color: var(--green); }
.auth { color: var(--muted); }
.tools { display: flex; gap: 0.15rem; flex-shrink: 0; }
.tools button {
  background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 0.8rem; padding: 0.15rem 0.3rem; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
}
.tools svg { display: block; }
.tools .pdf-img { display: block; width: 14px; height: 17px; }
.tools button:hover { background: rgba(255,255,255,0.1); color: var(--text); }
.tools .share-i { color: var(--azure); }
.tools .share-i:hover { background: rgba(65, 180, 255, 0.18); color: var(--azure); }

/* En táctil agrandamos el área de toque (sin padding absurdo). DOS COLUMNAS: el
   NOMBRE tiene prioridad (ancho mínimo garantizado) y NO se lo empuja; la columna
   de botones se ENCOGE y ENVUELVE en varias filas dentro del espacio que sobra. */
@media (hover: none) and (pointer: coarse) {
  .item { align-items: flex-start; }
  .nm { min-width: 5.5rem; }
  .tools { flex: 0 1 auto; flex-shrink: 1; flex-wrap: wrap; justify-content: flex-end; gap: 0.1rem; }
  .tools button { padding: 0.25rem; min-width: 34px; min-height: 34px; }
  .tools svg { width: 18px; height: 18px; }
  .tools .pdf-img { width: 16px; height: 20px; }
}

/* Escritorio: barra lateral fija, sin scrim ni animación */
@media (min-width: 960px) {
  .drawer-root {
    position: sticky; top: 0; inset: auto; height: 100vh;
    width: 290px; flex-shrink: 0; pointer-events: auto; z-index: 1;
  }
  .scrim { display: none; }
  .drawer {
    position: static; transform: none !important; height: 100vh;
    box-shadow: none; border-right: 1px solid var(--line); overflow-y: auto;
  }
  .dh .x { display: none; }
  /* Chevron + título "Pronósticos" juntos a la izquierda en web. */
  .dh { justify-content: flex-start; gap: 0.5rem; }
}

/* Chevron de volver del sidebar (solo web; en móvil va en el header de App.vue). */
.cc-back-sb { color: var(--text, #fff); --cc-back-size: 32px; margin-left: -4px; }
@media (max-width: 959px) { .cc-back-sb { display: none; } }
</style>
