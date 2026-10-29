// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  clampNoticeLeft,
  clampNoticeMaxHeight,
  FLASH_NOTICE_CLOSE_LABEL,
  FLASH_NOTICE_HEADING_EXHAUSTED,
  FLASH_NOTICE_HEADING_FREE,
  FLASH_NOTICE_HEADING_UNPAID,
  FLASH_NOTICE_LABEL_CREDITS,
  FLASH_NOTICE_LABEL_FREE,
  FlashChatNotice,
} from '../FlashChatNotice'
import { useModelStore } from '../../../stores/modelStore'
import { captureFlashGeneration, clearFlashNotices, parseFlashPolicy, recordFlashResponse, useFlashBillingStore } from '../../../lib/flash-ui'
import { FLASH_UNPAID_NOTICE } from '../../../lib/flash-entitlement'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'

const wire = { daily_tokens: 50000, default_max_output: 8192, request_seconds: 240, sessions_only: true, concurrent_requests: 1 }
const policy = parseFlashPolicy(wire, 'flash', 'test-endpoint|model')!
const signIn = (paidPlan: boolean | null) =>
  useCloudAuthStore.getState().setSignedIn(
    { id: 'u1' },
    { licenseActive: true, tier: 'hosted', access: true, quota: null, paidPlan },
  )

/** Opens the popup by clicking the trigger label, the only way in. */
const openPopup = () => fireEvent.click(screen.getByTestId('flash-chat-notice-trigger'))

beforeEach(() => {
  useFlashBillingStore.setState({ entries: {} })
  // Die bestehenden Faelle beschreiben das zahlende Konto.
  signIn(true)
  useModelStore.setState({ activeModel: 'test-model', models: [{
    name: 'test-model', model: 'test-model', size: 0, type: 'text', provider: 'openai', providerName: 'Test', flash: policy,
  }] })
})
afterEach(cleanup)

