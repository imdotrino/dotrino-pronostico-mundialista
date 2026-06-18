<script setup lang="ts">
// Pestaña "Puntajes": detalla los puntos obtenidos por el pronóstico activo
// frente a los Resultados oficiales y POR QUÉ (cada acierto con su puntaje).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamById, GROUP_LETTERS } from '../lib/teams'
import { teamAt, GROUP_PAIRS, groupMatchIndex } from '../lib/standings'
import { scoreDetail, type ScoreDetail } from '../lib/scoring'
import { formatLocal } from '../lib/schedule'
import type { SavedPrediction } from '../lib/store'

const { t, locale } = useI18n()
const props = defineProps<{ entry: SavedPrediction | null; official: SavedPrediction | null }>()

// Fecha/hora local de un partido (grupo: groupMatchIndex; eliminatoria: num).
function whenGroup (group: number, pair: number): string | null {
  return formatLocal(groupMatchIndex(group, pair), locale.value)
}
function whenMatch (num: number): string | null { return formatLocal(num, locale.value) }

const EMPTY: ScoreDetail = {
  positions: [], outcomes: [], exact: [], bracket: [],
  breakdown: { posiciones: 0, llaves: 0, resultados: 0, marcadores: 0, total: 0 },
}
const d = computed<ScoreDetail>(() => (props.entry ? scoreDetail(props.entry, props.official) : EMPTY))

// ¿Hay resultados oficiales cargados?
const hasOfficial = computed(() => !!props.official?.code && Object.keys(props.official?.results ?? {}).length > 0)

const ROUND_KEY: Record<string, string> = {
  r32: 'bracket.r32Short', r16: 'bracket.r16Short', qf: 'bracket.qfShort',
  sf: 'bracket.sfShort', third: 'bracket.thirdPlace', final: 'bracket.final',
}
function pairNames (group: number, pair: number): string {
  const [a, b] = GROUP_PAIRS[pair]!
  return teamById(teamAt(group, a)).name + ' – ' + teamById(teamAt(group, b)).name
}
</script>

<template>
  <div class="scores">
    <p v-if="!hasOfficial" class="empty">{{ t('scores.noOfficial') }}</p>

    <template v-else>
      <div class="total">
        <span class="total-pts">{{ d.breakdown.total }}</span>
        <span class="total-lbl">{{ t('scores.totalPts') }}</span>
      </div>

      <p v-if="d.breakdown.total === 0" class="empty">{{ t('scores.zero') }}</p>

      <!-- Posiciones -->
      <section v-if="d.positions.length" class="cat">
        <h4>{{ t('scores.positions') }} <span class="sub">+{{ d.breakdown.posiciones }}</span></h4>
        <div v-for="(it, i) in d.positions" :key="'p' + i" class="item">
          <span class="what">
            <span class="phase">{{ t('print.groups') }} · {{ t('group.title', { letter: GROUP_LETTERS[it.group] }) }}</span>
            {{ it.pos }}.º · {{ teamById(it.teamId).flag }} {{ teamById(it.teamId).name }}
          </span>
          <span class="pts">+{{ it.points }}</span>
        </div>
      </section>

      <!-- Llaves -->
      <section v-if="d.bracket.length" class="cat">
        <h4>{{ t('scores.bracket') }} <span class="sub">+{{ d.breakdown.llaves }}</span></h4>
        <div v-for="(it, i) in d.bracket" :key="'b' + i" class="item">
          <span class="what">
            <span class="phase">{{ t(ROUND_KEY[it.roundKey] || 'bracket.r32Short') }} · #{{ it.num }}</span>
            {{ teamById(it.teamId).flag }} {{ teamById(it.teamId).name }}
            <span v-if="whenMatch(it.num)" class="when">{{ whenMatch(it.num) }}</span>
          </span>
          <span class="pts">+{{ it.points }}</span>
        </div>
      </section>

      <!-- Resultados 1/–/2 -->
      <section v-if="d.outcomes.length" class="cat">
        <h4>{{ t('scores.outcomes') }} <span class="sub">+{{ d.breakdown.resultados }}</span></h4>
        <div v-for="(it, i) in d.outcomes" :key="'o' + i" class="item">
          <span class="what">
            <span class="phase">{{ t('print.groups') }} · {{ t('group.title', { letter: GROUP_LETTERS[it.group] }) }}</span>
            {{ pairNames(it.group, it.pair) }}
            <span v-if="whenGroup(it.group, it.pair)" class="when">{{ whenGroup(it.group, it.pair) }}</span>
          </span>
          <span class="pts">+{{ it.points }}</span>
        </div>
      </section>

      <!-- Marcador exacto -->
      <section v-if="d.exact.length" class="cat">
        <h4>{{ t('scores.exact') }} <span class="sub">+{{ d.breakdown.marcadores }}</span></h4>
        <div v-for="(it, i) in d.exact" :key="'e' + i" class="item">
          <span class="what">
            <span class="phase">{{ t('print.groups') }} · {{ t('group.title', { letter: GROUP_LETTERS[it.group] }) }}</span>
            {{ pairNames(it.group, it.pair) }} ({{ it.gh }}-{{ it.ga }})
            <span v-if="whenGroup(it.group, it.pair)" class="when">{{ whenGroup(it.group, it.pair) }}</span>
          </span>
          <span class="pts">+{{ it.points }}</span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.scores { padding-bottom: 2rem; max-width: 560px; margin: 0 auto; }
.empty { color: var(--muted); font-style: italic; text-align: center; padding: 1.5rem 0; }
.total {
  display: flex; flex-direction: column; align-items: center; gap: 0.1rem;
  background: var(--panel); border: 1px solid var(--azure); border-radius: 14px;
  padding: 1rem; margin-bottom: 1rem;
}
.total-pts { font-family: var(--font-display); font-size: 2.4rem; color: var(--azure); line-height: 1; }
.total-lbl { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
.cat { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 0.7rem 0.9rem; margin-bottom: 0.7rem; }
.cat h4 { color: var(--azure); font-size: 0.92rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; }
.cat h4 .sub { color: var(--green); font-weight: 800; }
.item { display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; border-top: 1px solid var(--line-soft); font-size: 0.86rem; }
.item:first-of-type { border-top: none; }
.what { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.what .phase { font-size: 0.66rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
.what .when { font-size: 0.66rem; color: var(--muted); opacity: 0.85; }
.pts {
  flex-shrink: 0; margin-left: 0.6rem; background: rgba(46, 204, 113, 0.18); color: var(--green);
  font-weight: 800; border-radius: 6px; padding: 0.05rem 0.4rem; font-size: 0.8rem;
}
</style>
