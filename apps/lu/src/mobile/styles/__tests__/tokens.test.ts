/**
 * The token layer of the mobile shell: sizes, type and motion are --m-*
 * tokens, every colour is a Material 3 role of the generated sheet.
 *
 * A colour written by hand into the shell would be a second palette next to
 * the sheet, and it would not follow the scheme the user picked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STYLES = path.resolve(HERE, '..')
const read = (name: string): string => fs.readFileSync(path.join(STYLES, name), 'utf8')
const css = read('tokens.css')
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')

function block(marker: string): Map<string, string> {
  const start = css.indexOf(`/* tokens:${marker} */`)
  if (start === -1) throw new Error(`marker tokens:${marker} is missing in tokens.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const body = code(css.slice(open + 1, close))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--m-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (out.has(m[1])) throw new Error(`${m[1]} is declared twice in tokens:${marker}`)
    out.set(m[1], m[2].trim())
  }
  return out
}

const shared = block('shared')
const codeTokens = block('code')

describe('tokens.css', () => {
  it('has the shared block with content', () => {
    expect(shared.size).toBeGreaterThan(30)
  })

  it('declares no colour: no hex, no rgb() and no light or dark palette block', () => {
    expect(code(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
    expect(css).not.toContain('tokens:dark')
    expect(css).not.toContain('tokens:light')
    expect(css).not.toMatch(/\.light\s*\{/)
  })

  it('the colours of a code block are roles of the sheet', () => {
    expect([...codeTokens.keys()].sort()).toEqual(
      ['comment', 'deleted', 'function', 'keyword', 'number', 'punct', 'string'].map((k) => `--m-code-${k}`),
    )
    for (const [key, value] of codeTokens) expect(value, key).toMatch(/^var\(--md-(sys|ext)-color-[a-z-]+\)$/)
  })

  it('every token carries the prefix --m- and nothing leaks to :root', () => {
    expect(css).not.toMatch(/:root/)
    const names = [...code(css).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
    expect(names.filter((n) => !n.startsWith('--m-'))).toEqual([])
  })

  it('sizes of type are rem, spacing and targets are px', () => {
    for (const [key, value] of shared) {
      if (key.startsWith('--m-text-')) expect(value, key).toMatch(/rem/)
      if (/^--m-s\d$/.test(key)) expect(value, key).toMatch(/^\d+px$/)
    }
    expect(shared.get('--m-touch')).toBe('44px')
  })
})

describe('the stylesheet of the shell', () => {
  const index = read('index.css')

  it('loads the generated sheets before its own files', () => {
    const order = [
      '@aphrody/m3-tokens/m3-tokens.css',
      '@aphrody/m3-theme/tokens.css',
      '@aphrody/m3-theme/tailwind.css',
      './tokens.css',
    ].map((name) => index.indexOf(`@import '${name}'`))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('uses no colour palette of its own: no --m-* colour token is read anywhere', () => {
    const legacy =
      /var\(--m-(canvas|surface|sheet|overlay|fill|fill-2|hair|edge|t1|t2|t3|accent[a-z-]*|on-accent|cloud[a-z-]*|ok|tight|warn[a-z-]*|err[a-z-]*|scrim|scroll-hint|card-edge|segment|shadow-[a-z]+)\)/
    for (const name of ['reset.css', 'base.css', 'components.css', '../screens/create/parts/create.css']) {
      expect(read(name), name).not.toMatch(legacy)
    }
  })

  it('every colour literal left in the shell is marked as content', () => {
    for (const name of ['reset.css', 'base.css', 'components.css', '../screens/create/parts/create.css']) {
      const lines = read(name).split('\n')
      const unmarked = lines.filter(
        (line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(code(line)) && !line.includes('design:content'),
      )
      expect(unmarked, name).toEqual([])
    }
  })
})
