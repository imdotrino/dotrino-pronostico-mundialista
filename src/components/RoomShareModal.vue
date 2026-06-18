<script setup lang="ts">
// Invitar a una sala: usa el Web Component COMPARTIDO del ecosistema
// (<dotrino-share>), el mismo modal que cuarenta y ajedrez. Aquí solo se
// arma la URL de invitación (firmada, con la sala en el #fragment) y se delega
// el QR / copiar / redes al componente común.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildRoomInviteUrl } from '../lib/room'
import { useRooms } from '../composables/useRooms'
import '@dotrino/share'

const { t, locale } = useI18n()
const { activeRoom, roomShareOpen } = useRooms()

const url = ref('')

watch(roomShareOpen, async (open) => {
  if (!open) { url.value = ''; return }
  const room = activeRoom.value
  if (!room) { url.value = ''; return }
  try {
    const { url: u } = await buildRoomInviteUrl({
      id: room.id, name: room.name, mode: room.mode, scope: room.scope ?? 'free', sealedUntil: room.sealedUntil, createdAt: room.createdAt, daily: room.daily,
    })
    url.value = u
  } catch { url.value = '' }
})

const theme = {
  '--ccs-bg': 'var(--panel)', '--ccs-text': 'var(--text)', '--ccs-muted': 'var(--muted)',
  '--ccs-border': 'var(--line)', '--ccs-accent': 'var(--green)', '--ccs-accent-text': '#fff',
  '--ccs-input-bg': 'var(--bg)',
}
</script>

<template>
  <dotrino-share
    :lang="locale"
    :style="theme"
    :url="url"
    :text="activeRoom?.name || t('rooms.invite')"
    :heading="activeRoom?.name || t('common.share')"
    :hint="t('rooms.invite')"
    :open="roomShareOpen"
    @cc-share-close="roomShareOpen = false"
  ></dotrino-share>
</template>
