import { test, expect, type Page } from '@playwright/test'

// Smoke tests de UI. No dependen de firmar/compartir/QR/identidad (usan el vault
// id.dotrino.com por red; no fiable headless), ni de PDF.

// En un arranque limpio el único pronóstico es el "oficial" (solo lectura, modo
// marcador), que oculta la barra de modo y abre en "Resultados". Creamos uno
// propio editable para los smoke tests.
// El tipo (modo) se elige al crear con el selector de tipo y queda fijo.
// mode: 'manual' | 'winlose' | 'score'.
async function createOwnPrediction (page: Page, mode: 'manual' | 'winlose' | 'score' = 'manual'): Promise<void> {
  await page.goto('/')
  // El botón de menú solo se ve en viewport angosto; en desktop el cajón está
  // siempre visible. Abrimos el menú si hace falta.
  const menu = page.getByTestId('menu-btn')
  if (await menu.isVisible()) await menu.click()
  await page.getByTestId('sb-new').click()
  await page.getByTestId('type-picker').waitFor()
  // El selector tiene 2 pasos: modo y luego alcance. 'all' (grupos + llaves)
  // reproduce el pronóstico completo del flujo previo.
  await page.getByTestId('type-' + mode).click()
  await page.getByTestId('scope-all').click()
}

test('la app carga y muestra las pestañas Grupos y Llaves', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('tab-groups')).toBeVisible()
  await expect(page.getByTestId('tab-bracket')).toBeVisible()
})

test('el tipo elegido al crear define si hay pestaña Resultados', async ({ page }) => {
  // Simple (manual): no existe la pestaña Resultados.
  await createOwnPrediction(page, 'manual')
  await expect(page.getByTestId('tab-results')).toHaveCount(0)

  // Medio (winlose): aparece la pestaña Resultados.
  await createOwnPrediction(page, 'winlose')
  await expect(page.getByTestId('tab-results')).toBeVisible()

  // Completo (score): también tiene Resultados.
  await createOwnPrediction(page, 'score')
  await expect(page.getByTestId('tab-results')).toBeVisible()
})

test('cambiar de pestaña funciona', async ({ page }) => {
  await createOwnPrediction(page, 'manual')

  await expect(page.getByTestId('zone-groups')).toBeVisible()

  await page.getByTestId('tab-bracket').click()
  await expect(page.getByTestId('zone-bracket')).toBeVisible()
  await expect(page.getByTestId('zone-groups')).not.toBeVisible()

  await page.getByTestId('tab-groups').click()
  await expect(page.getByTestId('zone-groups')).toBeVisible()
})
