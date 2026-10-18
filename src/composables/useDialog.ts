// Diálogos propios de la app en lugar de alert()/confirm()/prompt() del
// navegador (CONVENCIONES §5: bloqueantes, sin estilo, sin traducir). El estado
// vive a nivel de módulo para que cualquier componente pueda abrir un diálogo y
// App.vue lo pinte una sola vez (overlay + .warn-modal, el mismo patrón que los
// avisos de incompleto / cambio de sección; .invite-toast para los mensajes).
import { ref } from 'vue'

export interface ToastMsg { id: number; text: string }

export interface DialogState {
  kind: 'confirm' | 'prompt'
  message: string
  // Solo para `prompt`: valor inicial del campo de texto.
  value: string
  resolve: (result: string | boolean | null) => void
}

const toasts = ref<ToastMsg[]>([])
const dialog = ref<DialogState | null>(null)
let seq = 0

// Mensaje no bloqueante que se va solo (reemplaza a alert()).
export function notify (text: string, ms = 6000): void {
  const id = ++seq
  toasts.value.push({ id, text })
  setTimeout(() => dismissToast(id), ms)
}

export function dismissToast (id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

// Pregunta sí/no (reemplaza a confirm()). Resuelve false al cancelar o cerrar.
export function ask (message: string): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.value?.resolve(dialog.value.kind === 'prompt' ? null : false)
    dialog.value = { kind: 'confirm', message, value: '', resolve: (r) => resolve(r === true) }
  })
}

// Pide un texto (reemplaza a prompt()). Resuelve null al cancelar o cerrar.
export function askText (message: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.value?.resolve(dialog.value.kind === 'prompt' ? null : false)
    dialog.value = { kind: 'prompt', message, value: initial, resolve: (r) => resolve(typeof r === 'string' ? r : null) }
  })
}

// Cierra el diálogo abierto entregando el resultado a quien preguntó.
export function settleDialog (result: string | boolean | null): void {
  const d = dialog.value
  if (!d) return
  dialog.value = null
  d.resolve(result)
}

export function useDialog () {
  return { toasts, dialog, notify, dismissToast, ask, askText, settleDialog }
}
