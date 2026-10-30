/**
 * Die gemessene Marke ueberlebt den Weg vom Server bis in die Modellzeile.
 *
 * Genau dieser Weg hat schon zweimal ein Feld verloren (siehe den Kommentar in
 * lib/cloud-model-row.ts). Der Test faehrt die echte Umwandlung, nicht eine
 * nachgebaute.
 */
import { describe, it, expect } from 'vitest'
import { cloudModelRow } from '../cloud-model-row'
import type { ProviderModel } from '../../api/providers/types'

const base: ProviderModel = {
  id: 'zai-org/GLM-5.3-Flash',
  name: 'GLM 5.3 Flash',
  provider: 'openai',
  providerName: 'LU Cloud',
}

describe('unfiltered auf dem Weg in die Zeile', () => {
  it('reicht den gemessenen Wert durch', () => {
    expect(cloudModelRow({ ...base, unfiltered: 'full' }).unfiltered).toBe('full')
    expect(cloudModelRow({ ...base, unfiltered: 'partial' }).unfiltered).toBe('partial')
  })

  it('erfindet nichts, wenn der Server nichts sagt', () => {
    expect(cloudModelRow(base).unfiltered).toBeUndefined()
  })
})
