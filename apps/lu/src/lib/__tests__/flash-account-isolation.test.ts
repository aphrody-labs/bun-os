import { expect, it } from 'vitest'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { captureFlashGeneration, recordFlashResponse, useFlashBillingStore } from '../flash-ui'

it('clears notices on account changes and rejects the old in-flight response', () => {
  const account = { licenseActive: true, tier: 'test', access: true, quota: null }
  useCloudAuthStore.getState().setSignedIn({ id: 'account-a' }, account)
  const generation = captureFlashGeneration()
  const response = new Response('', { headers: { 'x-lu-chat-billing': 'flash', 'x-lu-flash-remaining': '40000' } })
  recordFlashResponse('test', response, generation)
  expect(useFlashBillingStore.getState().entries.test).toBeDefined()
  useCloudAuthStore.getState().setSignedIn({ id: 'account-b' }, account)
  recordFlashResponse('test', response, generation)
  expect(useFlashBillingStore.getState().entries).toEqual({})
  recordFlashResponse('test', response, captureFlashGeneration())
  useCloudAuthStore.getState().setSignedOut()
  expect(useFlashBillingStore.getState().entries).toEqual({})
})
