import { test, expect, type Page } from '@playwright/test'

// Tests de las funciones nuevas: selector de tipo al crear, clonar a otro tipo
// y aviso de pronóstico incompleto al compartir. No dependen del vault de
// identidad (id.dotrino.com) ni de red: el aviso aparece ANTES de firmar.

async function newPrediction (page: Page, mode: 'manual' | 'winlose' | 'score'): Promise<void> {
  await page.goto('/')
  const menu = page.getByTestId('menu-btn')
  if (await menu.isVisible()) await menu.click()
  await page.getByTestId('sb-new').click()
  await page.getByTestId('type-picker').waitFor()
  // El selector tiene 2 pasos: modo y luego alcance. 'all' (grupos + llaves)
  // reproduce el pronóstico completo del flujo previo.
  await page.getByTestId('type-' + mode).click()
  await page.getByTestId('scope-all').click()
}

test('crear pide el tipo y queda fijo (Completo abre Resultados)', async ({ page }) => {
  await newPrediction(page, 'score')
  // En modo con marcador existe la pestaña Resultados.
  await expect(page.getByTestId('tab-resultados')).toBeVisible()
  // El selector de modo ya no permite cambiar el tipo: no hay botones de modo.
  await expect(page.getByTestId('mode-winlose')).toHaveCount(0)
})

test('clonar a otro tipo crea un nuevo pronóstico con ese tipo', async ({ page }) => {
  await newPrediction(page, 'manual')
  // En Simple no hay pestaña Resultados.
  await expect(page.getByTestId('tab-resultados')).toHaveCount(0)

  // Clonar a Completo desde las acciones de la barra (modo + alcance).
  await page.getByTestId('bar-clone').click()
  await page.getByTestId('type-picker').waitFor()
  await page.getByTestId('type-score').click()
  await page.getByTestId('scope-all').click()

  // El clon (Completo) queda activo: aparece la pestaña Resultados.
  await expect(page.getByTestId('tab-resultados')).toBeVisible()
  // Hay al menos 2 pronósticos propios en la barra lateral (original + clon).
  const mine = page.getByTestId('sb-section-mine').getByTestId('pred-item')
  await expect(mine).toHaveCount(2)
})

test('avisa al compartir un pronóstico incompleto (no bloquea)', async ({ page }) => {
  await newPrediction(page, 'manual')
  // Pronóstico recién creado: sin llaves decididas → incompleto.
  await page.getByTestId('bar-share').click()
  // Sale el modal de advertencia (antes de firmar/compartir).
  await expect(page.getByTestId('warn-incomplete')).toBeVisible()
  // Se puede cancelar.
  await page.getByTestId('warn-incomplete').getByText(/cancelar|cancel/i).click()
  await expect(page.getByTestId('warn-incomplete')).toHaveCount(0)
})
