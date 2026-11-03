/**
 * Die drei Hellmodus-Luecken, die f336b91e offen liess, und warum es sie
 * mit dem M3-Schema nicht mehr geben kann.
 *
 * Der Commit hat den Welle-2-Posten „Light-Mode-Luecken" groesstenteils
 * erledigt und drei Stellen ausdruecklich GEMELDET statt geaendert:
 * `ProviderConfig.tsx` (Add-Provider-Dropdown), `UpdateBadge.tsx` und das
 * QR-Modal in `Sidebar.tsx`. Die Ursache war an allen drei Stellen
 * zweiteilig:
 *
 *   1. Die Flaeche war ein Hex-Literal OHNE `dark:`, blieb im Hellmodus
 *      also dunkel.
 *   2. Ein Rescue-Layer in index.css drehte die Schrift DARIN gleichzeitig
 *      nach unten, weil er annahm, unter `.light` sei der Grund hell.
 *
 * Beides zusammen ergab dunkle Schrift auf dunkler Flaeche (1,17:1).
 *
 * Seit dem M3-Schema gibt es den Rescue-Layer nicht mehr: Flaeche und
 * Schrift sind Rollen desselben generierten Schemas (surface-container und
 * on-surface, error, success), und beide wechseln GEMEINSAM mit `.light` /
 * `.dark`. Dieser Test haelt fest, dass der Layer weg bleibt, und rechnet
 * den Kontrast der Statusrollen aus den ausgelieferten Werten nach.
 *
 * Run: npx vitest run src/components/__tests__/hellmodus-restluecken.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrast } from './wcag-contrast'
import { FLAECHEN, INDEX_CODE, SCHEMES, rolle } from './m3-rollen'

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8')

/**
 * Kommentare raus, bevor gescannt wird. Die Begruendungen im Quelltext
 * ZITIEREN die alten Klassen, damit der naechste Leser weiss, was da stand.
 */
