/**
 * C1 nachbessert (review-create.md, Punkt 8): "Animate this image" on a
 * finished result (animateResult in CreateExperimental.tsx) set the intent
 * and adopted the source, but left cloudVideoModel untouched. The ModelChip
 * reads cloudVideoModel, so it kept showing whatever model was picked for
 * the PREVIOUS intent, even though modelForOp('video','animate', picked)
 * silently coerces onto a real i2v model at submit time (see
 * src/stores/__tests__/cloudCatalogStore.test.ts, "animate with a t2v-only
 * pick -> first i2v-capable clip model"). Web parity: createStore's
 * animateFrom (lu-300-web) does the equivalent set.
 *
 * CreateExperimental.tsx pulls in useCreate/useCloudCreate/useCloudSession
 * and a dozen api/discover modules through CreateContext, so a full render
 * of the real component tree is not the smallest unit here (the same
 * tradeoff die-fehlerleiste-ist-lesbar.test.tsx already made for
 * useCreate.ts). This reads the actual animateResult source instead, the
 * same way that file's last test reads useCreate.ts's training-error branch.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/animate-result-sets-model-c1.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '..', 'CreateExperimental.tsx'), 'utf8')

function body(fnStart: string): string {
  const i = src.indexOf(fnStart)
  expect(i, `could not find "${fnStart}" in CreateExperimental.tsx`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  return rest.slice(0, rest.indexOf('\n  }, ['))
}

describe('animateResult sets the video model chip to what the run will really use (C1)', () => {
  it('imports modelForOp from the cloud catalog store', () => {
    expect(src).toMatch(/import\s*\{[^}]*modelForOp[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/stores\/cloudCatalogStore'/)
  })

  it('calls setCloudVideoModel(modelForOp(\'video\', \'animate\', ...)) before adopting the source', () => {
    const fn = body('const animateResult = useCallback(async (item: GalleryItem) => {')
    const setIntentAt = fn.indexOf("setIntent('animate')")
    const setModelAt = fn.indexOf("setCloudVideoModel(modelForOp('video', 'animate'")
    const setSourceAt = fn.indexOf('setSource(await adoptResult(item))')
    expect(setIntentAt).toBeGreaterThan(-1)
    expect(setModelAt).toBeGreaterThan(-1)
    expect(setSourceAt).toBeGreaterThan(-1)
    // Order matters: the chip must already show the coerced model before the
    // (async, can fail) source adoption runs.
    expect(setIntentAt).toBeLessThan(setModelAt)
    expect(setModelAt).toBeLessThan(setSourceAt)
  })

  it('editResultWithMask (the sibling action for "edit") does NOT need the same call: edit has no per-op model chip coercion', () => {
    // Regression guard for the test itself: editResultWithMask must exist and
    // must NOT contain setCloudVideoModel, so the assertions above are
    // actually specific to animateResult and not accidentally true of any
    // function in the file.
    const fn = body('const editResultWithMask = useCallback(async (item: GalleryItem) => {')
    expect(fn).not.toContain('setCloudVideoModel')
  })
})
