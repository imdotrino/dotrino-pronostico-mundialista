<script setup lang="ts">
// Popup DIARIO del pronóstico de la fecha: al abrir la app muestra los partidos
// de HOY y MAÑANA que aún se pueden pronosticar (antes del kickoff), recoge los
// marcadores y, al guardar, la app SELLA cada pronóstico con el TSA. Mañana,
// con la nueva fecha, vuelve a aparecer con los partidos pendientes.
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamById } from '../lib/teams'
import type { MatchResult, Results } from '../lib/standings'
import { fixturePhaseKey, dayKey, nowMs, type Fixture } from '../lib/matchday'

const { t, locale } = useI18n()

const props = defineProps<{
  open: boolean
  /** Partidos de HOY y MAÑANA aún pronosticables (orden cronológico). */
  matches: Fixture[]
  /** Picks actuales de la entrada diaria (para precargar). */
  picks: Results
  /** La app está guardando/sellando. */
  sealing: boolean
  /** Resultado del sellado (null = aún sin guardar en esta apertura). */
  sealResult: { sealed: number; failed: number } | null
}>()

const emit = defineEmits<{
  save: [items: { id: number; r: MatchResult }[]]
  close: []
  gosection: []
}>()

interface Draft { gh: string; ga: string; adv: 'h' | 'a' | null }
const drafts = ref<Record<number, Draft>>({})

// Precarga los borradores con los picks existentes cada vez que se abre. (Se
// observa la LONGITUD de la lista, no su identidad: el poll de resultados
// oficiales regenera el arreglo y no debe resetear lo que estás tipeando.)
watch(() => [props.open, props.matches.length] as const, () => {
  if (!props.open) return
  const d: Record<number, Draft> = {}
  for (const f of props.matches) {
    const r = props.picks[f.id]
    d[f.id] = {
      gh: typeof r?.gh === 'number' ? String(r.gh) : '',
      ga: typeof r?.ga === 'number' ? String(r.ga) : '',
      adv: r && typeof r.ph === 'number' && typeof r.pa === 'number'
        ? (r.ph > r.pa ? 'h' : 'a')
        : null,
    }
  }
  drafts.value = d
}, { immediate: true })

const flag = (id: number | null) => (id == null ? '' : teamById(id).flag)
const code = (id: number | null) => (id == null ? '?' : teamById(id).code)

