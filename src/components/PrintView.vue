<script setup lang="ts">
// Vista de impresión: el pronóstico completo (grupos + llaves) y el QR firmado
// en UNA sola página A4 VERTICAL (portrait). El contenido se apila: encabezado,
// fase de grupos a todo el ancho, llaves a todo el ancho y QR en el pie. Estilo
// papel (blanco/oscuro, sin sombras) para guardar como PDF desde el navegador.
// En pantalla queda oculto; solo se muestra al imprimir (ver @media print).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GROUPS, GROUP_LETTERS, teamById } from '../lib/teams'
import {
  resolveMatches, qualifiedThirdGroups, type Prediction, type ResolvedMatch,
} from '../lib/prediction'
import {
  groupStandingsTable, GROUP_PAIRS, groupMatchIndex, teamAt,
} from '../lib/standings'
import { R32, R16, QF, SF, FINAL, THIRD_PLACE, type Slot } from '../lib/bracket'

const props = defineProps<{
  pred: Prediction
  title: string
  author?: string
  qrDataUrl: string
  // Modo captura: muestra la MISMA hoja en pantalla (con ancho fijo A4) para
  // poder rasterizarla con html2canvas y generar el PDF. Por defecto false.
  capture?: boolean
}>()

const { t } = useI18n()

const resolved = computed(() => resolveMatches(props.pred))
function m (num: number): ResolvedMatch | undefined { return resolved.value.get(num) }

const r32Slots = new Map<number, { home: Slot; away: Slot }>(
  R32.map((x) => [x.num, { home: x.home, away: x.away }]),
)
const laterFrom = new Map<number, [number, number]>(
  [...R16, ...QF, ...SF, THIRD_PLACE, FINAL].map((x) => [x.num, x.from]),
)

function slotLabel (slot: Slot): string {
  if (slot.kind === 'W') return t('bracket.winnerOf', { letter: GROUP_LETTERS[slot.group] })
  if (slot.kind === 'RU') return t('bracket.runnerUpOf', { letter: GROUP_LETTERS[slot.group] })
  return t('bracket.thirdSlot')
}

// Cada cupo de un partido: equipo resuelto (bandera + código) o etiqueta.
interface CellView { code: string; flag: string; label: string; picked: boolean }

function cell (num: number, top: boolean): CellView {
  const match = m(num)
  const teamId = (top ? match?.home : match?.away) ?? null
  const winner = match?.winner ?? null
  if (teamId != null) {
    const t = teamById(teamId)
    return { code: t.code, flag: t.flag, label: '', picked: winner === teamId }
  }
  let label = ''
  const r32 = r32Slots.get(num)
  if (r32) label = slotLabel(top ? r32.home : r32.away)
  else if (num === THIRD_PLACE.num) label = t('bracket.loserSFShort')
  else {
    const from = laterFrom.get(num)
    if (from) label = t('bracket.winnerNum', { n: from[top ? 0 : 1] })
  }
  return { code: '', flag: '', label, picked: false }
}

interface MatchView { num: number; top: CellView; bottom: CellView }
function match (num: number): MatchView {
  return { num, top: cell(num, true), bottom: cell(num, false) }
}

// Mismo armado simétrico que BracketTab.vue.
const leftCols = computed(() => [
  { titleKey: 'bracket.r32Short', nums: [74, 77, 73, 75, 83, 84, 81, 82] },
  { titleKey: 'bracket.r16Short', nums: [89, 90, 93, 94] },
  { titleKey: 'bracket.qfShort', nums: [97, 98] },
  { titleKey: 'bracket.sfShort', nums: [101] },
].map((c) => ({ title: t(c.titleKey), matches: c.nums.map(match) })))

const rightCols = computed(() => [
  { titleKey: 'bracket.sfShort', nums: [102] },
  { titleKey: 'bracket.qfShort', nums: [99, 100] },
  { titleKey: 'bracket.r16Short', nums: [91, 92, 95, 96] },
  { titleKey: 'bracket.r32Short', nums: [76, 78, 79, 80, 86, 88, 85, 87] },
].map((c) => ({ title: t(c.titleKey), matches: c.nums.map(match) })))

const finalMatch = computed(() => match(FINAL.num))
const thirdMatch = computed(() => match(THIRD_PLACE.num))
const championId = computed(() => m(FINAL.num)?.winner ?? null)
const champion = computed(() => (championId.value != null ? teamById(championId.value) : null))
// Ganador del 3.er puesto (medalla de bronce), para destacarlo en la hoja.
const bronzeId = computed(() => m(THIRD_PLACE.num)?.winner ?? null)
const bronze = computed(() => (bronzeId.value != null ? teamById(bronzeId.value) : null))

