// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

for (const slug of ['ollama-cloud', 'featherless', 'venice', 'chutes', 'infermatic', 'arliai', 'cerebras-code', 'backyard-ai', 'sillyhost']) {
  const html = readFileSync(`docs/vs/${slug}/index.html`, 'utf8')
  const page = new DOMParser().parseFromString(html, 'text/html')
  // Das Pruefdatum steht im Kopf der Seite und gilt fuer alle sechs Zellen.
  // Bis zum 13.09.2026 trug die ganze Serie den 09.09. Venice ist am
  // 14.09.2026 mit Commit 01d26e81 neu veroeffentlicht worden, mit dem
  // Abschnitt "Which offer fits?" und dem sichtbaren Satz "Venice pricing,
  // checked September 14, 2026"; seitdem traegt diese eine Seite den 14.09.
  // Ein fuer alle neun Seiten fest getipptes Datum wuerde jede Nachpruefung
  // rot faerben und zum Zurueckdatieren zwingen, was ein Pruefdatum nie
  // darf. Gehalten wird darum: ein Datum je Seite, nicht aelter als der
  // Serienstart, und in jeder der sechs Zellen dasselbe wie im Kopf.
  it(`${slug} dates and sources every comparative fact on both sides`, () => {
    const checked = page.querySelector('time')?.getAttribute('datetime')
    expect(checked, `${slug} nennt kein Pruefdatum`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(checked! >= '2026-09-09', `${slug} ist zurueckdatiert: ${checked}`).toBe(true)
    const rows = page.querySelectorAll('[data-comparison-row]')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.querySelectorAll('td')).toHaveLength(2)
      for (const cell of row.querySelectorAll('td')) {
        expect(cell.querySelector('time')?.getAttribute('datetime')).toBe(checked)
        expect(cell.querySelector('a')?.getAttribute('href')).toMatch(/^https:\/\//)
      }
    }
    expect(html).not.toMatch(/[\u2013\u2014]/u)
    expect(page.querySelectorAll('script')).toHaveLength(0)
  })
  it(`${slug} is linked, canonical and sends LU purchase links with src=luc`, () => {
    expect(readFileSync('docs/alternatives/index.html', 'utf8')).toContain(`href="/vs/${slug}/"`)
    expect(readFileSync('docs/sitemap.xml', 'utf8')).toContain(`<loc>https://locallyuncensored.com/vs/${slug}/</loc>`)
    expect(page.querySelector('[rel="canonical"]')?.getAttribute('href')).toBe(`https://locallyuncensored.com/vs/${slug}/`)
    for (const a of page.querySelectorAll('a[href^="https://lu-labs.ai/pricing"]')) {
      expect(new URL(a.getAttribute('href')!).searchParams.get('src')).toBe('luc')
    }
  })
}

it('SillyHost separates promotional hosting prices, provider credit and instance resources', () => {
  const page = new DOMParser().parseFromString(readFileSync('docs/vs/sillyhost/index.html', 'utf8'), 'text/html')
  const cells = [...page.querySelectorAll('[data-comparison-row] td:first-of-type')]
  expect(cells[0].textContent).toContain('limited-time welcome-back offer')
  expect(cells[0].textContent).toContain('Confirm eligibility and renewal pricing')
  expect(cells[1].textContent).toContain('USD 5/month of OpenRouter credit')
  expect(cells[1].textContent).toContain('not an unlimited inference allowance')
  expect(cells[2].textContent).toContain('not model VRAM, context size')
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|guaranteed privacy/i)
})

it('Backyard AI scopes unlimited messages to the app and qualifies context ceilings', () => {
  const page = new DOMParser().parseFromString(readFileSync('docs/vs/backyard-ai/index.html', 'utf8'), 'text/html')
  const cells = [...page.querySelectorAll('[data-comparison-row] td:first-of-type')]
  expect(cells[0].textContent).toContain('USD 12 for Standard and USD 35 for Pro')
  expect(cells[1].textContent).toContain('300 messages per week for Free')
  expect(cells[1].textContent).toContain('not evidence of an unlimited developer API')
  expect(cells[2].textContent).toContain('16,384 tokens for Standard and 100,000 for Pro')
  expect(cells[2].textContent).toContain('do not establish identical context support')
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|guaranteed privacy/i)
})

