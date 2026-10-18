import { test, expect, type Page } from '@playwright/test'

// Los diálogos son de la app, no del navegador (CONVENCIONES §5): confirmar, pedir un
// texto y avisar se pintan con el overlay propio. Un `dialog` nativo aquí es un fallo.

async function newPrediction (page: Page): Promise<void> {
  await page.goto('/')
  const menu = page.getByTestId('menu-btn')
  if (await menu.isVisible()) await menu.click()
  await page.getByTestId('sb-new').click()
  await page.getByTestId('type-picker').waitFor()
  await page.getByTestId('type-manual').click()
  await page.getByTestId('scope-all').click()
}

test('renombrar y borrar usan los diálogos de la app, nunca prompt()/confirm()', async ({ page }) => {
  page.on('dialog', (d) => { throw new Error('native dialog opened: ' + d.type()) })
  await newPrediction(page)
  const menu = page.getByTestId('menu-btn')
  if (await menu.isVisible()) await menu.click()

  // Renombrar: modal con campo de texto; Enter acepta.
  await page.getByTestId('pred-rename').first().click()
  await expect(page.getByTestId('prompt-modal')).toBeVisible()
  await page.getByTestId('prompt-input').fill('Mi quiniela')
  await page.getByTestId('dialog-ok').click()
  await expect(page.getByTestId('prompt-modal')).toHaveCount(0)
  await expect(page.getByTestId('pred-item').first()).toContainText('Mi quiniela')

  // Borrar: cancelar no borra; aceptar sí.
  const before = await page.getByTestId('pred-item').count()
  await page.getByTestId('pred-delete').first().click()
  await expect(page.getByTestId('confirm-modal')).toBeVisible()
  await page.getByTestId('dialog-cancel').click()
  await expect(page.getByTestId('confirm-modal')).toHaveCount(0)
  await expect(page.getByTestId('pred-item')).toHaveCount(before)
  await page.getByTestId('pred-delete').first().click()
  await page.getByTestId('dialog-ok').click()
  await expect(page.getByTestId('pred-item')).toHaveCount(before - 1)
})

test('una invitación inválida avisa con un toast propio', async ({ page }) => {
  page.on('dialog', (d) => { throw new Error('native dialog opened: ' + d.type()) })
  await page.goto('/#room=NO-ES-UNA-INVITACION')
  await expect(page.getByTestId('app-toast')).toBeVisible({ timeout: 15000 })
  await page.getByTestId('app-toast-close').click()
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})