function phase (f: Fixture): string {
  const p = fixturePhaseKey(f)
  return t(p.key, p.params ?? {})
}
function hourOf (f: Fixture): string {
  return new Date(f.kickoff).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

// Separadores de día: la lista llega en orden cronológico (hoy, luego mañana).
function isNewDay (i: number): boolean {
  if (i === 0) return true
  return dayKey(props.matches[i]!.kickoff) !== dayKey(props.matches[i - 1]!.kickoff)
}
function dayHeader (f: Fixture): string {
  const label = dayKey(f.kickoff) === dayKey(nowMs()) ? t('daily.today') : t('daily.tomorrow')
  const date = new Date(f.kickoff).toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' })
  return `${label} · ${date}`
}

// Un borrador está completo si tiene los dos goles (0..15).
function parsedScore (d: Draft): { gh: number; ga: number } | null {
  if (d.gh === '' || d.ga === '') return null
  const gh = Math.max(0, Math.min(15, Math.floor(Number(d.gh))))
  const ga = Math.max(0, Math.min(15, Math.floor(Number(d.ga))))
  if (Number.isNaN(gh) || Number.isNaN(ga)) return null
  return { gh, ga }
}
const isKoDraw = (f: Fixture): boolean => {
  const s = parsedScore(drafts.value[f.id] ?? { gh: '', ga: '', adv: null })
  return f.stage === 'ko' && !!s && s.gh === s.ga
}

function buildItems (): { id: number; r: MatchResult }[] {
  const items: { id: number; r: MatchResult }[] = []
  for (const f of props.matches) {
    const d = drafts.value[f.id]
    if (!d) continue
    const s = parsedScore(d)
    if (!s) continue
    const r: MatchResult = { o: s.gh > s.ga ? 0 : s.gh < s.ga ? 2 : 1, gh: s.gh, ga: s.ga }
    // Eliminatoria empatada: "quién avanza" viaja como penales simbólicos 1-0.
    if (f.stage === 'ko' && s.gh === s.ga && d.adv) { r.ph = d.adv === 'h' ? 1 : 0; r.pa = d.adv === 'h' ? 0 : 1 }
    // ¿Cambió respecto del pick guardado? (no re-sellar lo idéntico)
    const prev = props.picks[f.id]
    const same = prev && prev.gh === r.gh && prev.ga === r.ga &&
      (prev.ph ?? null) === (r.ph ?? null) && (prev.pa ?? null) === (r.pa ?? null)
    if (!same) items.push({ id: f.id, r })
  }
  return items
}

const filledCount = computed(() => props.matches.filter((f) => parsedScore(drafts.value[f.id] ?? { gh: '', ga: '', adv: null })).length)
const canSave = computed(() => !props.sealing && buildItems().length > 0)

function save () {
  const items = buildItems()
  if (items.length) emit('save', items)
}
</script>

<template>
  <div v-if="open" class="overlay" data-testid="daily-popup" @click.self="emit('close')">
    <div class="daily-modal">
      <button class="x" data-testid="daily-popup-close" :aria-label="t('common.close')" @click="emit('close')">×</button>
      <h3>⚽ {{ t('daily.popupTitle') }}</h3>
      <p class="hint">{{ t('daily.popupHint') }}</p>

      <div class="list">
        <template v-for="(f, i) in matches" :key="f.id">
          <p v-if="isNewDay(i)" class="sub">{{ dayHeader(f) }}</p>
          <div class="row" data-testid="daily-popup-match">
          <div class="meta">
            <span class="ph">{{ phase(f) }}</span>
            <span class="hr">{{ hourOf(f) }}</span>
          </div>
          <div class="duel">
            <span class="team home"><span class="fl">{{ flag(f.home) }}</span> <span class="cd mono-code">{{ code(f.home) }}</span></span>
            <span class="score">
              <input
                v-model="drafts[f.id]!.gh" type="number" min="0" max="15" inputmode="numeric"
                data-testid="daily-gh" :disabled="sealing" @keydown.stop
              />
              <span class="dash">–</span>
              <input
                v-model="drafts[f.id]!.ga" type="number" min="0" max="15" inputmode="numeric"
                data-testid="daily-ga" :disabled="sealing" @keydown.stop
              />
            </span>
            <span class="team away"><span class="cd mono-code">{{ code(f.away) }}</span> <span class="fl">{{ flag(f.away) }}</span></span>
          </div>
          <!-- Eliminatoria empatada: elegir quién avanza (penales) -->
          <div v-if="isKoDraw(f)" class="adv">
            <span class="adv-q">{{ t('daily.advance') }}</span>
            <button :class="{ on: drafts[f.id]!.adv === 'h' }" :disabled="sealing" @click="drafts[f.id]!.adv = 'h'">{{ flag(f.home) }} {{ code(f.home) }}</button>
            <button :class="{ on: drafts[f.id]!.adv === 'a' }" :disabled="sealing" @click="drafts[f.id]!.adv = 'a'">{{ flag(f.away) }} {{ code(f.away) }}</button>
          </div>
          </div>
        </template>
      </div>

      <p v-if="sealResult" class="done" data-testid="daily-popup-done">
        <template v-if="sealResult.failed === 0">✓ {{ t('daily.sealedOk') }}</template>
        <template v-else>⚠ {{ t('daily.sealFailed', { n: sealResult.failed }) }}</template>
      </p>

      <div class="acts">
        <button class="ghost" data-testid="daily-popup-later" @click="emit('close')">{{ sealResult ? t('common.close') : t('daily.later') }}</button>
        <button class="go" data-testid="daily-popup-save" :disabled="!canSave" @click="save">
          {{ sealing ? t('daily.sealing') : t('daily.sealAll') }}
        </button>
      </div>
      <p class="count">{{ t('daily.popupCount', { n: filledCount, total: matches.length }) }}</p>
      <button class="link" data-testid="daily-popup-gosection" @click="emit('gosection')">{{ t('daily.goSection') }} ›</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
  display: flex; align-items: center; justify-content: center; z-index: 320; padding: 1rem;
}
.daily-modal {
  background: var(--panel); border: 1px solid var(--azure); border-radius: 16px;
  padding: 1.3rem; max-width: 420px; width: 100%; position: relative; box-shadow: var(--shadow);
  max-height: 88vh; overflow-y: auto;
}
.daily-modal h3 { color: var(--azure); margin-bottom: 0.15rem; }
.sub { color: var(--text); font-weight: 700; font-size: 0.85rem; text-transform: capitalize; margin-top: 0.3rem; }
.hint { color: var(--muted); font-size: 0.78rem; margin: 0.35rem 0 0.8rem; }
.x { position: absolute; top: 0.5rem; right: 0.7rem; background: none; border: none; color: var(--muted); font-size: 1.5rem; cursor: pointer; line-height: 1; }

.list { display: flex; flex-direction: column; gap: 0.55rem; }
.row { background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 0.6rem 0.7rem; }
.meta { display: flex; justify-content: space-between; font-size: 0.68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.35rem; }
.duel { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.team { display: inline-flex; align-items: center; gap: 0.35rem; min-width: 0; }
.fl { font-size: 1.25rem; }
.cd { font-weight: 800; font-size: 0.85rem; }
.score { display: inline-flex; align-items: center; gap: 0.3rem; }
.score input {
  width: 2.6rem; text-align: center; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 8px; color: var(--text); font-size: 1.05rem; font-weight: 800; padding: 0.35rem 0.15rem;
  font-family: inherit;
}
.score input:focus { border-color: var(--azure); outline: none; }
.dash { color: var(--muted); }
.adv { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.5rem; flex-wrap: wrap; }
.adv-q { font-size: 0.74rem; color: var(--gold); font-weight: 700; }
.adv button {
  background: transparent; border: 1px solid var(--line); color: var(--text); border-radius: 8px;
  padding: 0.25rem 0.6rem; cursor: pointer; font-weight: 700; font-size: 0.78rem; font-family: inherit;
}
.adv button.on { background: var(--azure); color: #042038; border-color: var(--azure); }

.done { margin-top: 0.7rem; font-size: 0.84rem; font-weight: 700; color: var(--green); }
.acts { display: flex; gap: 0.5rem; margin-top: 0.9rem; }
.ghost {
  flex: 1; background: transparent; color: var(--muted); border: 1px solid var(--line);
  border-radius: 10px; padding: 0.6rem; cursor: pointer; font-weight: 700; font-family: inherit;
}
.go {
  flex: 2; background: var(--azure); color: #042038; border: none; border-radius: 10px;
  padding: 0.6rem; cursor: pointer; font-weight: 800; font-family: inherit;
}
.go:disabled { opacity: 0.5; cursor: default; }
.count { text-align: center; color: var(--muted); font-size: 0.72rem; margin-top: 0.5rem; }
.link {
  display: block; margin: 0.4rem auto 0; background: none; border: none; color: var(--azure);
  cursor: pointer; font-weight: 700; font-size: 0.8rem; font-family: inherit;
}
.link:hover { text-decoration: underline; }
</style>