// Etiqueta del modo de juego para el encabezado.
const modeLabel = computed(() => {
  switch (props.pred.mode) {
    case 'winlose': return t('modes.medium')
    case 'score': return t('modes.full')
    default: return t('modes.simple')
  }
})
// Alcance del pronóstico: qué fases incluye (controla qué secciones se imprimen).
const showGroupsSection = computed(() => props.pred.scope !== 'bracket')
const showBracketSection = computed(() => props.pred.scope !== 'groups')
// Etiqueta de tipo: modo + alcance (el alcance solo si no es 'all').
const typeLabel = computed(() => {
  const scope = props.pred.scope ?? 'all'
  if (scope === 'all') return modeLabel.value
  return modeLabel.value + ' · ' + (scope === 'groups' ? t('scopes.groups') : t('scopes.bracket'))
})

// Grilla de grupos: orden pronosticado con marca de clasificados (1.º, 2.º) y
// de los terceros que clasifican (8 mejores).
const qualifiedThirds = computed(() => new Set(qualifiedThirdGroups(props.pred)))

// --- Modo SIMPLE (manual): solo orden de posiciones, sin puntos. ---
const groupViews = computed(() =>
  GROUPS.map((g, gi) => ({
    letter: g.letter,
    rows: props.pred.groupOrder[gi]!.map((id, pos) => {
      const t = teamById(id)
      // Clasifica directo (1.º o 2.º) o como mejor tercero.
      const qualifies = pos < 2 || (pos === 2 && qualifiedThirds.value.has(gi))
      return { pos: pos + 1, code: t.code, flag: t.flag, name: t.name, qualifies, third: pos === 2 }
    }),
  })),
)

// --- Modos MEDIO (winlose) y COMPLETO (score): tabla calculada por resultados. ---
// Filas de posiciones con Pts (y DG/GF en 'score'), más los 6 resultados del grupo.
interface StandRow {
  pos: number; code: string; flag: string; name: string
  pts: number; gd: number; gf: number; qualifies: boolean; third: boolean
}
interface ResultRow { home: string; away: string; sign: string; score: string }
interface GroupResultView { letter: string; rows: StandRow[]; results: ResultRow[] }

const showGoals = computed(() => props.pred.mode === 'score')

// Signo 1/–/2 a partir del campo `o` (o, si hay goles en 'score', del marcador).
function signOf (o: 0 | 1 | 2): string {
  return o === 0 ? '1' : o === 2 ? '2' : '–'
}

const groupResultViews = computed<GroupResultView[]>(() =>
  GROUPS.map((g, gi) => {
    const table = groupStandingsTable(gi, props.pred.results, props.pred.mode)
    const rows: StandRow[] = table.map((s, pos) => {
      const t = teamById(s.teamId)
      const qualifies = pos < 2 || (pos === 2 && qualifiedThirds.value.has(gi))
      return {
        pos: pos + 1, code: t.code, flag: t.flag, name: t.name,
        pts: s.pts, gd: s.gd, gf: s.gf, qualifies, third: pos === 2,
      }
    })
    // Los 6 partidos del grupo por posición de sorteo.
    const results: ResultRow[] = GROUP_PAIRS.map(([a, b], pair) => {
      const r = props.pred.results[groupMatchIndex(gi, pair)]
      const home = teamById(teamAt(gi, a)).code
      const away = teamById(teamAt(gi, b)).code
      if (!r) return { home, away, sign: '–', score: '–' }
      // En 'score' con goles cargados el signo deriva del marcador.
      let o: 0 | 1 | 2 = r.o
      let score = '–'
      if (showGoals.value && typeof r.gh === 'number' && typeof r.ga === 'number') {
        o = r.gh > r.ga ? 0 : r.gh < r.ga ? 2 : 1
        score = r.gh + '-' + r.ga
      }
      return { home, away, sign: signOf(o), score }
    })
    return { letter: g.letter, rows, results }
  }),
)
</script>

