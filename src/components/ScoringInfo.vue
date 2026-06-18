<script setup lang="ts">
// Panel explicativo del cálculo de puntos, con pestañas por modo de juego.
// Lee las constantes de SCORING para que el texto y el cálculo real nunca se
// desincronicen.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SCORING } from '../lib/scoring'

const { t } = useI18n()

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

type Tab = 'simple' | 'medio' | 'completo'
const tab = ref<Tab>('simple')
</script>

<template>
  <div v-if="open" class="overlay" data-testid="scoring-modal" @click.self="emit('close')">
    <div class="modal">
      <button class="close" @click="emit('close')" :aria-label="t('common.close')">×</button>
      <h3>{{ t('scoring.title') }}</h3>

      <p class="intro">
        <i18n-t keypath="scoring.intro1" tag="span" scope="global">
          <template #results><strong>{{ t('scoring.introResults') }}</strong></template>
        </i18n-t>
        <i18n-t keypath="scoring.intro2" tag="span" scope="global">
          <template #sure><strong>{{ t('scoring.introSure') }}</strong></template>
        </i18n-t>
      </p>

      <nav class="tabs">
        <button :class="{ on: tab === 'simple' }" @click="tab = 'simple'">{{ t('modes.simple') }}</button>
        <button :class="{ on: tab === 'medio' }" @click="tab = 'medio'">{{ t('modes.medium') }}</button>
        <button :class="{ on: tab === 'completo' }" @click="tab = 'completo'">{{ t('modes.full') }}</button>
      </nav>

      <p class="mode-desc">
        <template v-if="tab === 'simple'">{{ t('scoring.descSimple') }}</template>
        <template v-else-if="tab === 'medio'">{{ t('scoring.descMedium') }}</template>
        <template v-else>{{ t('scoring.descFull') }}</template>
      </p>

      <!-- Posiciones: común a los 3 modos -->
      <section class="block">
        <h4>{{ t('scoring.positionsTitle') }}</h4>
        <i18n-t keypath="scoring.positionsText" tag="p" scope="global">
          <template #pts><span class="pts">+{{ SCORING.posicion }}</span></template>
        </i18n-t>
      </section>

      <!-- Llaves: común a los 3 modos -->
      <section class="block">
        <h4>{{ t('scoring.bracketTitle') }}</h4>
        <ul class="rounds">
          <li><span>{{ t('scoring.roundR32') }}</span><span class="pts">+{{ SCORING.r32 }}</span></li>
          <li><span>{{ t('scoring.roundR16') }}</span><span class="pts">+{{ SCORING.r16 }}</span></li>
          <li><span>{{ t('scoring.roundQF') }}</span><span class="pts">+{{ SCORING.qf }}</span></li>
          <li><span>{{ t('scoring.roundSF') }}</span><span class="pts">+{{ SCORING.sf }}</span></li>
          <li><span>{{ t('scoring.roundThird') }}</span><span class="pts">+{{ SCORING.tercero }}</span></li>
          <li class="big"><span>{{ t('scoring.roundFinal') }}</span><span class="pts">+{{ SCORING.final }}</span></li>
        </ul>
      </section>

      <!-- Resultado 1/X/2: Medio y Completo -->
      <section v-if="tab !== 'simple'" class="block">
        <h4>{{ t('scoring.matchTitle') }}</h4>
        <i18n-t keypath="scoring.matchText" tag="p" scope="global">
          <template #pts><span class="pts">+{{ SCORING.resultado }}</span></template>
        </i18n-t>
      </section>

      <!-- Marcador exacto: solo Completo -->
      <section v-if="tab === 'completo'" class="block extra">
        <h4>{{ t('scoring.exactTitle') }}</h4>
        <i18n-t keypath="scoring.exactText" tag="p" scope="global">
          <template #pts><span class="pts">+{{ SCORING.marcadorExacto }}</span></template>
        </i18n-t>
        <p class="ej">{{ t('scoring.exactExample', { pts: SCORING.marcadorExacto }) }}</p>
      </section>
      <p v-else class="no-extra">
        {{ t('scoring.noExtra', { mode: tab === 'simple' ? t('modes.simple') : t('modes.medium') }) }}
      </p>

      <i18n-t keypath="scoring.totalNote" tag="p" class="total-note" scope="global">
        <template #total><strong>{{ t('scoring.totalWord') }}</strong></template>
      </i18n-t>

      <button class="ok" @click="emit('close')">{{ t('scoring.ok') }}</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;
}
.modal {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 1.5rem; max-width: 390px; width: 100%; position: relative;
  box-shadow: var(--shadow); max-height: 90vh; overflow-y: auto;
}
.close {
  position: absolute; top: 0.5rem; right: 0.7rem; background: none; border: none;
  color: var(--muted); font-size: 1.6rem; cursor: pointer; line-height: 1;
}
h3 { margin-bottom: 0.7rem; color: var(--azure); text-align: center; }
.intro { font-size: 0.84rem; color: var(--text); margin-bottom: 0.9rem; }

.tabs { display: flex; gap: 0.3rem; margin-bottom: 0.6rem; }
.tabs button {
  flex: 1; background: transparent; border: 1px solid var(--line); color: var(--muted);
  padding: 0.45rem; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 0.85rem;
}
.tabs button.on { background: var(--azure); color: #04210f; border-color: var(--azure); }
.mode-desc { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.8rem; font-style: italic; }

.block {
  background: var(--bg); border: 1px solid var(--line); border-left: 3px solid var(--azure);
  border-radius: 10px; padding: 0.7rem 0.85rem; margin-bottom: 0.7rem;
}
.block.extra { border-left-color: var(--gold); }
.block h4 { color: var(--azure); font-size: 0.92rem; margin-bottom: 0.4rem; }
.block.extra h4 { color: var(--gold); }
.block p { font-size: 0.84rem; line-height: 1.4; }
.ej { color: var(--muted); font-style: italic; margin-top: 0.35rem; font-size: 0.78rem; }
.no-extra { font-size: 0.8rem; color: var(--muted); font-style: italic; margin-bottom: 0.7rem; }
.pts {
  display: inline-block; background: var(--azure); color: #04210f;
  font-weight: 800; border-radius: 6px; padding: 0.05rem 0.4rem; font-size: 0.82rem;
}
.block.extra .pts { background: var(--gold); color: #3a2e00; }
.rounds { list-style: none; margin: 0.4rem 0 0; }
.rounds li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.28rem 0; border-bottom: 1px dashed var(--line); font-size: 0.85rem;
}
.rounds li:last-child { border-bottom: none; }
.rounds li.big { font-weight: 800; }
.total-note {
  font-size: 0.83rem; background: var(--bg); border-radius: 10px;
  padding: 0.65rem; margin: 0.5rem 0 0.9rem; text-align: center;
}
.ok {
  width: 100%; background: var(--azure); color: #04210f; border: none;
  border-radius: 9px; padding: 0.7rem; font-weight: 800; cursor: pointer;
}
.ok:hover { filter: brightness(1.06); }
</style>