describe('das Etikett neben dem Agent-Schalter', () => {
  it('zeigt GRUEN "Using no credits" nur, wenn diese Runde wirklich nichts kostet', () => {
    render(createElement(FlashChatNotice))
    const trigger = screen.getByTestId('flash-chat-notice-trigger')
    expect(trigger.textContent).toBe(FLASH_NOTICE_LABEL_FREE)
    expect(trigger.className).toMatch(/emerald/)
  })

  // Runde 2 (19.09.2026): derselbe Textstand wie "Agent" daneben
  // (AgentModeToggle.tsx nutzt `text-[0.55rem]`), und die ueblichen
  // Popup-Attribute, bevor irgendetwas geoeffnet ist.
  it('traegt dieselbe Schriftgroesse wie "Agent" und kuendigt sich als Popup-Ausloeser an', () => {
    render(createElement(FlashChatNotice))
    const trigger = screen.getByTestId('flash-chat-notice-trigger')
    expect(trigger.className).toContain('text-[0.55rem]')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('faellt die Freimenge fuer diese Runde auf Credits zurueck, wird das Etikett neutral', () => {
    render(createElement(FlashChatNotice))
    act(() => recordFlashResponse(policy.billingKey, new Response('', { headers: {
      'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0',
    } })))
    const trigger = screen.getByTestId('flash-chat-notice-trigger')
    expect(trigger.textContent).toBe(FLASH_NOTICE_LABEL_CREDITS)
    expect(trigger.className).not.toMatch(/emerald/)
  })

  it('ein Konto ohne bezahlten Plan liest denselben neutralen Text, nie Gruen', () => {
    signIn(false)
    render(createElement(FlashChatNotice))
    const trigger = screen.getByTestId('flash-chat-notice-trigger')
    expect(trigger.textContent).toBe(FLASH_NOTICE_LABEL_CREDITS)
    expect(trigger.className).not.toMatch(/emerald/)
  })

  it('sagt nichts, solange die Kontoabfrage nicht beantwortet ist', () => {
    signIn(null)
    render(createElement(FlashChatNotice))
    expect(screen.queryByTestId('flash-chat-notice')).toBeNull()
  })

  it('sagt nichts fuer ein Modell ohne die Freimengenklasse, egal welcher Plan', () => {
    const row = useModelStore.getState().models[0]
    if (!('flash' in row)) throw new Error('Expected the flash model fixture')
    useModelStore.setState({ models: [{ ...row, flash: undefined }] })
    for (const plan of [true, false, null] as const) {
      cleanup()
      signIn(plan)
      render(createElement(FlashChatNotice))
      expect(screen.queryByTestId('flash-chat-notice')).toBeNull()
    }
  })
})

describe('das Popup, aus der Konstante, nicht getippt', () => {
  // Runde 2 (19.09.2026): das Popup traegt jetzt eine Ueberschrift, ein
  // sichtbares X und die Bedingungen als kurze Liste statt als Fliesstext.
  // Keine Bedingung, die vorher genannt wurde, darf hier fehlen.
  it('traegt eine Ueberschrift, die den gruenen Zustand benennt', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    expect(screen.getByRole('heading', { name: FLASH_NOTICE_HEADING_FREE })).toBeTruthy()
  })

  it('zeigt ein sichtbares X, unabhaengig von der Panel-Breite', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    const close = screen.getByTestId('flash-chat-notice-close')
    expect(close.querySelector('svg')).toBeTruthy()
    expect(close.getAttribute('aria-label')).toBe(FLASH_NOTICE_CLOSE_LABEL)
  })

  it('nennt jede heute gueltige Bedingung: Tagesmenge, Rueckstellzeit, eine Anfrage je Konto, API-Schluessel, Rueckfall auf Credits, Ausgabe- und Zeitgrenze, Reservierung', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    const panel = screen.getByTestId('flash-chat-notice-panel')
    expect(panel.textContent).toContain('50,000')
    expect(panel.textContent).toContain('00:00 UTC')
    expect(panel.textContent).toContain('One free request at a time per account')
    expect(panel.textContent).toContain('API keys always use credits')
    expect(panel.textContent).toContain('uses credits instead')
    expect(panel.textContent).toContain('8,192')
    expect(panel.textContent).toContain('240 seconds')
    expect(panel.textContent).toContain('reserved before generation')
    expect(panel.textContent).toContain('keeps that reservation')
  })

  it('liest fuer ein Konto ohne bezahlten Plan den ehrlichen Satz statt der Zusage, mit passender Ueberschrift', () => {
    signIn(false)
    render(createElement(FlashChatNotice))
    openPopup()
    expect(screen.getByRole('heading', { name: FLASH_NOTICE_HEADING_UNPAID })).toBeTruthy()
    expect(screen.getByTestId('flash-chat-notice-panel').textContent).toContain(FLASH_UNPAID_NOTICE)
  })

  it('nennt die aufgebrauchte Freimenge in der Ueberschrift, wenn diese Runde auf Credits faellt', () => {
    render(createElement(FlashChatNotice))
    act(() => recordFlashResponse(policy.billingKey, new Response('', { headers: {
      'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0',
    } })))
    openPopup()
    expect(screen.getByRole('heading', { name: FLASH_NOTICE_HEADING_EXHAUSTED })).toBeTruthy()
  })

  it('schliesst per Escape', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    expect(screen.queryByTestId('flash-chat-notice-panel')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('flash-chat-notice-panel')).toBeNull()
  })

  it('schliesst per X', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    fireEvent.click(screen.getByTestId('flash-chat-notice-close'))
    expect(screen.queryByTestId('flash-chat-notice-panel')).toBeNull()
  })

  it('schliesst bei einem Klick ausserhalb', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('flash-chat-notice-panel')).toBeNull()
  })
})

