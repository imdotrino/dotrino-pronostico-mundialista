<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import { teamById, GROUP_LETTERS } from '../lib/teams'
import type { Prediction } from '../lib/prediction'

const { t } = useI18n()

const props = defineProps<{ pred: Prediction; readonly?: boolean }>()

interface ThirdItem { group: number; teamId: number }

// Cada ítem se identifica por su grupo (estable aunque cambie el 3º del grupo).
// Lee/escribe el BORRADOR (se aplica a las llaves al "Confirmar cambios").
const items = computed<ThirdItem[]>({
  get: () => props.pred.draftThirdsRank.map((g) => ({ group: g, teamId: props.pred.draftGroupOrder[g]![2]! })),
  set: (list: ThirdItem[]) => { props.pred.draftThirdsRank = list.map((i) => i.group) },
})

// En mobile (puntero grueso) el drag arranca SOLO desde el grip de los 9 puntos,
// para no robarle el gesto al scroll. En desktop, arrastra desde cualquier punto.
const dragHandle = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? '.drag' : undefined
</script>

<template>
  <div class="thirds">
    <div class="thirds-head">
      <h3>{{ t('thirds.title') }}</h3>
      <i18n-t keypath="thirds.help" tag="p" scope="global">
        <template #strong><strong>{{ t('thirds.helpStrong') }}</strong></template>
      </i18n-t>
    </div>
    <draggable
      v-model="items"
      item-key="group"
      :animation="160"
      ghost-class="ghost"
      :disabled="readonly"
      :handle="dragHandle"
      class="thirds-list"
    >
      <template #item="{ element, index }">
        <div class="third-row" data-testid="third-row" :data-group="element.group" :class="{ in: index < 8, out: index >= 8, grab: !readonly }">
          <span class="rank">{{ index + 1 }}</span>
          <span class="flag">{{ teamById(element.teamId).flag }}</span>
          <span class="name">{{ teamById(element.teamId).name }}</span>
          <span class="grp">{{ t('thirds.label', { letter: GROUP_LETTERS[element.group] }) }}</span>
          <span v-if="!readonly" class="drag" :aria-label="t('common.reorder')">⋮⋮</span>
        </div>
      </template>
    </draggable>
    <div class="cut-note">{{ t('thirds.cut') }}</div>
  </div>
</template>

<style scoped>
.thirds {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow);
}
.thirds-head { padding: 0.7rem 0.9rem; background: var(--panel-2); }
.thirds-head h3 { color: var(--gold); font-size: 1.05rem; }
.thirds-head p { font-size: 0.82rem; color: var(--muted); margin-top: 0.2rem; }
.thirds-list { display: flex; flex-direction: column; position: relative; }
.third-row {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.5rem 0.7rem; border-top: 1px solid var(--line);
}
.third-row.grab { cursor: grab; }
.third-row.grab:active { cursor: grabbing; }
.third-row.in { background: rgba(65, 180, 255, 0.14); }
.third-row.out { background: rgba(231, 76, 60, 0.08); opacity: 0.7; }
.rank { width: 1.5rem; text-align: center; font-weight: 700; font-size: 0.8rem; color: var(--muted); }
.flag { font-size: 1.3rem; }
.name { flex: 1; font-size: 0.95rem; }
.grp { font-size: 0.75rem; color: var(--muted); }
.drag { cursor: grab; color: var(--muted); padding: 0 0.2rem; touch-action: none; user-select: none; }
@media (pointer: coarse) {
  /* En mobile el grip es el único punto de arrastre: tap target más amplio. */
  .drag { padding: 0.35rem 0.55rem; margin: -0.35rem -0.2rem; font-size: 1.1rem; }
}
.ghost { opacity: 0.5; background: var(--panel-2); }
/* Línea de corte tras la 8ª fila */
.thirds-list :deep(.third-row:nth-child(8)) { border-bottom: 2px dashed var(--gold); }
.cut-note { display: none; }
</style>
