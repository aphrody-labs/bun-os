/**
 * Befund 3 of the abnahme counter-check (2026-08-29), store side.
 *
 * The second half of what lost the pick across a restart: setModels
 * auto-selects the first chat model whenever the active one is not in the
 * incoming list. That is right for a model the user deleted and wrong for an
 * empty list, and fetchModels writes its result here even when every provider
 * failed.
 *
 * Run: npx vitest run src/stores/__tests__/modelStore-pick-persistence.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('../../api/backend', () => ({
  isTauri: vi.fn(() => false),
  backendCall: vi.fn(async () => undefined),
}))
vi.mock('../../api/ollama', () => ({ unloadModel: vi.fn(async () => undefined) }))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: vi.fn(async () => undefined) }))
vi.mock('../../api/engine', () => ({ activateBuiltinModel: vi.fn(async () => undefined) }))

import { useModelStore } from '../modelStore'

const here = dirname(fileURLToPath(import.meta.url))
const storeSrc = readFileSync(resolve(here, '../modelStore.ts'), 'utf8')
const shellSrc = readFileSync(resolve(here, '../../components/layout/AppShell.tsx'), 'utf8')

const QWEN = 'openai::Qwen3-4B-Q4_K_M'
const HERMES = 'openai::Hermes-3-Llama-3.2-3B.Q4_K_M'

const chat = (name: string) => ({
  name, model: name, size: 0, type: 'text' as const,
  provider: 'openai' as const, providerName: 'Built-in Engine',
})

beforeEach(() => {
  useModelStore.setState({ models: [], activeModel: QWEN })
})

describe('an empty model list is not a reason to drop the pick', () => {
  it('THE FIX: setModels([]) leaves the rehydrated pick alone', () => {
    useModelStore.getState().setModels([])
    expect(useModelStore.getState().activeModel).toBe(QWEN)
  })

  it('the real list arrives and the pick is confirmed, not replaced', () => {
    useModelStore.getState().setModels([chat(HERMES), chat(QWEN)])
    expect(useModelStore.getState().activeModel).toBe(QWEN)
  })

  it('clears a deleted pick when only small replacements remain', () => {
    // The dead-name guard has to keep working, or the picker shows a model
    // the provider no longer has and clicking it opens an empty list.
    useModelStore.setState({ activeModel: 'openai::deleted-model' })
    useModelStore.getState().setModels([chat(HERMES), chat(QWEN)])
    expect(useModelStore.getState().activeModel).toBeNull()
  })

  it('NEGATIVE CONTROL: an empty list does not invent a pick out of nothing', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([])
    expect(useModelStore.getState().activeModel).toBeNull()
  })

  it('NEGATIVE CONTROL: a list of nothing but ComfyUI files selects no chat model', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([
      { name: 'sd_turbo.safetensors', model: 'sd_turbo.safetensors', size: 0, type: 'image', format: 'safetensors', architecture: 'sdxl', providerName: 'ComfyUI' },
    ])
    expect(useModelStore.getState().activeModel).toBeNull()
  })
})

describe('the pick is written to disk in the first place', () => {
  it('automatically chooses the first verified 7B model, not a small or opaque row', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([chat(HERMES), chat('opaque'), chat('test-7B')])
    expect(useModelStore.getState().activeModel).toBe('test-7B')
  })
  it('activeModel is part of what persist keeps', () => {
    expect(storeSrc).toMatch(/partialize:[\s\S]*?activeModel: state\.activeModel/)
  })

  it('die Wahl je Modus liegt mit im Speicher', () => {
    // Fund 1 der Kampagne 3.0.0: wer die App in der Cloud schliesst und am
    // naechsten Tag lokal weiterarbeitet, bekommt sonst denselben leeren
    // Waehler wie nach dem blossen Umschalten.
    expect(storeSrc).toMatch(/partialize:[\s\S]*?lastLocalModel: state\.lastLocalModel/)
    expect(storeSrc).toMatch(/partialize:[\s\S]*?lastCloudModel: state\.lastCloudModel/)
  })

  it('the mode reselect no longer decides anything by hand', () => {
    // It asks pickForMode, which holds the empty list harmless. The old
    // inline version is what cleared the pick on mount.
    // The fourth argument is the model the user named on the way into cloud
    // mode by clicking its row in the picker (Nebenbefund 1, R10 re-measure),
    // das fuenfte die Wahl, die jeder Modus zuletzt hatte (Fund 1, T3 und T1
    // auf der Box). The call is still the rule, not a hand-rolled decision.
    expect(shellSrc).toMatch(
      /pickForMode\(activeModel, allModels, appMode, pendingCloudModel, \{\s*\n\s*local: lastLocalModel,\s*\n\s*cloud: lastCloudModel,\s*\n\s*\}\)/,
    )
    expect(shellSrc).not.toMatch(/const inMode = \(name: string \| null\)/)
  })
})

/**
 * R2-27: der Aufstieg aus 2.6.9 liess beide Erinnerungen leer.
 *
 * `lastLocalModel` und `lastCloudModel` sind neu in 3.0.0, `activeModel` nicht.
 * Ein Speicherstand aus 2.6.9 traegt also ein aktives Modell und zweimal
 * `null`, und es gab weder `migrate` noch `onRehydrateStorage`. Der erste
 * Ausflug in die Cloud fand nichts zum Zurueckkommen, und der Rueckweg landete
 * auf "Select a chat model" statt auf dem Modell, mit dem der Nutzer die App
 * gerade noch benutzt hatte.
 *
 * Geprueft wird der Rehydrierhaken direkt: `persist` laesst sich in einem
 * Test nicht zweimal aufsetzen, die Regel dahinter ist aber eine reine
 * Zustandsergaenzung.
 */
