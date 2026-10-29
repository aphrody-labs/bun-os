// @vitest-environment jsdom
/**
 * What Create says when the render queue answers 429 (src/hooks/useCloudCreate.ts).
 *
 * LU Cloud answers 429 for five different things: the per-user burst guard, an
 * upstream provider throttle, an empty wallet, the monthly video budget and the
 * monthly character trainings. All of them once reached the user as "Monthly
 * credit budget exhausted, upgrade your plan", so a subscriber who had simply
 * clicked twice too fast was told to buy a bigger plan while the credits meter
 * next to the message still showed a balance.
 *
 * R5-49, R5-50, R5-52: the repair after that was a `/credit/i` test on the
 * message, and the server's video-budget sentence carries the word "credits".
 * The wrong branch won, and the customer was offered a plan change instead of
 * the pack that unblocks him. `trainings_exhausted` does not carry the word at
 * all and fell into the throttle text, which points at a clock that never runs
 * out. The code the server sends decides now; the heuristic is gone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { throttleMessage } from '../useCloudCreate'
import { CloudJobError } from '../../api/cloud/client'
import { CREDITS_EXHAUSTED_EVENT } from '../../lib/credits-exhausted'

const UPGRADE = /upgrade your plan/
/** Gedankenstriche, beide Sorten. Kundentext traegt keine. */
const STRICHE = /[–—]/

describe('jeder Geldgrund traegt seinen eigenen Satz, wortgleich mit dem Web', () => {
  it('empty wallet', () => {
    const err = new CloudJobError('too many requests', 429, { code: 'credits_exhausted' })
    expect(throttleMessage(err)).toBe("You're out of credits. Load up your credits or upgrade your plan.")
  })

  it('monthly video budget, and it names the pack that actually unblocks it', () => {
    const err = new CloudJobError('monthly video budget exhausted, buy credits', 429, { code: 'video_budget_exhausted' })
    expect(throttleMessage(err))
      .toBe("This month's video budget is used up. Top-up credits keep video going, or upgrade your plan.")
  })

  it('monthly character trainings, names the top-up path, wortgleich mit dem Web (B1, review-a1.md)', () => {
    const err = new CloudJobError('no trainings left', 429, { code: 'trainings_exhausted' })
    expect(throttleMessage(err))
      .toBe('Your included character trainings are used up. Top-up credits keep training going, or upgrade your plan.')
    expect(throttleMessage(err)).not.toMatch(/try again|wait/i)
  })

  it('no customer sentence carries a dash', () => {
    for (const code of ['credits_exhausted', 'video_budget_exhausted', 'trainings_exhausted', undefined]) {
      expect(throttleMessage(new CloudJobError('slow down', 429, code ? { code } : undefined))).not.toMatch(STRICHE)
    }
    expect(throttleMessage(new CloudJobError('slow down', 429, { retryAfterMs: 42_000 }))).not.toMatch(STRICHE)
  })
})

describe('a throttle is named as a throttle', () => {
  it('says wait, not pay, for a real burst 429', () => {
    const msg = throttleMessage(new CloudJobError('too many requests', 429))
    expect(msg).toBe('Too many requests at once. Wait a moment and try again.')
    expect(msg).not.toMatch(UPGRADE)
  })

  it('keeps the retry-after number, the only one worth clicking on', () => {
    const msg = throttleMessage(new CloudJobError('too many requests', 429, { retryAfterMs: 42_000 }))
    expect(msg).not.toMatch(UPGRADE)
    expect(msg).toContain('42s')
  })

  it('does not invent a countdown from a missing or zero wait', () => {
    for (const meta of [undefined, { retryAfterMs: 0 }]) {
      expect(throttleMessage(new CloudJobError('slow down', 429, meta))).not.toMatch(/\d+s\b/)
    }
  })

  it('rounds a sub-second wait up rather than telling the user 0s', () => {
    expect(throttleMessage(new CloudJobError('slow down', 429, { retryAfterMs: 250 }))).toContain('1s')
  })

  it('NEGATIVKONTROLLE: a message that merely says "credits" is not a money answer', () => {
    // Genau der Satz, der die alte Heuristik gekippt hat, nur ohne Code.
    const err = new CloudJobError('monthly credit budget exhausted', 429)
    expect(throttleMessage(err)).toBe('Too many requests at once. Wait a moment and try again.')
    expect(throttleMessage(err)).not.toMatch(UPGRADE)
  })
})

describe('der Renderweg oeffnet den Kaufdialog, nicht nur der Chatweg', () => {
  const seen = vi.fn()
  beforeEach(() => {
    seen.mockClear()
    window.addEventListener(CREDITS_EXHAUSTED_EVENT, seen)
  })
  afterEach(() => window.removeEventListener(CREDITS_EXHAUSTED_EVENT, seen))

  it('fires on the empty wallet', () => {
    throttleMessage(new CloudJobError('too many requests', 429, { code: 'credits_exhausted' }))
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('NEGATIVKONTROLLE: an ordinary 429 opens nothing', () => {
    throttleMessage(new CloudJobError('too many requests', 429, { retryAfterMs: 1000 }))
    throttleMessage(new CloudJobError('monthly credit budget exhausted', 429))
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('the metadata the message needs actually survives the client', () => {
  it('jsonOrError carries code and retry-after off the response', async () => {
    const { jsonOrError } = await import('../../api/cloud/client')
    const res = new Response(JSON.stringify({ error: 'too many requests', code: 'rate_limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '30' },
    })
    const err = (await jsonOrError(res).catch((e: unknown) => e)) as CloudJobError
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterMs).toBe(30_000)
    expect(throttleMessage(err)).toContain('30s')
  })
})
