/**
 * Die Presenter-Vorschauen.
 *
 * 19.09.2026: der Kunde soll sehen, wen er waehlt, bevor er zahlt. Das traegt
 * nur, solange jeder Name auf ein Bild zeigt, das es wirklich gibt. Eine tote
 * Adresse waere schlimmer als gar kein Bild: eine leere Kachel sieht aus wie
 * ein kaputter Avatar, nicht wie ein fehlendes Vorschaubild.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avatarGender, avatarNames, avatarPerson, avatarPreview } from '../heygen-avatars'
import { studioSchema } from '../studio-contract'

const enumNamen = (studioSchema('heygen-twin').properties?.avatar?.enum ?? []).map(String)

describe('the presenter previews', () => {
  it('serves a file that exists for every name it claims to know', () => {
    expect(avatarNames().length).toBeGreaterThan(400)
    for (const name of avatarNames()) {
      const pfad = avatarPreview(name)
      expect(pfad, name).toMatch(/^\/heygen-avatars\/[a-z0-9-]+\.webp$/)
      expect(existsSync(join(process.cwd(), 'public', pfad!)), `${name} -> ${pfad}`).toBe(true)
    }
  })

  it('only knows names the provider schema actually offers', () => {
    // Ein Bild zu einem Namen, den das Schema nicht kennt, waere ein Angebot,
    // das der Anbieter beim Start ablehnt.
    const erlaubt = new Set(enumNamen)
    for (const name of avatarNames()) expect(erlaubt.has(name), name).toBe(true)
  })

  it('covers all but the handful the provider no longer lists publicly', () => {
    const ohne = enumNamen.filter((n) => !avatarPreview(n))
    expect(ohne.length).toBeLessThanOrEqual(10)
    // Sie bleiben waehlbar: die Liste gehoert dem Anbieter, nicht uns.
    for (const n of ohne) expect(erlaubtImSchema(n)).toBe(true)
  })

  it('reads the person out of the look name, so the grid can group', () => {
    expect(avatarPerson('Annie Bar Standing Side 2')).toBe('Annie')
    expect(avatarPerson('Edward')).toBe('Edward')
  })

  it('normalises the gender the provider spells four different ways', () => {
    const werte = new Set(avatarNames().map(avatarGender))
    for (const w of werte) expect(['f', 'm', '']).toContain(w)
    expect(werte.has('f')).toBe(true)
    expect(werte.has('m')).toBe(true)
  })
})

function erlaubtImSchema(name: string): boolean {
  return enumNamen.includes(name)
}
