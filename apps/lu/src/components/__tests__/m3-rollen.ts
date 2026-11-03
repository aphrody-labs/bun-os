/**
 * Die Rollen des generierten Material-3-Schemas fuer die Design-Tests.
 *
 * index.css nennt keine Farbe mehr, sondern nur Rollen
 * (`var(--md-sys-color-primary)`). Was eine Rolle in hell und dunkel
 * WIRKLICH ist, steht im generierten Blatt `@aphrody/m3-theme/tokens.css`;
 * gelesen wird es mit demselben Parser, der die Startfarben schreibt
 * (src/mobile/styles/sheet/generate.ts). So rechnen die Tests den Kontrast
 * gegen die Werte, die ausgeliefert werden, und nicht gegen abgeschriebene.
 *
 * Keine Testdatei: `vitest.config.ts` sammelt nur `**\/__tests__\/**\/*.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readSheet, SOURCES, type Scheme } from '../../mobile/styles/sheet/generate'

export const SHEET = readSheet(readFileSync(SOURCES.tokens, 'utf8'), readFileSync(SOURCES.tailwind, 'utf8'))
export const SCHEMES: ReadonlyArray<readonly [name: 'hell' | 'dunkel', scheme: Scheme]> = [
  ['hell', SHEET.light],
  ['dunkel', SHEET.dark],
]

/** Der Wert einer Rolle (`primary`, `on-surface`, `success`) in einem Schema. */
export function rolle(scheme: Scheme, name: string): string {
  const value = scheme[name]
  if (!value) throw new Error(`Rolle ${name} fehlt im generierten Schema`)
  return value
}

/** Die Flaechen, auf denen Bedienelemente der App sitzen. */
export const FLAECHEN = [
  'surface',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
] as const

export const INDEX_CSS = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')

/** index.css ohne Kommentare: was dort steht, gilt. */
export const INDEX_CODE = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Der Rumpf der ersten Regel, deren Selektor genau `selector` ist. */
export function regel(selector: string, css: string = INDEX_CODE): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`keine Regel ${selector} in index.css`)
  return m[2]
}

/** Die Rollen, die ein Regelrumpf liest, in der Reihenfolge ihres Auftretens. */
export function rollenIn(body: string): string[] {
  return [...body.matchAll(/var\(--md-(?:sys|ext)-color-([a-z-]+)\)/g)].map((m) => m[1])
}
