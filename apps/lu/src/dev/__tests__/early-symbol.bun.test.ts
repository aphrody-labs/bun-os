import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { checkBundle } from '../webview-target'

const root = resolve(__dirname, '../../..')
const script = readFileSync(resolve(root, 'public/early-symbol.js'), 'utf8')

test('installs async disposal before module evaluation without replacing an existing symbol', () => {
  const context = runInNewContext(`
    const nativeSymbol = globalThis.Symbol;
    function OldSymbol(description) { return nativeSymbol(description); }
    OldSymbol.for = nativeSymbol.for;
    const Symbol = OldSymbol;
    ({ install: () => { ${script} }, read: () => Symbol.asyncDispose });
  `)
  context.install()
  const first = context.read()
  expect(typeof first).toBe('symbol')
  context.install()
  expect(context.read()).toBe(first)
  const html = readFileSync(resolve(root, 'index.html'), 'utf8')
  expect(html.indexOf('/early-symbol.js')).toBeGreaterThan(-1)
  expect(html.indexOf('/early-symbol.js')).toBeLessThan(html.indexOf('type="module"'))
})

test('the transition exception applies only to the one guarded React call', () => {
  const reactPath = resolve(root, '../../node_modules/react-dom/cjs/react-dom-client.production.js')
  const react = readFileSync(reactPath, 'utf8')
  const start = react.indexOf('function startViewTransition(')
  const end = react.indexOf('function ViewTransitionPseudoElement(', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const body = react.slice(start, end)
  expect(body).toContain('ownerDocument.startViewTransition(')
  expect(body).toMatch(/catch \(x\)\s*\{\s*return mutationCallback\(\), layoutCallback\(\), spawnedWorkCallback\(\), null/)
  const guarded = 'function x(){try{var t=d.startViewTransition({})}catch(e){fallback()}}'
  expect(checkBundle([{ name: 'assets/index-test.js', text: guarded }])).toEqual([])
  expect(checkBundle([{ name: 'assets/other-test.js', text: guarded }])).toHaveLength(1)
  expect(checkBundle([{ name: 'assets/index-test.js', text: 'd.startViewTransition({})' }])).toHaveLength(1)
  expect(checkBundle([{ name: 'assets/index-test.js', text: `${guarded};d.startViewTransition({})` }])).toHaveLength(1)
})
