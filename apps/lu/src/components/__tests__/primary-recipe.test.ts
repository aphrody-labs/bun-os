/**
 * Das Primaer-Rezept `.lu-primary` und die Hellmodus-Zusicherungen dazu.
 *
 * Warum als Test und nicht als Sichtpruefung: die Testumgebung ist
 * `environment: 'node'` ohne DOM, also kann hier nichts gerendert werden.
 * Was sich aber OHNE DOM pruefen laesst, ist die Eigenschaft, um die es
 * eigentlich geht: das Rezept nennt die M3-Rollen primary und on-primary,
 * und deren Werte aus dem generierten Schema erreichen den WCAG-Kontrast in
 * hell UND dunkel. Gerechnet wird gegen die ausgelieferten Werte, nicht
 * gegen abgeschriebene Zahlen.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrast } from './wcag-contrast'
import { FLAECHEN, INDEX_CODE as css, SCHEMES, regel, rolle, rollenIn } from './m3-rollen'

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8')

describe('Kontrastfunktion (Referenzwerte aus der WCAG-Spec)', () => {
  it('rechnet die bekannten Eckwerte richtig', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // Symmetrisch: die Reihenfolge der Argumente darf nichts aendern.
    expect(contrast('#a094f8', '#111827')).toBeCloseTo(contrast('#111827', '#a094f8'), 10)
  })
})

describe('Primaer-Rezept: die Rollen primary und on-primary', () => {
  it('das Rezept liest primary als Flaeche und Kante, on-primary als Text', () => {
    const body = regel('.lu-primary')
    expect(body).toMatch(/background-color:\s*var\(--md-sys-color-primary\)/)
    expect(body).toMatch(/\bcolor:\s*var\(--md-sys-color-on-primary\)/)
    expect(body).toMatch(/border:\s*1px solid var\(--md-sys-color-primary\)/)
  })

  it.each(SCHEMES)('%s: Text auf primary erreicht WCAG AA (4.5:1)', (_name, scheme) => {
    expect(contrast(rolle(scheme, 'primary'), rolle(scheme, 'on-primary'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SCHEMES)('%s: die Flaeche steht auf jeder Flaeche der App fuer sich (3:1, 1.4.11)', (_name, scheme) => {
    for (const f of FLAECHEN) expect(contrast(rolle(scheme, 'primary'), rolle(scheme, f)), f).toBeGreaterThanOrEqual(3)
  })

  it('Hover ist die 8-%-Zustandsschicht von on-primary ueber primary, kein eigener Ton', () => {
    const hover = regel('.lu-primary:hover:not(:disabled)')
    expect(hover).toContain('color-mix(in srgb, var(--md-sys-color-primary), var(--md-sys-color-on-primary) 8%)')
  })
})

describe('Primaer-Rezept: genau einmal definiert', () => {
  it('.lu-primary hat genau eine Basisregel in index.css', () => {
    const base = css.match(/^\.lu-primary\s*\{/gm) ?? []
    expect(base).toHaveLength(1)
  })

  it('das Rezept nennt keine Farbe als Literal, nur Rollen', () => {
    const body = regel('.lu-primary')
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/)
    expect(rollenIn(body)).toEqual(['primary', 'on-primary', 'primary'])
  })

  it('deckt Hover, Fokus und disabled ab, nicht nur die Ruhefarbe', () => {
    expect(css).toMatch(/\.lu-primary:hover:not\(:disabled\)\s*\{/)
    expect(css).toMatch(/\.lu-primary:focus-visible\s*\{/)
    expect(css).toMatch(/\.lu-primary:disabled\s*\{/)
  })

  it('der Fokusring ist der M3-Ring und liegt neben der Flaeche, in beiden Modi derselbe', () => {
    const focus = regel('.lu-primary:focus-visible')
    expect(focus).toMatch(/outline:\s*2px solid var\(--md-sys-color-secondary\)/)
    // Abstand > 0, damit der Ring auf dem Hintergrund liegt und nicht auf primary.
    expect(focus).toMatch(/outline-offset:\s*[1-9]/)
    // Kein Modus braucht eine eigene Ringfarbe: die Rolle wechselt mit dem Schema.
    expect(css).not.toMatch(/\.(dark|light) \.lu-primary/)
  })

  it.each(SCHEMES)('%s: der Ring haelt 3:1 auf jeder Flaeche', (_name, scheme) => {
    for (const f of FLAECHEN) expect(contrast(rolle(scheme, 'secondary'), rolle(scheme, f)), f).toBeGreaterThanOrEqual(3)
  })

  it('disabled sieht nicht aus wie die aktive Variante', () => {
    const dis = regel('.lu-primary:disabled')
    // Entsaettigen UND dimmen: Dimmen allein liesse die Flaeche noch farbig
    // und damit wie die aktive Primaeraktion aussehen.
    expect(dis).toMatch(/grayscale\(1\)/)
    expect(dis).toMatch(/opacity:\s*0?\.\d+/)
  })
})

describe('Primaer-Rezept: alle drei Bildschirme benutzen dasselbe', () => {
  const SITES: Array<[string, string]> = [
    ['Create (Generate)', '../create/ui/Button.tsx'],
    ['Account (Sign in)', '../auth/AccountPanel.tsx'],
    ['Chat (Send)', '../chat/ChatInput.tsx'],
  ]

  it.each(SITES)('%s traegt .lu-primary', (_name, rel) => {
    expect(read(rel)).toContain('lu-primary')
  })

  it.each(SITES)('%s schreibt kein eigenes Graustufen-Rezept mehr ab', (_name, rel) => {
    const src = read(rel)
    // Genau die drei Fuellungen, die das Audit als "drei graue Primaerbuttons"
    // gefunden hatte. Keine davon darf zurueckkehren.
    expect(src).not.toContain('bg-gray-900 text-white')
    expect(src).not.toContain('dark:bg-white/10 dark:text-white')
    expect(src).not.toContain('bg-white/8 text-gray-300')
  })
})

describe('Hellmodus: keine dark-only Flaeche ohne Gegenstueck', () => {
  // Jedes `bg-[#...]` in diesen Dateien muss ein `dark:`-Praefix tragen oder
  // die Cloud-Flaeche sein, die bewusst in beiden Modi dieselbe Farbe traegt.
  const FILES = [
    '../chat/ChatView.tsx',
    '../chat/ChatInput.tsx',
    '../create/experimental/CreateExperimental.tsx',
    '../create/ui/Button.tsx',
    '../auth/AccountPanel.tsx',
  ]

  it.each(FILES)('%s: jede Hex-Flaeche ist modus-bewusst', (rel) => {
    const src = read(rel)
    const offenders: string[] = []
    for (const m of src.matchAll(/(\S*?)bg-\[(#[0-9a-fA-F]{3,8})\]/g)) {
      const prefix = m[1]
      if (prefix.includes('dark:')) continue
      if (m[2].toLowerCase() === '#7c3aed') continue
      offenders.push(m[0])
    }
    expect(offenders).toEqual([])
  })

  it('die Create-Wurzel setzt eine Textfarbe, die beiden Modi folgt', () => {
    const src = read('../create/experimental/CreateExperimental.tsx')
    // Die Rolle on-surface folgt dem Schema von selbst; das alte Paar aus
    // Hell- und Dunkelwert tat dasselbe von Hand.
    expect(src).toMatch(/\btext-on-surface\b|text-gray-900 dark:text-gray-200/)
  })
})