describe('Zeilen je Anfrage, aus den Antwortkoepfen', () => {
  it('clears notices across focus changes and fences late responses', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    const generation = captureFlashGeneration()
    const response = new Response('', { headers: { 'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0' } })
    act(() => recordFlashResponse(policy.billingKey, response, generation))
    expect(screen.queryByRole('alert')).not.toBeNull()
    act(() => window.dispatchEvent(new Event('blur')))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => recordFlashResponse(policy.billingKey, response, generation))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => window.dispatchEvent(new Event('focus')))
    act(() => recordFlashResponse(policy.billingKey, response, captureFlashGeneration()))
    expect(screen.queryByRole('alert')).not.toBeNull()
    act(clearFlashNotices)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders a persistent paid-fallback alert from response headers', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    act(() => recordFlashResponse(policy.billingKey, new Response('', { headers: {
      'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0',
    } })))
    expect(screen.getByRole('alert').textContent).toContain('This request uses credits')
  })

  it('does not claim a failed credit check started generation', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    act(() => recordFlashResponse(policy.billingKey, new Response('', { status: 429, headers: {
      'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0',
    } })))
    expect(screen.getByRole('alert').textContent).toContain('No generation started')
  })

  it('labels remaining tokens as a reservation, not final usage', () => {
    render(createElement(FlashChatNotice))
    openPopup()
    act(() => recordFlashResponse(policy.billingKey, new Response('', { headers: {
      'x-lu-chat-billing': 'flash', 'x-lu-flash-remaining': '12345',
    } })))
    expect(screen.getByRole('status').textContent).toContain('Remaining after reservation: 12,345')
  })

  it('does not show a notice for another endpoint or model', () => {
    recordFlashResponse('other|model', new Response('', { headers: { 'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0' } }))
    render(createElement(FlashChatNotice))
    openPopup()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers no free usage claim when an old backend omits metadata', () => {
    const row = useModelStore.getState().models[0]
    if (!('flash' in row)) throw new Error('Expected the flash model fixture')
    useModelStore.setState({ models: [{ ...row, flash: undefined }] })
    render(createElement(FlashChatNotice))
    expect(screen.queryByTestId('flash-chat-notice')).toBeNull()
    expect(parseFlashPolicy(undefined, undefined, 'key')).toBeUndefined()
  })

  it('rejects malformed policy and billing metadata', () => {
    expect(parseFlashPolicy({ ...wire, daily_tokens: -1 }, 'flash', 'key')).toBeUndefined()
    expect(parseFlashPolicy({ ...wire, sessions_only: false }, 'flash', 'key')).toBeUndefined()
    expect(parseFlashPolicy(wire, 'anything', 'key')).toBeUndefined()
    recordFlashResponse(policy.billingKey, new Response('', { headers: { 'x-lu-chat-billing': 'credits' } }))
    expect(useFlashBillingStore.getState().entries).toEqual({})
  })
})

// Runde 2 (19.09.2026): das Popup lief mit festem `left: 0` rechts aus dem
// Fenster (Screenshot der ersten Runde). Pure Funktion, damit der Clamp ohne
// DOM und ohne echtes Resize beweisbar ist.
describe('clampNoticeLeft, der Viewport-Clamp des Panels', () => {
  it('bleibt bei left: 0, wenn genug Platz rechts ist', () => {
    expect(clampNoticeLeft(20, 1200, 280)).toEqual({ left: 0, width: 280 })
  })

  it('schiebt das Panel nach links, statt rechts aus dem Fenster zu laufen', () => {
    // Trigger bei x=300, Fenster nur 360px breit, Panel 280px breit: bei
    // left:0 raegte das Panel bis x=580, weit ueber den rechten Rand.
    const { left, width } = clampNoticeLeft(300, 360, 280)
    expect(width).toBe(280)
    expect(300 + left + width).toBeLessThanOrEqual(360 - 8 + 0.001)
    expect(left).toBeLessThan(0)
  })

  it('schrumpft die Breite, statt einen negativen Rand zu verlangen, wenn selbst 2 * Rand mehr ist als das Fenster', () => {
    const { width } = clampNoticeLeft(10, 100, 280)
    expect(width).toBe(100 - 8 * 2)
  })

  it('haelt mindestens den Rand zum linken Fensterrand ein', () => {
    const { left, width } = clampNoticeLeft(-50, 360, 280)
    expect(-50 + left).toBeGreaterThanOrEqual(8 - 0.001)
    expect(width).toBe(280)
  })
})

// Runde 3 (Abnahme 19.09.2026, Blocker A1): das Panel oeffnet jetzt nach oben
// und muss deshalb seine eigene Hoehe auf den Platz klemmen, der ueber dem
// Trigger frei ist, sonst laeuft es in einem niedrigen Fenster oben aus dem
// Bild statt wie zuvor rechts.
describe('clampNoticeMaxHeight, die Hoehenklemme des nach oben oeffnenden Panels', () => {
  it('gibt den vollen Platz oberhalb des Triggers minus Abstand und Rand', () => {
    // wrapTop=400, PANEL_GAP=6, PANEL_MARGIN=8
    expect(clampNoticeMaxHeight(400)).toBe(400 - 6 - 8)
  })

  it('wird nie negativ, wenn der Trigger fast am oberen Fensterrand klebt', () => {
    expect(clampNoticeMaxHeight(0)).toBe(0)
    expect(clampNoticeMaxHeight(5)).toBe(0)
  })
})
