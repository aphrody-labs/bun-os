import { describe, it, expect, vi, beforeEach } from 'vitest'

// studioQuote() / modelRuntimes(): same cloudFetch layer as every other cloud
// call (bearer + CLOUD_BASE), P3's honest-failure contract for a server that
// does not have Studio yet, and the typed 409 pass-through.

const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }))
vi.mock('../supabase', () => ({ getAccessToken }))

import { CloudJobError } from '../client'
import { studioQuote, StudioQuoteChangedError, modelRuntimes } from '../studio'
import { CLOUD_BASE } from '../config'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  getAccessToken.mockResolvedValue('tok-123')
})

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('studioQuote', () => {
  it('posts model/prompt/params to /api/jobs/studio-quote with the bearer set', async () => {
    fetchMock.mockResolvedValue(jsonRes({ credits: 4200, seconds: 5 }))
    const result = await studioQuote('preset-horror', 'a whisper in the dark', {
      op: 'studio',
      studio_options: { resolution: '720p' },
      image_paths: ['u1/f1.png'],
    })
    expect(result).toEqual({ credits: 4200, seconds: 5 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${CLOUD_BASE}/api/jobs/studio-quote`)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok-123')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'preset-horror',
      prompt: 'a whisper in the dark',
      params: { op: 'studio', studio_options: { resolution: '720p' }, image_paths: ['u1/f1.png'] },
    })
  })

  // Negativkontrolle: eine 429-Antwort darf NICHT denselben Weg wie 404/CORS
  // nehmen. Ohne diesen Fall wuerde ein zu weiter Statuscheck (z.B. "!res.ok")
  // auch die Ratenbremse stumm auf den Server-veraltet-Text umschreiben.
  it('passes the server text through unchanged on 400 and 429', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Enter a prompt before starting' }, 400))
    await expect(
      studioQuote('preset-horror', '', { op: 'studio', studio_options: {} }),
    ).rejects.toMatchObject({ status: 400, message: 'Enter a prompt before starting' })

    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Please wait before requesting another quote' }, 429))
    await expect(
      studioQuote('preset-horror', 'x', { op: 'studio', studio_options: {} }),
    ).rejects.toMatchObject({ status: 429, message: 'Please wait before requesting another quote' })
  })

  it('answers a clean 404 with the honest "needs a newer server" text, never a guessed price', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}, 404))
    const err = await studioQuote('preset-horror', 'x', {
      op: 'studio',
      studio_options: {},
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudJobError)
    expect((err as CloudJobError).status).toBe(404)
    expect((err as CloudJobError).message).toBe(
      'This feature needs a newer LU Cloud server. Try again later.',
    )
  })

  // Der Fall, den P0 heute noch offen laesst: die Route hat kein CORS, der
  // Browser blockt die Antwort und fetch() lehnt mit dem rohen Motor-Text ab,
  // nie mit einem Status. cloudFetch wandelt das selbst schon in eine eigene
  // CloudJobError um ("Could not reach..."), studioQuote muss diese ZWEITE
  // Umformulierung noch einmal ueberschreiben, sonst liest der Kunde eine
  // Verbindungsstoerung statt einer fehlenden Serverfunktion.
  it('answers a CORS-blocked route the same way as a 404: no fallback formula, no booking', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await studioQuote('preset-horror', 'x', {
      op: 'studio',
      studio_options: {},
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudJobError)
    expect((err as CloudJobError).message).toBe(
      'This feature needs a newer LU Cloud server. Try again later.',
    )
    // Not cloudFetch's own generic wording: a version gap is not a blip.
    expect((err as CloudJobError).message).not.toMatch(/could not reach/i)
  })

  it('does not relabel an unrelated failure (not signed in) as a version gap', async () => {
    getAccessToken.mockResolvedValueOnce(null)
    const err = await studioQuote('preset-horror', 'x', {
      op: 'studio',
      studio_options: {},
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudJobError)
    expect((err as CloudJobError).status).toBe(401)
    expect((err as CloudJobError).message).not.toBe(
      'This feature needs a newer LU Cloud server. Try again later.',
    )
  })

  it('reaches a 409 quote_changed as a typed error carrying the fresh credits', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ error: 'The price has changed. Review the new quote before starting.', code: 'quote_changed', credits: 5100, seconds: 6 }, 409),
    )
    const err = await studioQuote('preset-horror', 'x', {
      op: 'studio',
      studio_options: {},
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StudioQuoteChangedError)
    expect((err as StudioQuoteChangedError).status).toBe(409)
    expect((err as StudioQuoteChangedError).code).toBe('quote_changed')
    expect((err as StudioQuoteChangedError).credits).toBe(5100)
    expect((err as StudioQuoteChangedError).seconds).toBe(6)
    expect((err as StudioQuoteChangedError).message).toBe(
      'The price has changed. Review the new quote before starting.',
    )
  })

  it('a 409 with an unreadable body still yields a typed error, not a crash', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 409, headers: { 'content-type': 'application/json' } }),
    )
    const err = await studioQuote('preset-horror', 'x', {
      op: 'studio',
      studio_options: {},
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StudioQuoteChangedError)
    expect((err as StudioQuoteChangedError).credits).toBe(0)
  })
})

describe('modelRuntimes', () => {
  it('returns the server\'s runtime map on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ runtimes: { 'preset-horror': { seconds: 42, samples: 9 } } }),
    )
    expect(await modelRuntimes()).toEqual({ 'preset-horror': { seconds: 42, samples: 9 } })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${CLOUD_BASE}/api/jobs/runtime`)
  })

  // Negativkontrolle: ohne diesen Fall koennte modelRuntimes() bei einem
  // leeren Objekt in der Antwort ({} statt {runtimes: {}}) unbemerkt
  // `undefined` durchreichen und jeden Aufrufer, der .keys() darauf aufruft,
  // zum Absturz bringen.
  it('falls back to an empty map when the body carries no runtimes field', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}))
    expect(await modelRuntimes()).toEqual({})
  })

  it('stays silent (empty map) on a 404, never throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}, 404))
    expect(await modelRuntimes()).toEqual({})
  })

  it('stays silent (empty map) when the route is CORS-blocked / unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await modelRuntimes()).toEqual({})
  })

  it('stays silent (empty map) when signed out, never surfacing a 401', async () => {
    getAccessToken.mockResolvedValueOnce(null)
    expect(await modelRuntimes()).toEqual({})
  })
})
