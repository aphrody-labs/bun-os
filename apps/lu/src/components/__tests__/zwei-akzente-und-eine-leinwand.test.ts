/**
 * Zwei Akzente und eine Leinwand, seit dem Bun-OS-Designsystem als Rollen
 * EINES generierten Material-3-Schemas.
 *
 * Bis November 2026 standen hier ein eigener Haus-Akzent (`--color-lu-accent`
 * mit Hover-, Kanten- und Tintenstufe), ein Cloud-Akzent (`--color-lu-cloud`)
 * und eine handgeschriebene Flaechenleiter (`--color-lu-canvas/base/panel/
 * overlay/sheet`), dunkel und ohne Hell-Gegenstueck. Jetzt gilt:
 *
 *   Haus-Akzent  → primary / on-primary / primary-container
 *   Cloud        → tertiary / on-tertiary / tertiary-container
 *                  (Cloud ist ein GELDZUSTAND und traegt deshalb eine eigene
 *                  Rolle, nicht die Hausmarke)
 *   Leinwand     → surface; Pane, Panel, Overlay, Blatt → surface-container-*
 *
 * Beide Modi kommen aus demselben Seed, die Werte stehen im generierten
 * Blatt `@aphrody/m3-theme/tokens.css`; dieser Test rechnet gegen genau diese
 * Werte und haelt fest, dass index.css keine eigene Palette mehr fuehrt.
 *
 * Run: npx vitest run src/components/__tests__/zwei-akzente-und-eine-leinwand.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrast } from './wcag-contrast'
import { quelldateien, quelltext } from './quelldateien'
import { FLAECHEN, INDEX_CODE as CSS_CODE, SCHEMES, rolle } from './m3-rollen'
import { SHEET } from '../../mobile/styles/sheet/colours.g'

const SRC = resolve(__dirname, '..', '..')
const nurCode = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const DATEIEN = quelldateien(SRC)

describe('index.css fuehrt keine eigene Palette mehr', () => {
  it('keine --color-lu-*-Stufe und kein --pk-*-Satz', () => {
    expect(CSS_CODE).not.toMatch(/--color-lu-[a-z-]+\s*:/)
    expect(CSS_CODE).not.toMatch(/--pk-[a-z0-9-]+/)
    expect(CSS_CODE).not.toMatch(/var\(--color-lu-/)
  })

  it('die generierten Blaetter werden geladen, Tailwind zuerst', () => {
    const order = [
      '@import "tailwindcss"',
      '@import "@aphrody/m3-tokens/m3-tokens.css"',
      '@import "@aphrody/m3-theme/tokens.css"',
      '@import "@aphrody/m3-theme/tailwind.css"',
    ].map((s) => CSS_CODE.indexOf(s))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('der Cloud-Akzent ist eine eigene Rolle, keine zweite Marke', () => {
  it.each(SCHEMES)('%s: tertiary ist nicht primary', (_name, scheme) => {
    expect(rolle(scheme, 'tertiary')).not.toBe(rolle(scheme, 'primary'))
  })

  it.each(SCHEMES)('%s: die gefuellte Cloud-Flaeche traegt ihren Text mit AA', (_name, scheme) => {
    expect(contrast(rolle(scheme, 'on-tertiary'), rolle(scheme, 'tertiary'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(rolle(scheme, 'on-tertiary-container'), rolle(scheme, 'tertiary-container'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SCHEMES)('%s: Cloud- und Haus-Schrift halten AA auf jeder Flaeche', (_name, scheme) => {
    for (const r of ['tertiary', 'primary']) {
      for (const f of FLAECHEN) expect(contrast(rolle(scheme, r), rolle(scheme, f)), `${r} auf ${f}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('kein Akzent-Literal ist im Code uebrig', () => {
    // Haus (#a094f8 Ruhe, #b1a6ff Hover, #8b7cf0 Kante, #5746d9 Tinte),
    // Cloud (#7c3aed, #a78bfa) und das Brand-Kit-Violett #8b5cf6.
    const orte: string[] = []
    for (const [name, src] of DATEIEN) {
      for (const m of nurCode(src).matchAll(/#(?:a094f8|b1a6ff|8b7cf0|5746d9|7c3aed|a78bfa|8b5cf6)\b/gi)) {
        orte.push(`${name}: ${m[0]}`)
      }
    }
    expect(orte).toEqual([])
    expect(CSS_CODE.toLowerCase()).not.toMatch(/#(?:a094f8|b1a6ff|8b7cf0|5746d9|7c3aed|a78bfa|8b5cf6)\b/)
  })
})

describe('die Leinwand ist die surface-Rolle', () => {
  it('der Startschirm, die Fehlerschirme und das Telefon nehmen surface aus dem Blatt', () => {
    for (const [, scheme] of SCHEMES) expect(rolle(scheme, 'surface')).toMatch(/^#[0-9a-f]{6}$/)
    expect(SHEET.light.surface).toBe(SCHEMES[0][1].surface)
    expect(SHEET.dark.surface).toBe(SCHEMES[1][1].surface)
  })

  it('die Notschirme malen ohne Stylesheet, aber mit den Werten des Blatts', () => {
    // Sie muessen auch dann lesbar sein, wenn das Stylesheet der Grund des
    // Absturzes war; deshalb lesen sie die generierten Konstanten statt
    // `var(--…)`, und schreiben keine eigene Zahl.
    for (const f of ['components/ui/ErrorBoundary.tsx', 'lib/fatal-error.ts']) {
      const src = nurCode(quelltext(DATEIEN, f))
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    }
    expect(quelltext(DATEIEN, 'lib/fatal-error.ts')).toContain("from '../mobile/styles/sheet/colours.g'")
    expect(quelltext(DATEIEN, 'components/ui/ErrorBoundary.tsx')).toContain('bootScheme()')
  })

  it('der Schwebeblatt-Rezept ist die Menueflaeche, nicht die Leinwand', () => {
    // Ein Menue, das ueber der Leinwand schwebt, in der FARBE der Leinwand
    // liest sich nicht als schwebend.
    const cm = quelltext(DATEIEN, 'components/ui/ContextMenu.tsx')
    expect(cm).toContain('lu-elevated')
    expect(CSS_CODE).toMatch(/\.lu-elevated \{\s*background: var\(--md-sys-color-surface-container\);/)
  })
})

describe('die alten Palettenklassen sterben aus, und nur in diese Richtung', () => {
  /**
   * Utilities auf geloeschten `lu-*`-Farben (`bg-lu-canvas`, `text-lu-accent`,
   * `border-lu-cloud/40` …) erzeugt Tailwind nicht mehr: sie malen nichts.
   * Ihre Call-Sites liegen in den Bauteilen und werden dort auf die Rollen
   * umgestellt (bg-surface, text-primary, border-tertiary/40 …). Die Zahl
   * darf deshalb nur sinken. Stand bei der Umstellung von index.css: 209
   * Fundstellen in 54 Dateien.
   */
  const ALT = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|shadow|decoration|accent|caret|placeholder)(?:-[lrtbxy])?-lu-(?:canvas|base|panel|overlay|sheet|accent|on-accent|cloud|focus)[a-z-]*(?:\/[\w.[\]]+)?(?![\w-])/g

  it('hoechstens 209 Fundstellen', () => {
    let n = 0
    for (const [, src] of DATEIEN) n += (src.match(ALT) ?? []).length
    expect(n).toBeLessThanOrEqual(209)
  })

  it('keine Datei, die schon auf Rollen steht, faellt zurueck', () => {
    for (const f of ['components/ui/ErrorBoundary.tsx']) {
      expect(quelltext(DATEIEN, f).match(ALT) ?? [], f).toEqual([])
    }
  })
})

describe('die Rollen, die index.css liest, gibt es im Blatt', () => {
  it('jede var(--md-sys-color-*) hat in beiden Schemata einen Wert', () => {
    const rollen = new Set([...CSS_CODE.matchAll(/var\(--md-sys-color-([a-z-]+)\)/g)].map((m) => m[1]))
    expect(rollen.size).toBeGreaterThan(10)
    for (const r of rollen) for (const [name, scheme] of SCHEMES) expect(scheme[r], `${r} (${name})`).toMatch(/^#/)
    // Auch die erweiterten Rollen (success) kommen aus dem Blatt.
    for (const m of CSS_CODE.matchAll(/var\(--md-ext-color-([a-z-]+)\)/g)) {
      for (const [name, scheme] of SCHEMES) expect(scheme[m[1]], `${m[1]} (${name})`).toMatch(/^#/)
    }
  })

  it('und die Kommentare in index.css zitieren keine Zahl mehr als Farbe', () => {
    const css = readFileSync(resolve(SRC, 'index.css'), 'utf8')
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d/)
  })
})