<template>
  <div class="print-view" :class="{ 'as-capture': capture }" aria-hidden="true">
    <header class="ph">
      <div class="ph-titles">
        <h1>{{ title }}</h1>
        <p v-if="author" class="ph-author">{{ t('print.author', { author }) }}</p>
      </div>
      <div class="ph-event">{{ t('print.event') }}<span class="ph-mode">{{ typeLabel }}</span></div>
    </header>

    <div class="body">
      <!-- Fase de grupos: template DIFERENTE según el modo de juego. Se omite en
           alcance 'bracket' (solo llaves). -->
      <section v-if="showGroupsSection" class="groups" :class="{ 'with-goals': pred.mode === 'score' }">
        <h2>{{ t('print.groups') }}</h2>

        <!-- Modo SIMPLE (manual): solo el orden, sin puntos. -->
        <div v-if="pred.mode === 'manual'" class="groups-grid">
          <div v-for="g in groupViews" :key="g.letter" class="g-card">
            <div class="g-head">{{ t('group.title', { letter: g.letter }) }}</div>
            <div
              v-for="r in g.rows"
              :key="r.code"
              class="g-row"
              :class="{ q: r.qualifies, t3: r.third }"
            >
              <span class="g-pos">{{ r.pos }}</span>
              <span class="g-flag">{{ r.flag }}</span>
              <span class="g-code">{{ r.code }}</span>
              <span class="g-name">{{ r.name }}</span>
            </div>
          </div>
        </div>

        <!-- Modos MEDIO (winlose) y COMPLETO (score): tabla calculada + resultados. -->
        <div v-else class="groups-grid">
          <div v-for="g in groupResultViews" :key="g.letter" class="g-card">
            <div class="g-head">
              <span>{{ t('group.title', { letter: g.letter }) }}</span>
              <span class="g-cols">
                <span class="g-th">{{ t('standings.pts') }}</span>
                <template v-if="showGoals">
                  <span class="g-th">{{ t('standings.gd') }}</span>
                  <span class="g-th">{{ t('standings.gf') }}</span>
                </template>
              </span>
            </div>
            <div
              v-for="r in g.rows"
              :key="r.code"
              class="g-row res"
              :class="{ q: r.qualifies, t3: r.third }"
            >
              <span class="g-pos">{{ r.pos }}</span>
              <span class="g-flag">{{ r.flag }}</span>
              <span class="g-code">{{ r.code }}</span>
              <span class="g-stat pts">{{ r.pts }}</span>
              <template v-if="showGoals">
                <span class="g-stat">{{ r.gd > 0 ? '+' + r.gd : r.gd }}</span>
                <span class="g-stat">{{ r.gf }}</span>
              </template>
            </div>
            <!-- Mini-grilla con los 6 partidos del grupo. -->
            <div class="g-results">
              <span
                v-for="(rr, ri) in g.results"
                :key="ri"
                class="g-res"
              >
                {{ rr.home }} <b>{{ showGoals ? rr.score : rr.sign }}</b> {{ rr.away }}
              </span>
            </div>
          </div>
        </div>

        <p class="legend">
          <span class="sw q"></span> {{ t('print.legendDirect') }}
          <span class="sw t3"></span> {{ t('print.legendThird') }}
        </p>
      </section>

      <!-- Llaves. Se omite en alcance 'groups' (solo grupos). -->
      <section v-if="showBracketSection" class="bracket">
        <h2>{{ t('print.bracket') }}</h2>
        <div class="board">
          <div v-for="(col, ci) in leftCols" :key="'l' + ci" class="col">
            <span class="col-title">{{ col.title }}</span>
            <div class="col-matches">
              <div v-for="mv in col.matches" :key="mv.num" class="mbox">
                <div class="side" :class="{ picked: mv.top.picked, empty: !mv.top.code }">
                  <template v-if="mv.top.code">
                    <span class="flag">{{ mv.top.flag }}</span><span class="code">{{ mv.top.code }}</span>
                  </template>
                  <span v-else class="ph-lbl">{{ mv.top.label }}</span>
                </div>
                <div class="side" :class="{ picked: mv.bottom.picked, empty: !mv.bottom.code }">
                  <template v-if="mv.bottom.code">
                    <span class="flag">{{ mv.bottom.flag }}</span><span class="code">{{ mv.bottom.code }}</span>
                  </template>
                  <span v-else class="ph-lbl">{{ mv.bottom.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Centro: final + campeón + 3er puesto -->
          <div class="col center">
            <span class="trophy" :title="t('bracket.champion')">🏆</span>
            <div class="mbox big">
              <div class="side" :class="{ picked: finalMatch.top.picked, empty: !finalMatch.top.code }">
                <template v-if="finalMatch.top.code">
                  <span class="flag">{{ finalMatch.top.flag }}</span><span class="code">{{ finalMatch.top.code }}</span>
                </template>
                <span v-else class="ph-lbl">{{ finalMatch.top.label }}</span>
              </div>
              <div class="side" :class="{ picked: finalMatch.bottom.picked, empty: !finalMatch.bottom.code }">
                <template v-if="finalMatch.bottom.code">
                  <span class="flag">{{ finalMatch.bottom.flag }}</span><span class="code">{{ finalMatch.bottom.code }}</span>
                </template>
                <span v-else class="ph-lbl">{{ finalMatch.bottom.label }}</span>
              </div>
            </div>
            <div v-if="champion" class="champ">
              {{ t('print.champion') }} <strong>{{ champion.flag }} {{ champion.name }}</strong>
            </div>
            <div class="third">
              <span class="col-title">🥉 {{ t('bracket.thirdPlace') }}</span>
              <div class="mbox">
                <div class="side" :class="{ picked: thirdMatch.top.picked, empty: !thirdMatch.top.code }">
                  <template v-if="thirdMatch.top.code">
                    <span class="flag">{{ thirdMatch.top.flag }}</span><span class="code">{{ thirdMatch.top.code }}</span>
                  </template>
                  <span v-else class="ph-lbl">{{ thirdMatch.top.label }}</span>
                </div>
                <div class="side" :class="{ picked: thirdMatch.bottom.picked, empty: !thirdMatch.bottom.code }">
                  <template v-if="thirdMatch.bottom.code">
                    <span class="flag">{{ thirdMatch.bottom.flag }}</span><span class="code">{{ thirdMatch.bottom.code }}</span>
                  </template>
                  <span v-else class="ph-lbl">{{ thirdMatch.bottom.label }}</span>
                </div>
              </div>
              <div v-if="bronze" class="bronze">
                {{ t('print.bronze') }} <strong>{{ bronze.flag }} {{ bronze.name }}</strong>
              </div>
            </div>
          </div>

          <div v-for="(col, ci) in rightCols" :key="'r' + ci" class="col">
            <span class="col-title">{{ col.title }}</span>
            <div class="col-matches">
              <div v-for="mv in col.matches" :key="mv.num" class="mbox">
                <div class="side" :class="{ picked: mv.top.picked, empty: !mv.top.code }">
                  <template v-if="mv.top.code">
                    <span class="flag">{{ mv.top.flag }}</span><span class="code">{{ mv.top.code }}</span>
                  </template>
                  <span v-else class="ph-lbl">{{ mv.top.label }}</span>
                </div>
                <div class="side" :class="{ picked: mv.bottom.picked, empty: !mv.bottom.code }">
                  <template v-if="mv.bottom.code">
                    <span class="flag">{{ mv.bottom.flag }}</span><span class="code">{{ mv.bottom.code }}</span>
                  </template>
                  <span v-else class="ph-lbl">{{ mv.bottom.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <footer class="pf">
      <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('print.qrAlt')" class="qr" />
      <div class="pf-text">
        <p class="pf-scan">{{ t('print.scan') }}</p>
        <p class="pf-url">mundial.dotrino.com</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Oculto en pantalla; solo aparece al imprimir o en modo captura.
   Las reglas visuales de la hoja están extraídas a `.sheet { ... }` para que
   apliquen IGUAL en `@media print` (envuelve todo) y en modo captura
   (`.print-view.as-capture`, que se muestra en pantalla). */
.print-view { display: none; }

/* En modo captura mostramos la hoja con ancho fijo A4 portrait
   (210mm ≈ 794px @96dpi) y padding equivalente a 8mm (≈30px) para que
   html2canvas la rasterice tal cual saldría impresa. App la posiciona fuera
   de pantalla mientras dura la captura. */
.print-view.as-capture {
  display: flex;
  width: 794px;
  min-height: 1123px; /* 297mm @96dpi */
  padding: 30px;
  box-sizing: border-box;
}

/* Reglas visuales compartidas: válidas tanto al imprimir como en captura. */
@media print { .print-view { display: flex; } }

.print-view.as-capture,
.print-view {
  flex-direction: column;
  width: 100%;
  color: #111;
  background: #fff;
  font-family: system-ui, sans-serif;
}
.print-view.as-capture { width: 794px; } /* recupera el ancho fijo de captura */

/* Encabezado a todo el ancho */
.ph {
  display: flex; align-items: baseline; justify-content: space-between;
  border-bottom: 2px solid #111; padding-bottom: 3px; margin-bottom: 5px;
}
.ph-titles h1 { font-size: 14pt; margin: 0; color: #111; }
.ph-author { font-size: 8pt; margin: 0; color: #444; }
.ph-event { font-size: 8pt; font-weight: 700; letter-spacing: 0.05em; color: #444; }
.ph-mode { color: #07408a; }

/* Portrait: apilamos verticalmente (grupos arriba, llaves debajo). */
.body { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.groups { width: 100%; }
.bracket { width: 100%; }

h2 {
  font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em;
  margin: 0 0 3px; color: #222; border-bottom: 1px solid #999; padding-bottom: 1px;
}

/* Grupos: 12 grupos en 4 columnas × 3 filas, a todo el ancho. */
.groups-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.g-card { border: 1px solid #bbb; border-radius: 3px; overflow: hidden; }
.g-head { background: #eee; font-weight: 700; font-size: 6.5pt; padding: 1px 3px; }
.g-row {
  display: flex; align-items: center; gap: 2px; font-size: 6pt;
  padding: 0.5px 3px; border-top: 1px solid #eee;
}
.g-row.q { background: #e6f0fb; }
.g-row.t3 { background: #fbf3df; }
.g-pos { width: 8px; color: #888; font-weight: 700; }
.g-flag { font-size: 7pt; line-height: 1; }
.g-code { font-weight: 700; width: 22px; }
.g-name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

/* Modos Medio/Completo: cabecera con columnas de estadística y filas con Pts. */
.g-head { display: flex; align-items: center; justify-content: space-between; }
.g-cols { display: inline-flex; gap: 0; }
.g-th { width: 16px; text-align: center; font-size: 5pt; color: #555; font-weight: 700; }
.g-row.res .g-code { flex: 1; width: auto; }
.g-stat { width: 16px; text-align: center; font-size: 6pt; }
.g-stat.pts { font-weight: 700; }

/* Mini-grilla de los 6 resultados del grupo (signo 1/X/2 o marcador gh-ga). */
.g-results {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0 4px;
  padding: 1px 3px 2px; border-top: 1px solid #eee;
}
.g-res {
  font-size: 5pt; color: #555; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.g-res b { color: #111; font-size: 5.5pt; }

/* En modo Completo hay más datos: compactamos un poco más. */
.groups.with-goals .g-row.res { font-size: 5.5pt; padding: 0.3px 3px; }
.groups.with-goals .g-results { gap: 0 3px; }

.legend { font-size: 5.5pt; color: #555; margin: 3px 0 0; display: flex; align-items: center; gap: 4px; }
.legend .sw { width: 9px; height: 9px; display: inline-block; border: 1px solid #aaa; border-radius: 2px; }
.legend .sw.q { background: #e6f0fb; margin-left: 4px; }
.legend .sw.t3 { background: #fbf3df; }

/* Llaves: armado simétrico a todo el ancho de la página (~194mm útiles). */
.board { display: flex; align-items: stretch; gap: 2px; }
.col { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; }
.col-title {
  text-align: center; font-size: 5pt; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.03em; margin-bottom: 2px; color: #555; white-space: nowrap;
}
.col-matches { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 2px; }

.mbox { border: 1px solid #bbb; border-radius: 3px; overflow: hidden; }
.side {
  display: flex; align-items: center; justify-content: center; gap: 2px;
  min-height: 14px; padding: 1px 2px; border-top: 1px solid #ddd;
}
.side:first-child { border-top: none; }
.side.picked { background: #d8e9fb; }
.flag { font-size: 7pt; line-height: 1; }
.code { font-weight: 700; font-size: 6pt; letter-spacing: 0.02em; }
.side.picked .code { color: #07408a; }
.ph-lbl { font-size: 4.5pt; color: #999; font-style: italic; text-align: center; line-height: 1.05; }

.center { flex: 1.3 1 0; justify-content: center; align-items: center; gap: 3px; }
.center > * { width: 100%; }
.trophy { font-size: 12pt; text-align: center; }
.mbox.big .flag { font-size: 10pt; }
.mbox.big .code { font-size: 8pt; }
.mbox.big .side { min-height: 20px; }
.champ { font-size: 7pt; text-align: center; color: #07408a; }
.third { margin-top: 3px; }
.bronze { font-size: 6.5pt; text-align: center; color: #8a5a07; margin-top: 1px; }

/* Pie con QR grande (sobra espacio en portrait): centrado. */
.pf {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  margin-top: auto; padding-top: 6px; border-top: 1px solid #999;
}
.qr { width: 300px; height: 300px; }
.pf-text { line-height: 1.25; }
.pf-scan { font-size: 9pt; color: #444; margin: 0; }
.pf-url { font-size: 13pt; font-weight: 800; color: #111; margin: 0; }

/* Forzamos una sola página al imprimir: la altura útil de A4 portrait es ~281mm. */
@media print { .print-view { min-height: 281mm; } }

@page { size: A4 portrait; margin: 8mm; }
</style>
