<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Room, RoomMember } from '../lib/roomStore'
import { isMemberSealed } from '../lib/roomStore'
import type { SavedPrediction } from '../lib/store'
import { decodePrediction } from '../lib/codec'
import { champion, resolveMatches, type Prediction } from '../lib/prediction'
import { FINAL } from '../lib/bracket'
import { GROUPS, teamById } from '../lib/teams'

const { t } = useI18n()

const props = defineProps<{
  room: Room
  official: SavedPrediction | null
  myPubkey: string | null
}>()

type Dim = 'final' | 'groups'
const dim = ref<Dim>('final')

function decode (code: string): Prediction | null {
  try { return decodePrediction(code) } catch { return null }
}

interface MemberCol {
  member: RoomMember
  sealed: boolean
  isMe: boolean
  champ: number | null
  finalists: (number | null)[]
  groupWinners: (number | null)[]
}

// Valores oficiales (para resaltar aciertos), si hay resultados cargados.
const official = computed(() => {
  if (!props.official?.code) return null
  const p = decode(props.official.code)
  if (!p) return null
  const rm = resolveMatches(p).get(FINAL.num)
  return {
    champ: champion(p),
    finalists: [rm?.home ?? null, rm?.away ?? null],
    groupWinners: p.groupOrder.map((g) => g[0] ?? null),
  }
})

const cols = computed<MemberCol[]>(() =>
  props.room.members.filter((m) => !m.deleted).map((m) => {
    const sealed = isMemberSealed(props.room, m, props.myPubkey)
    const p = sealed ? null : decode(m.code)
    const rm = p ? resolveMatches(p).get(FINAL.num) : undefined
    return {
      member: m, sealed, isMe: m.publickey === props.myPubkey,
      champ: p ? champion(p) : null,
      finalists: [rm?.home ?? null, rm?.away ?? null],
      groupWinners: p ? p.groupOrder.map((g) => g[0] ?? null) : new Array(12).fill(null),
    }
  }),
)

function team (id: number | null) {
  if (id == null) return null
  try { return teamById(id) } catch { return null }
}
function isCorrect (officialId: number | null | undefined, id: number | null): boolean {
  return officialId != null && id != null && officialId === id
}
</script>

<template>
  <div class="cmp">
    <div class="dims">
      <button :class="{ on: dim === 'final' }" @click="dim = 'final'">{{ t('rooms.dimFinal') }}</button>
      <button :class="{ on: dim === 'groups' }" @click="dim = 'groups'">{{ t('rooms.dimGroups') }}</button>
    </div>

    <p v-if="!cols.length" class="empty">{{ t('rooms.noMembers') }}</p>

    <div v-else class="scroll">
      <table class="tbl">
        <thead>
          <tr>
            <th class="row-h">{{ t('rooms.member') }}</th>
            <template v-if="dim === 'final'">
              <th>🏆 {{ t('rooms.champion') }}</th>
              <th>{{ t('rooms.finalist') }} 1</th>
              <th>{{ t('rooms.finalist') }} 2</th>
            </template>
            <template v-else>
              <th v-for="g in GROUPS" :key="g.letter" class="grp">{{ g.letter }}</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cols" :key="c.member.publickey" :class="{ me: c.isMe }">
            <td class="row-h">
              {{ c.member.nickname || t('common.anonymous') }}
              <span v-if="c.isMe" class="you">{{ t('rooms.you') }}</span>
              <span v-if="c.member.name" class="pname">· {{ c.member.name }}</span>
            </td>
            <template v-if="c.sealed">
              <td :colspan="dim === 'final' ? 3 : 12" class="sealed">🔒 {{ t('rooms.sealedCell') }}</td>
            </template>
            <template v-else-if="dim === 'final'">
              <td :class="{ hit: isCorrect(official?.champ, c.champ) }">
                <span v-if="team(c.champ)">{{ team(c.champ)!.flag }} {{ team(c.champ)!.code }}</span><span v-else class="dash">—</span>
              </td>
              <td v-for="(f, i) in c.finalists" :key="i" :class="{ hit: official && official.finalists.includes(f) && f != null }">
                <span v-if="team(f)">{{ team(f)!.flag }} {{ team(f)!.code }}</span><span v-else class="dash">—</span>
              </td>
            </template>
            <template v-else>
              <td v-for="(w, g) in c.groupWinners" :key="g" class="grp" :class="{ hit: isCorrect(official?.groupWinners[g], w) }">
                <span v-if="team(w)">{{ team(w)!.flag }}</span><span v-else class="dash">·</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint">{{ t('rooms.compareHint') }}</p>
  </div>
</template>

<style scoped>
.cmp { padding: 0.2rem 0; }
.dims { display: flex; gap: 0.4rem; margin-bottom: 0.7rem; }
.dims button { background: transparent; border: 1px solid var(--line); color: var(--muted); padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 0.8rem; }
.dims button.on { background: var(--panel-2); color: var(--text); border-color: var(--azure); }
.empty { color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 0.6rem 0; }
.scroll { overflow-x: auto; }
.tbl { border-collapse: collapse; font-size: 0.82rem; }
.tbl th, .tbl td { padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--line-soft); white-space: nowrap; text-align: center; }
.tbl th { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--line); }
.row-h { text-align: left; font-weight: 700; position: sticky; left: 0; background: var(--panel); }
.grp { padding: 0.4rem 0.3rem; }
.you { font-size: 0.6rem; background: var(--azure); color: #042038; border-radius: 5px; padding: 0 0.25rem; font-weight: 800; margin-left: 0.3rem; }
.pname { font-size: 0.74rem; color: var(--muted); font-weight: 400; }
.hit { background: rgba(78, 222, 128, 0.16); color: var(--green); font-weight: 700; }
.dash { color: var(--muted); }
.sealed { color: var(--gold); font-style: italic; }
.me .row-h { background: rgba(65, 180, 255, 0.12); }
.hint { font-size: 0.76rem; color: var(--muted); margin-top: 0.6rem; }
</style>
