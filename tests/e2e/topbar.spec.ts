// Regresión del header estándar (<dotrino-topbar>, CONVENCIONES §5/§6.1):
// que las piezas que la app dejó de mantener a mano sigan estando y funcionando.
import { test, expect } from '@playwright/test'

// El navegador de test corre en en-US: fijamos el idioma antes del primer render
// para que el estado inicial sea determinista.
async function gotoWithLang (page: any, lang: 'es' | 'en') {
  await page.addInitScript((l: string) => {
    localStorage.setItem('dotrino.lang', l)
    localStorage.removeItem('mundial.lang')
  }, lang)
  await page.goto('/')
}

test('topbar estándar: marca por slot, perfil, moneda y volver', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await gotoWithLang(page, 'es')
  const tb = page.locator('dotrino-topbar')
  await expect(tb).toBeVisible()

  // Piezas que ahora aporta el componente compartido.
  await expect(page.getByTestId('my-profile')).toBeVisible()
  await expect(tb.locator('dotrino-support')).toBeAttached()
  await expect(tb.locator('dotrino-back')).toBeAttached()
  // Marca propia (slot "brand") con su h1.
  await expect(page.locator('.brand h1')).toContainText('2026')
  await expect(page.locator('.brand .cup')).toContainText('Mundial')

  // Del header viejo no queda rastro.
  await expect(page.locator('header.scoreboard')).toHaveCount(0)
  await expect(page.getByTestId('lang-selector')).toHaveCount(0)
  await expect(page.getByTestId('identity-btn')).toHaveCount(0)

  // Sticky: va en el host (el .bar del componente no lo es).
  expect(await tb.evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
  // En web el chevron vive en el sidebar: el del topbar se oculta (::part(back)).
  expect(await tb.locator('dotrino-back').isVisible()).toBe(false)
  await expect(page.getByTestId('menu-btn')).toBeHidden() // barra lateral fija en web

  await page.screenshot({ path: '/tmp/claude-1000/-mnt-sda1-Dotrino/571f5467-018f-4c3f-bb0a-713757bac702/scratchpad/topbar-desktop.png', clip: { x: 0, y: 0, width: 1280, height: 160 } })
  expect(errors, 'errores de JS en la página').toEqual([])
})

test('móvil: la hamburguesa (slot trailing) abre el cajón y el chevron vuelve', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await gotoWithLang(page, 'es')
  await expect(page.getByTestId('menu-btn')).toBeVisible()
  expect(await page.locator('dotrino-topbar dotrino-back').isVisible()).toBe(true)
  await page.getByTestId('menu-btn').click()
  await expect(page.getByTestId('sb-sections')).toBeVisible()
  await page.screenshot({ path: '/tmp/claude-1000/-mnt-sda1-Dotrino/571f5467-018f-4c3f-bb0a-713757bac702/scratchpad/topbar-mobile.png' })
})

test('el toggle ES/EN del topbar traduce la app y persiste en dotrino.lang', async ({ page }) => {
  // Sin addInitScript: se fija el idioma UNA vez para que el reload lea lo
  // que realmente persistió el topbar (y no lo que reinyectaría el test).
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('dotrino.lang', 'es'))
  await page.reload()
  await expect(page.getByTestId('tab-grupos')).toContainText('Fase de grupos')
  await page.locator('dotrino-topbar').locator('button[data-lang="en"]').click()
  await expect(page.getByTestId('tab-grupos')).toContainText('Group stage')
  await expect(page.locator('.brand .cup')).toContainText('World Cup')
  expect(await page.evaluate(() => localStorage.getItem('dotrino.lang'))).toBe('en')
  await page.reload()
  await expect(page.getByTestId('tab-grupos')).toContainText('Group stage')
})

test('migración: la preferencia vieja mundial.lang pasa a dotrino.lang', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => { localStorage.removeItem('dotrino.lang'); localStorage.setItem('mundial.lang', 'en') })
  await page.reload()
  await expect(page.getByTestId('tab-grupos')).toContainText('Group stage')
  expect(await page.evaluate(() => localStorage.getItem('dotrino.lang'))).toBe('en')
  expect(await page.evaluate(() => localStorage.getItem('mundial.lang'))).toBeNull()
})

test('el botón de perfil abre el panel propio de la app, no el modal del topbar', async ({ page }) => {
  await gotoWithLang(page, 'es')
  await page.getByTestId('my-profile').click()
  // El panel de la app (perfil + contactos + rankings), no el modal del topbar:
  // el topbar cuelga el suyo como hijo DIRECTO de <body>.
  await expect(page.locator('#app .overlay .panel').first()).toBeVisible()
  expect(await page.locator('body > dotrino-profile').count()).toBe(0)
  await page.screenshot({ path: '/tmp/claude-1000/-mnt-sda1-Dotrino/571f5467-018f-4c3f-bb0a-713757bac702/scratchpad/profile-panel.png' })
})
