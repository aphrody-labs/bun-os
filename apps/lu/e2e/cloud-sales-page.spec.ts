import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('static cloud page renders locally and preserves source on the purchase link', async ({ page }) => {
  // Serve the exact static HTML and shared CSS without loading external sites.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'lu-docs.test') return route.abort()
    const path = url.pathname === '/cloud/' ? 'docs/cloud/index.html' : url.pathname === '/assets/lu.css' ? 'docs/assets/lu.css' : null
    if (!path) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(path) })
  })
  await page.goto('http://lu-docs.test/cloud/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use hosted models without buying a GPU')
  await expect(page.getByText('Hosted requests leave your machine', { exact: false })).toBeVisible()
  // 4d128954 hat den Knopf umbenannt und einen zweiten dazugestellt, der auf
  // die neue Preisseite zeigt. Gemeint ist hier weiter der Kaufknopf, also
  // der mit dem Herkunftszeichen an der Kasse.
  const cta = page.getByRole('link', { name: 'Check packs and estimated usage', exact: true })
  await expect(cta).toHaveAttribute('href', 'https://lu-labs.ai/pricing?tab=credits&src=luc')
  await cta.focus()
  await expect(cta).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
