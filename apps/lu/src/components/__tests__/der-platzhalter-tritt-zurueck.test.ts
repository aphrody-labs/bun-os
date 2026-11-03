/**
 * Der Platzhalter ist leiser als der Wert.
 *
 * Befund D-A4: die Platzhalterregeln in index.css setzten den Platzhalter
 * praktisch auf die Textfarbe selbst. Ein leeres Feld las sich so stark wie
 * ein ausgefuelltes.
 *
 * Die Regel steht ausserhalb jeder `@layer` und schlaegt damit jede
 * Tailwind-Utility in beiden Schreibweisen. Es gibt also genau EINEN
 * Platzhalterwert: die M3-Rolle on-surface-variant, die das generierte
 * Schema fuer hell und dunkel liefert. Dieser Test prueft, dass die Regel
 * die Rolle nennt, und rechnet ihren Kontrast aus den ausgelieferten Werten
 * nach, mit derselben WCAG-2.1-Implementierung wie primary-recipe.test.ts.
 *
 * Run: npx vitest run src/components/__tests__/der-platzhalter-tritt-zurueck.test.ts
 */
import { describe, it, expect } from 'vitest'
import { contrast } from './wcag-contrast'
import { FLAECHEN, INDEX_CODE as css, SCHEMES, rolle } from './m3-rollen'

describe('die eine Platzhalterregel', () => {
  it('nennt die Rolle on-surface-variant und keinen Wert', () => {
    expect(css).toMatch(/(^|\n)::placeholder \{ color: var\(--md-sys-color-on-surface-variant\); \}/)
  })

  it('gilt fuer beide Modi: kein Modus hat eine eigene Platzhalterfarbe', () => {
    expect(css).not.toMatch(/\.(light|dark) ::placeholder/)
    expect(css).not.toMatch(/\.(light|dark) \.placeholder-/)
  })
})

describe('der Platzhalter bleibt lesbar', () => {
  it.each(SCHEMES)('%s: faellt auf keiner Flaeche unter 4,5:1', (_name, scheme) => {
    // Die Untergrenze. Wer den Platzhalter nur weit genug zurueckdreht, hat
    // den Befund umgedreht statt behoben.
    for (const f of FLAECHEN) {
      expect(contrast(rolle(scheme, 'on-surface-variant'), rolle(scheme, f)), f).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('der Platzhalter tritt hinter den Wert zurueck', () => {
  it.each(SCHEMES)('%s: deutlich leiser als der Text (on-surface) auf jeder Flaeche', (_name, scheme) => {
    for (const f of FLAECHEN) {
      const text = contrast(rolle(scheme, 'on-surface'), rolle(scheme, f))
      const ph = contrast(rolle(scheme, 'on-surface-variant'), rolle(scheme, f))
      expect(ph, f).toBeLessThan(text)
      // „Deutlich": hoechstens vier Fuenftel. Vorher waren es 89 % und im
      // Hellmodus sogar 100 %, ein Abstand, den niemand als Rangordnung liest.
      expect(ph / text, f).toBeLessThanOrEqual(0.8)
    }
  })

  it.each(SCHEMES)('%s: Platzhalter und Wert sind nicht dieselbe Farbe', (_name, scheme) => {
    expect(rolle(scheme, 'on-surface-variant')).not.toBe(rolle(scheme, 'on-surface'))
  })
})