describe('R2-27: der Aufstieg aus 2.6.9 belegt die leere Erinnerung vor', () => {
  const QUELLE = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'modelStore.ts'), 'utf8',
  )

  /** Genau der Haken aus dem Store, an einem Zustand nachgefahren. */
  const rehydriere = (state: {
    activeModel: string | null
    lastLocalModel: string | null
    lastCloudModel: string | null
  }) => {
    if (!state?.activeModel) return state
    const istCloud = state.activeModel.startsWith('lu-cloud::')
    if (istCloud) {
      if (!state.lastCloudModel) state.lastCloudModel = state.activeModel
    } else if (!state.lastLocalModel) {
      state.lastLocalModel = state.activeModel
    }
    return state
  }

  it('der Store hat den Haken ueberhaupt', () => {
    expect(QUELLE, 'kein onRehydrateStorage, der Aufstieg bleibt leer')
      .toContain('onRehydrateStorage:')
    expect(QUELLE).toContain("state.activeModel.startsWith('lu-cloud::')")
  })

  it('ein lokales aktives Modell landet in lastLocalModel', () => {
    const s = rehydriere({ activeModel: 'qwen3:3b', lastLocalModel: null, lastCloudModel: null })
    expect(s.lastLocalModel).toBe('qwen3:3b')
    expect(s.lastCloudModel).toBeNull()
  })

  it('und der Ausflug in die Cloud findet den Rueckweg', () => {
    const s = rehydriere({ activeModel: 'qwen3:3b', lastLocalModel: null, lastCloudModel: null })
    // Cloud hin: der Rueckweg steht jetzt da, wo ihn der Umschalter liest.
    expect(s.lastLocalModel).toBe('qwen3:3b')
  })

  it('NEGATIVKONTROLLE: ein gespeicherter Wert wird nicht ueberschrieben', () => {
    const s = rehydriere({ activeModel: 'qwen3:3b', lastLocalModel: 'llama3.1:8b', lastCloudModel: null })
    expect(s.lastLocalModel).toBe('llama3.1:8b')
  })

  it('NEGATIVKONTROLLE: ein Cloud-Modell landet nicht in lastLocalModel', () => {
    const s = rehydriere({ activeModel: 'lu-cloud::qwen3-32b', lastLocalModel: null, lastCloudModel: null })
    expect(s.lastLocalModel).toBeNull()
    expect(s.lastCloudModel).toBe('lu-cloud::qwen3-32b')
  })

  it('NEGATIVKONTROLLE: ohne aktives Modell passiert gar nichts', () => {
    const s = rehydriere({ activeModel: null, lastLocalModel: null, lastCloudModel: null })
    expect(s.lastLocalModel).toBeNull()
    expect(s.lastCloudModel).toBeNull()
  })
})
