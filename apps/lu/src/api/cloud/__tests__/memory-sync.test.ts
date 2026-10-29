import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
const endpoint = vi.hoisted(() => ({ base: 'https://fixture.invalid' }))
vi.mock('../config', () => ({ get CLOUD_BASE() { return endpoint.base } }))
const networkFetch = globalThis.fetch.bind(globalThis)
const auth = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn(), unsubscribe: vi.fn(), changed: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void) }))
vi.mock('../supabase', () => ({ supabaseCloud: () => ({ auth: {
  getSession: auth.getSession, getUser: auth.getUser,
  onAuthStateChange: (changed: typeof auth.changed) => { auth.changed = changed; return { data: { subscription: { unsubscribe: auth.unsubscribe } } } },
} }) }))
import { withMemorySyncSession } from '../memory-sync'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
const fetcher = vi.fn()
const signIn = (id: string) => useCloudAuthStore.getState().setSignedIn({ id }, { licenseActive: true, tier: null, access: true, quota: null })
const row = (id: string) => ({ memory_id: id, revision: 1, deleted: false, payload: { id, content: 'Synthetic memory' }, updated_at: '2026-09-09T00:00:00Z' })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => {
  signIn('a'); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); auth.unsubscribe.mockReset()
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'synthetic-token-a', user: { id: 'a' } } } })
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'a' } }, error: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('pins the verified token across pages, retains tombstones and releases listeners', async () => {
  fetcher.mockResolvedValueOnce(response({ ownerId: 'a', records: [row('one')], next: 'one' }))
    .mockResolvedValueOnce(response({ ownerId: 'a', records: [{ ...row('two'), deleted: true, payload: null }], next: null }))
  const rows = await withMemorySyncSession('a', client => client.pull())
  expect(rows).toHaveLength(2)
  expect(rows[1].payload).toBeNull()
  expect(auth.getUser).toHaveBeenCalledWith('synthetic-token-a')
  expect(fetcher.mock.calls[1][0]).toContain('?after=one')
  for (const [, init] of fetcher.mock.calls) {
    expect(init.headers.authorization).toBe('Bearer synthetic-token-a')
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('error')
  }
  expect(auth.unsubscribe).toHaveBeenCalledOnce()
})
it('never sends data if the restored or verified account differs', async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: 'b' } }, error: null })
  await expect(withMemorySyncSession('a', client => client.write('one', 0, { id: 'one' }))).rejects.toMatchObject({ kind: 'account' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('rejects a delayed page after sign-out and return to the same account', async () => {
  let finish!: (value: Response) => void
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
  const pending = withMemorySyncSession('a', client => client.pull())
  const failure = expect(pending).rejects.toMatchObject({ kind: 'account' })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
  useCloudAuthStore.getState().setSignedOut(); signIn('a')
  finish(response({ ownerId: 'a', records: [row('one')], next: 'one' }))
  await failure
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
})
it('SDK account changes abort even before the UI auth store updates', async () => {
  fetcher.mockImplementation(() => new Promise(() => {}))
  const pending = withMemorySyncSession('a', client => client.pull())
  const failure = expect(pending).rejects.toMatchObject({ kind: 'account' })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
  auth.changed?.('SIGNED_OUT', null)
  await failure
  expect(auth.unsubscribe).toHaveBeenCalledOnce()
})
it('bounds a stalled response body, not only response headers', async () => {
  vi.useFakeTimers()
  fetcher.mockResolvedValue(new Response(new ReadableStream({ start() {} })))
  const pending = withMemorySyncSession('a', client => client.pull())
  const failure = expect(pending).rejects.toMatchObject({ kind: 'network', message: 'Memory synchronization timed out' })
  await vi.advanceTimersByTimeAsync(60001)
  await failure
})
it('rejects another response owner and cyclic pagination instead of partially applying it', async () => {
  fetcher.mockResolvedValue(response({ ownerId: 'b', records: [], next: null }))
  await expect(withMemorySyncSession('a', client => client.pull())).rejects.toMatchObject({ kind: 'account' })
  fetcher.mockImplementation(async () => response({ ownerId: 'a', records: [row('one')], next: 'one' }))
  await expect(withMemorySyncSession('a', client => client.pull())).rejects.toMatchObject({ kind: 'invalid' })
})
it('surfaces conflicts without retries or private upstream diagnostics', async () => {
  fetcher.mockResolvedValue(response({ error: 'PRIVATE_RESPONSE_CONTENT' }, 409))
  await expect(withMemorySyncSession('a', client => client.write('one', 0, { id: 'one' }))).rejects.toMatchObject({ kind: 'conflict' })
  expect(fetcher).toHaveBeenCalledOnce()
})
it('sends the verified session through real HTTP and parses a payload-free deletion', async () => {
  let received: unknown
  let bearer: string | undefined
  const server = createServer(async (request, reply) => {
    bearer = request.headers.authorization
    let body = ''
    for await (const chunk of request) body += chunk
    received = JSON.parse(body)
    reply.setHeader('content-type', 'application/json')
    reply.end(JSON.stringify({ ownerId: 'a', record: { ...row('one'), deleted: true, payload: null } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  endpoint.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  vi.stubGlobal('fetch', networkFetch)
  try {
    const deleted = await withMemorySyncSession('a', client => client.write('one', 0, null))
    expect(deleted.deleted).toBe(true)
    expect(bearer).toBe('Bearer synthetic-token-a')
    expect(received).toEqual({ memoryId: 'one', expectedRevision: 0, payload: null, deleted: true })
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it.each(['account', 'cancelled'] as const)('closes a real unfinished HTTP response on %s', async kind => {
  let started!: () => void
  let closed!: () => void
  const seen = new Promise<void>(resolve => { started = resolve })
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  const server = createServer((_request, reply) => {
    reply.on('close', closed)
    reply.writeHead(200, { 'content-type': 'application/json' })
    reply.write('{')
    started()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  endpoint.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  vi.stubGlobal('fetch', networkFetch)
  try {
    const controller = new AbortController()
    const pending = withMemorySyncSession('a', client => client.pull(), controller.signal)
    const failure = expect(pending).rejects.toMatchObject({ kind })
    await seen
    if (kind === 'account') useCloudAuthStore.getState().setSignedOut()
    else controller.abort('PRIVATE_CALLER_REASON')
    await failure
    await disconnected
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('refuses pre-cancelled work without SDK or network calls', async () => {
  const controller = new AbortController()
  controller.abort('PRIVATE_CALLER_REASON')
  await expect(withMemorySyncSession('a', client => client.pull(), controller.signal)).rejects.toMatchObject({
    kind: 'cancelled', message: 'Memory synchronization cancelled. Some changes may already be saved.',
  })
  expect(auth.getSession).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})

it('cancels stalled identity verification and removes the caller listener', async () => {
  auth.getUser.mockImplementation(() => new Promise(() => {}))
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const pending = withMemorySyncSession('a', client => client.pull(), controller.signal)
  const failure = expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
  await vi.waitFor(() => expect(auth.getUser).toHaveBeenCalled())
  controller.abort()
  await failure
  expect(fetcher).not.toHaveBeenCalled()
  expect(auth.unsubscribe).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
})
