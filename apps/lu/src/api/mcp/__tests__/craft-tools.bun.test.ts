import { describe, expect, test } from 'bun:test'
import { CRAFT_EXECUTE, craftShellArgs } from '../craft-tools'
import { allAppCapabilities } from '@aphrody/bun-workspace/capabilities'
import { allowedInReadOnlyTurn } from '../../../lib/mutating-tools'
import { MOBILE_REMOVED_TOOLS } from '../../../lib/mobile-tools'

describe('Craft agent bridge', () => {
  test('passes engine arguments as shell positional values, never as code', () => {
    const shell = craftShellArgs({ engine: 'gridcraft', args: ['info', 'a;$(touch nope).xlsx'] })
    expect(shell).toEqual({
      command: 'exec "$0" "$@"',
      shell: 'bash',
      args: ['gridcraft-cli', 'info', 'a;$(touch nope).xlsx'],
    })
    expect(CRAFT_EXECUTE.category).toBe('terminal')
    expect(CRAFT_EXECUTE.inputSchema.properties.engine.enum).toEqual(allAppCapabilities().map((c) => c.libraryId))
  })

  test('rejects unknown engines and malformed model input', () => {
    expect(typeof craftShellArgs({ engine: 'sh', args: [] })).toBe('string')
    expect(typeof craftShellArgs({ engine: 'wordcraft', args: ['ok', 2] })).toBe('string')
    expect(typeof craftShellArgs({ engine: 'filmcraft', args: ['bad\0value'] })).toBe('string')
    expect(typeof craftShellArgs({ engine: 'deckcraft', args: Array(33).fill('x') })).toBe('string')
    expect(typeof craftShellArgs({ engine: 'filmcraft', args: [], timeoutMs: -1 })).toBe('string')
    expect(craftShellArgs({ engine: 'filmcraft', args: [], timeoutMs: 180000 })).toMatchObject({ timeout: 180000 })
  })

  test('keeps terminal execution out of read-only turns and mobile catalogs', () => {
    expect(allowedInReadOnlyTurn('craft_execute')).toBe(false)
    expect(MOBILE_REMOVED_TOOLS.has('craft_execute')).toBe(true)
  })
})
