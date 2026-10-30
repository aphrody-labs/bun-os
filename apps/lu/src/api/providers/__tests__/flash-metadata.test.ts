import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { useFlashBillingStore } from '../../../lib/flash-ui'

vi.mock('../../backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: vi.fn(), isPrivateOrLanHost: () => false,
  isDirectFetchAllowed: () => true, hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(), backendCall: vi.fn(), isTauri: () => false,
}))
const base = 'https://lu-labs.ai/api/inference/v1'
const model = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'
const provider = (apiKey = '') => new OpenAIProvider({
  id: 'openai', name: 'LU Cloud', enabled: true, isLocal: false, apiKey, baseUrl: base,
})
const entry = {
  id: model, name: 'Llama 3.1 8B Turbo', context_length: 131072, usage_class: 'flash',
  flash: { daily_tokens: 50000, default_max_output: 8192, request_seconds: 240, sessions_only: true, concurrent_requests: 1 },
}
beforeEach(() => useFlashBillingStore.setState({ entries: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('flash metadata through the real provider adapter', () => {
  it('carries validated policy from the models response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [entry] }))))
    const models = await provider().listModels()
    expect(models[0].flash).toEqual({ dailyTokens: 50000, defaultMaxOutput: 8192, requestSeconds: 240, billingKey: base + '|' + model })
  })
  it('never labels a personal API-key connection as free', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [entry] }))))
    expect((await provider('lu_test_fixture').listModels())[0].flash).toBeUndefined()
  })
  it('leaves older catalog responses unmarked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: model }] }))))
    expect((await provider().listModels())[0].flash).toBeUndefined()
  })
  it('records the paid fallback before reporting a failed wallet check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'credits exhausted' }), {
      status: 429, headers: { 'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0' },
    })))
    await expect(provider().chatWithTools(model, [{ role: 'user', content: 'Hello' }], [])).rejects.toThrow()
    expect(useFlashBillingStore.getState().entries[base + '|' + model]).toEqual({ billing: 'credits', remaining: 0, ok: false })
  })
})

