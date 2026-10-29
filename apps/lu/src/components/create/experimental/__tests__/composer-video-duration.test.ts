// Portplan Abschnitt 6 (dd29f359): die Laengenauswahl fuer Cloud-Video folgt
// dem Katalog, nicht zwei festen Knoepfen. Katalog ist die Laufzeitwahrheit,
// video-durations.json der Notvorrat ohne Netz; eine ungueltig gewordene
// Wahl faellt auf die KUERZESTE gueltige Laenge zurueck, nie auf die naechste
// (das wuerde den Preis still hochziehen).
import { describe, expect, it } from 'vitest'
import { effectiveVideoDurations, snapToVideoDuration } from '../Composer'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'

describe('effectiveVideoDurations', () => {
  it('prefers the live catalog over the offline notvorrat', () => {
    useCloudCatalogStore.setState({
      models: [{ id: 'test-cat', label: 'Test', kind: 'video', clip: { short: 5, durations: [5, 10, 15] } } as never],
    })
    expect(effectiveVideoDurations('test-cat')).toEqual([5, 10, 15])
  })

  it('falls back to the static JSON when the catalog carries no durations list', () => {
    // wan-2.2-720p is a real model in the JSON notvorrat; a bare CLOUD_MODEL_SEED
    // entry (clip without a durations array) must not shadow it.
    useCloudCatalogStore.setState({
      models: [{ id: 'wan-2.2-720p', label: 'Wan 2.2 720p', kind: 'video', clip: { short: 5, long: 8 } } as never],
    })
    const durations = effectiveVideoDurations('wan-2.2-720p')
    expect(durations.length).toBeGreaterThan(0)
  })

  it('falls back to short/long when neither the catalog nor the JSON has a list', () => {
    useCloudCatalogStore.setState({
      models: [{ id: 'made-up-model', label: 'Made up', kind: 'video', clip: { short: 5, long: 8 } } as never],
    })
    expect(effectiveVideoDurations('made-up-model')).toEqual([5, 8])
  })

  it('returns an empty list for a model with no clip info at all (no unpriced button)', () => {
    useCloudCatalogStore.setState({ models: [{ id: 'no-clip', label: 'No clip', kind: 'video' } as never] })
    expect(effectiveVideoDurations('no-clip')).toEqual([])
  })
})

describe('snapToVideoDuration', () => {
  it('keeps an exact, still-valid choice', () => {
    expect(snapToVideoDuration([5, 10, 15], 10 * 16, 16)).toBe(10)
  })

  it('resets an invalid-become choice to the SHORTEST valid length, never the nearest', () => {
    // 14s is closer to 15 than to 5, but the rule is "shortest valid", not
    // "nearest": a silent jump to the nearer, pricier option is exactly the
    // Risiko 1 the portplan calls out (a shown price that is not the booked one).
    expect(snapToVideoDuration([5, 15], 14 * 16, 16)).toBe(5)
  })

  it('falls back to the shortest option when fps is zero', () => {
    expect(snapToVideoDuration([5, 8], 40, 0)).toBe(5)
  })
})