it('Cerebras separates historical Code offers from current API tiers and limits', () => {
  const page = new DOMParser().parseFromString(readFileSync('docs/vs/cerebras-code/index.html', 'utf8'), 'text/html')
  const cells = [...page.querySelectorAll('[data-comparison-row] td:first-of-type')]
  expect(cells[0].textContent).toContain('historical launch prices, not a verified current offer')
  expect(cells[0].textContent).toContain('Code availability is not established')
  expect(cells[1].textContent).toContain('verified payment method')
  expect(cells[1].textContent).toContain('expire after 30 days')
  expect(cells[2].textContent).toContain('minute limits and the available budget still apply')
  expect(cells[2].querySelector('a')!.getAttribute('href')).toBe('https://inference-docs.cerebras.ai/support/rate-limits')
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|all plans are sold out|unlimited API/i)
})

it('Venice distinguishes recurring credits, app allowances and metered API usage', () => {
  const html = readFileSync('docs/vs/venice/index.html', 'utf8')
  const page = new DOMParser().parseFromString(html, 'text/html')
  const rows = [...page.querySelectorAll('[data-comparison-row]')]
  expect(rows[0].querySelector('td')!.textContent).toContain('USD 18 and includes 100 monthly credits')
  expect(rows[1].querySelector('td')!.textContent).toContain('Premium features')
  expect(rows[1].querySelector('td')!.textContent).toContain('consume credits')
  expect(rows[2].querySelector('td')!.textContent).toContain('API requests are metered separately')
  expect(rows[2].querySelector('td:last-child')!.textContent).toContain('not API keys')
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|mobile only|Trustpilot|one-time \$10/i)
})

it('Chutes scopes workload restrictions to subscriptions and separates request and spend caps', () => {
  const page = new DOMParser().parseFromString(readFileSync('docs/vs/chutes/index.html', 'utf8'), 'text/html')
  const cells = [...page.querySelectorAll('[data-comparison-row] td:first-of-type')]
  expect(cells[0].textContent).toContain('equivalent PAYGO usage')
  expect(cells[1].textContent).toContain('2,000 and 5,000 API requests daily')
  expect(cells[1].textContent).toContain('USD 4.17 and USD 8.33')
  expect(cells[1].textContent).toContain('automatically use PAYGO billing')
  expect(cells[2].textContent).toContain('low-volume API traffic')
  expect(cells[2].textContent).toContain('must use PAYGO')
  expect(cells[2].querySelector('a')!.getAttribute('href')).toBe('https://chutes.ai/terms')
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|all API usage is banned/i)
})

it('Infermatic does not conflate UI response limits with API limits or premium credits', () => {
  const page = new DOMParser().parseFromString(readFileSync('docs/vs/infermatic/index.html', 'utf8'), 'text/html')
  const cells = [...page.querySelectorAll('[data-comparison-row] td:first-of-type')]
  expect(cells[0].textContent).toContain('12, 15 and 18 requests per minute')
  expect(cells[1].textContent).toContain('2,048 under UI Token Responses')
  expect(cells[1].textContent).toContain('does not establish a universal')
  expect(cells[2].textContent).toContain('separate keys and base URLs')
  expect(cells[2].textContent).toContain('without rollover')
  expect(cells[2].textContent).toContain('included Core models remain available')
  expect(cells[2].querySelector('a')!.getAttribute('href')).toBe('https://ui.infermatic.ai/docs')
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|all API responses are capped/i)
})

it('Arli AI distinguishes tier concurrency, context ceilings and model behavior', () => {
  const page = new DOMParser().parseFromString(readFileSync('docs/vs/arliai/index.html', 'utf8'), 'text/html')
  const cells = [...page.querySelectorAll('[data-comparison-row] td:first-of-type')]
  expect(cells[0].textContent).toContain('Starter lists models up to 31B')
  expect(cells[1].textContent).toContain('Pro allows two and Max six')
  expect(cells[1].textContent).toContain('16,384, 32,768, 131,072, 262,144 and 524,288')
  expect(cells[1].textContent).toContain('does not establish every model')
  expect(cells[2].textContent).toContain('load-balancing adjustments')
  expect(cells[2].textContent).toContain('LoRA variants can behave differently')
  expect(cells[2].querySelectorAll('a')).toHaveLength(2)
  expect(page.body.textContent).not.toMatch(/cheapest|cheaper than|best value|only Max allows parallel/i)
})
