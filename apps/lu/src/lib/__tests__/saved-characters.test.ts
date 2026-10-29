/**
 * A character saved as photos (lib/saved-characters). The test run has no
 * IndexedDB, so this exercises the session store behind the same functions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MAX_CHARACTER_PHOTOS, __resetSavedCharacters, deleteSavedCharacter, listSavedCharacters,
  saveCharacter, subscribeSavedCharacters,
} from '../saved-characters'

const photo = (text: string) => new Blob([text], { type: 'image/jpeg' })

beforeEach(() => __resetSavedCharacters())

describe('saving', () => {
  it('keeps the photos under the name and gives them back as images', async () => {
    const r = await saveCharacter('  Mira   Vale ', [photo('one'), photo('two')])
    expect(r.character.name).toBe('Mira Vale')
    expect(r.added).toBe(2)
    expect(r.merged).toBe(false)
    const list = await listSavedCharacters()
    expect(list).toHaveLength(1)
    expect(list[0].photos).toHaveLength(2)
    expect(list[0].photos[0].type).toBe('image/jpeg')
    expect(await list[0].photos[1].text()).toBe('two')
  })

  it('the same name again adds to the same character, whatever the case', async () => {
    await saveCharacter('Mira', [photo('one')])
    const r = await saveCharacter('mira', [photo('two'), photo('three')])
    expect(r.merged).toBe(true)
    expect(r.character.photos).toHaveLength(3)
    expect(await listSavedCharacters()).toHaveLength(1)
  })

  it('needs a name and at least one frame', async () => {
    await expect(saveCharacter('   ', [photo('one')])).rejects.toThrow('Give the character a name.')
    await expect(saveCharacter('Mira', [])).rejects.toThrow('Add at least one frame first.')
    expect(await listSavedCharacters()).toEqual([])
  })

  it('keeps 30 photos at most and says how many did not fit', async () => {
    const many = Array.from({ length: 34 }, (_, i) => photo(`p${i}`))
    const r = await saveCharacter('Mira', many)
    expect(r.added).toBe(MAX_CHARACTER_PHOTOS)
    expect(r.dropped).toBe(4)
    await expect(saveCharacter('Mira', [photo('more')])).rejects.toThrow('Mira already has 30 photos, the most a character keeps.')
  })

  it('lists the newest first', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000)
    await saveCharacter('First', [photo('a')])
    await saveCharacter('Second', [photo('b')])
    expect((await listSavedCharacters()).map((c) => c.name)).toEqual(['Second', 'First'])
    vi.restoreAllMocks()
  })
})

describe('deleting and listening', () => {
  it('a delete removes the character and tells the listeners', async () => {
    const heard = vi.fn()
    const off = subscribeSavedCharacters(heard)
    const { character } = await saveCharacter('Mira', [photo('one')])
    expect(heard).toHaveBeenCalledTimes(1)
    await deleteSavedCharacter(character.id)
    expect(heard).toHaveBeenCalledTimes(2)
    expect(await listSavedCharacters()).toEqual([])
    off()
    await saveCharacter('Mira', [photo('one')])
    expect(heard).toHaveBeenCalledTimes(2)
  })
})