function ohneKommentare(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

const PROVIDER = read('../settings/ProviderConfig.tsx')
const BADGE = read('../layout/UpdateBadge.tsx')
const SIDEBAR = read('../layout/Sidebar.tsx')

describe('der Rescue-Layer ist weg und kommt nicht wieder', () => {
  it('index.css dreht keine Palettenklasse mehr modusabhaengig um', () => {
    // Genau die Regeln, die dunkle Schrift auf dunkle Flaechen legten.
    expect(INDEX_CODE).not.toMatch(/\.(light|dark) \.(hover\\:)?text-(gray|white)/)
    expect(INDEX_CODE).not.toMatch(/\.(light|dark) \.(hover\\:|focus\\:)?(bg|border)-white/)
    expect(INDEX_CODE).not.toMatch(/\.light \.lu-on-dark/)
  })

  it('index.css schreibt ueberhaupt keine Farbe als Literal', () => {
    expect(INDEX_CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
  })
})

describe('die Statusrollen tragen in BEIDEN Modi auf jeder Flaeche', () => {
  it.each(SCHEMES)('%s: error, success und primary erreichen 4,5:1 auf jeder Flaechenrolle', (_name, scheme) => {
    for (const r of ['error', 'success', 'primary', 'on-surface', 'on-surface-variant']) {
      for (const f of FLAECHEN) {
        expect(contrast(rolle(scheme, r), rolle(scheme, f)), `${r} auf ${f}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(SCHEMES)('%s: der Passcode (on-surface) ist der staerkste Kontrast im Modal', (_name, scheme) => {
    const auf = rolle(scheme, 'surface-container-high')
    const passcode = contrast(rolle(scheme, 'on-surface'), auf)
    for (const r of ['error', 'success', 'primary', 'on-surface-variant']) {
      expect(passcode, r).toBeGreaterThan(contrast(rolle(scheme, r), auf))
    }
  })
})

// ── Und jetzt: steht das auch wirklich so im Quelltext? ──────────────

/** Der Abschnitt, den diese Welle in ProviderConfig angefasst hat. */
const PROVIDER_DROPDOWN = PROVIDER.slice(
  PROVIDER.indexOf('{/* Add Provider Dropdown */}'),
  PROVIDER.indexOf('{/* Cloud privacy warning popup */}'),
)
/** Das QR-Modal in der Sidebar, ab seinem Key bis zum Dateiende. */
const QR_MODAL = SIDEBAR.slice(SIDEBAR.indexOf('key="qr-modal"'))

const REGIONEN: Array<[string, string]> = [
  ['ProviderConfig, Add-Provider-Dropdown', PROVIDER_DROPDOWN],
  ['UpdateBadge, ganze Datei', BADGE],
  ['Sidebar, QR-Modal', QR_MODAL],
]

describe('die drei Abschnitte, die dieser Test liest, existieren', () => {
  it.each(REGIONEN)('%s ist nicht leer', (_name, region) => {
    expect(region.length).toBeGreaterThan(400)
  })
})

describe('keine Hex-Flaeche ohne Modus mehr', () => {
  it.each(REGIONEN)('%s: jede Hex-Flaeche ist modus-bewusst', (name, region) => {
    const offenders: string[] = []
    for (const m of ohneKommentare(region).matchAll(/(\S*?)bg-\[(#[0-9a-fA-F]{3,8})\]/g)) {
      if (m[1].includes('dark:')) continue
      offenders.push(m[0])
    }
    expect(offenders, name).toEqual([])
  })

  it('die Flaechen sind die gemeinsamen Blatt-Rezepte, keine zweiten Literale', () => {
    expect(PROVIDER_DROPDOWN).toContain('lu-elevated')
    expect(BADGE).toContain('lu-elevated')
    expect(QR_MODAL).toContain('lu-dialog')
  })
})

describe('kein dunkelmodus-only Akzent mehr in diesen Abschnitten', () => {
  // Ein `text-emerald-400` OHNE `dark:` ist auf einer hellen Flaeche 1,92:1.
  const AKZENT = /(^|[\s'"`])(?:hover:)?(?:text|bg)-(?:emerald|green|amber|red|blue|purple)-(?:300|400)\b/g

  it.each(REGIONEN)('%s: jeder 300/400-Akzent hat ein Hell-Pendant', (name, region) => {
    const offenders = [...ohneKommentare(region).matchAll(AKZENT)].map((m) => m[0].trim())
    expect(offenders, `${name}: Akzent ohne dark:`).toEqual([])
  })

  it('die Zustaende tragen wirklich eine Farbe, die beiden Modi folgt', () => {
    // Negativkontrolle zur Regel darueber: sie waere auch gruen, wenn
    // jemand die Akzente ersatzlos loeschte. Gemeint ist die Rolle
    // (success, error), oder bis zur Umstellung das Paar aus Hell und Dunkel.
    expect(PROVIDER_DROPDOWN).toMatch(/\btext-success\b|text-green-700 dark:text-green-400/)
    expect(BADGE).toMatch(/\btext-success\b|text-emerald-700 dark:text-emerald-400/)
    expect(BADGE).toMatch(/\bbg-success\b|bg-emerald-600 dark:bg-emerald-400/)
    expect(QR_MODAL).toMatch(/\btext-error\b|text-red-700 dark:text-red-400/)
    expect(QR_MODAL).toMatch(/\btext-success\b|text-green-700 dark:text-green-400/)
  })
})

describe('kein Gelb mehr, auch nicht als Schmuck', () => {
  // Bis zum 04.09.2026 war Gelb der Sammelplatz fuer alles zwischen gut und
  // kaputt, und genau deshalb sagte es nichts. `lib/hinweis.ts` kennt seither
  // zwei Toene, ruhig und fehler.
  it.each(REGIONEN)('%s: kein amber und kein yellow', (name, region) => {
    const treffer = [...ohneKommentare(region).matchAll(/(?:amber|yellow)-\d{2,3}/g)].map((m) => m[0])
    expect(treffer, name).toEqual([])
  })

  it('und auch nicht im Rest der Sidebar, wo der zweite Passcode steht', () => {
    expect(ohneKommentare(SIDEBAR)).not.toMatch(/(?:amber|yellow)-\d{2,3}/)
    // Der Passcode ist ein Wert, kein Zustand: der staerkste Kontrast.
    expect(SIDEBAR).toMatch(/text-on-surface font-mono|text-gray-900 dark:text-white font-mono/)
  })
})
