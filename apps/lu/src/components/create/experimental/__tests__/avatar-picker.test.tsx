// @vitest-environment jsdom
/**
 * Der Presenter kommt als Kachel, nicht als Zeile in einer Namensliste.
 *
 * Dasselbe Bedienelement traegt das Preset-Fenster und die Optionen im
 * Create-Tab. Geprueft wird deshalb SchemaControl, nicht die eine Oberflaeche.
 */
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SchemaControl } from '../SchemaControl'
import { studioSchema } from '../../../../lib/render/studio-contract'
import { avatarPreview } from '../../../../lib/render/heygen-avatars'

afterEach(cleanup)

const avatarSchema = studioSchema('heygen-twin').properties!.avatar!
const namen = (avatarSchema.enum ?? []).map(String)

it('zeigt das Gesicht des gewaehlten Presenters, nicht nur seinen Namen', () => {
  const name = namen.find((n) => avatarPreview(n))!
  render(<SchemaControl name="avatar" schema={avatarSchema} value={name} onChange={() => {}} disabled={false} />)
  const knopf = screen.getByLabelText('Presenter')
  expect(knopf.textContent).toContain(name)
  expect(knopf.querySelector('img')?.getAttribute('src')).toBe(avatarPreview(name))
})

it('laesst den Kunden suchen und per Kachel waehlen', () => {
  let gewaehlt = ''
  const start = namen.find((n) => avatarPreview(n))!
  render(<SchemaControl name="avatar" schema={avatarSchema} value={start} onChange={(v) => { gewaehlt = String(v) }} disabled={false} />)
  fireEvent.click(screen.getByLabelText('Presenter'))
  const ziel = namen.filter((n) => avatarPreview(n) && n !== start)[0]
  fireEvent.change(screen.getByLabelText('Search presenters'), { target: { value: ziel } })
  fireEvent.click(screen.getByLabelText(ziel))
  expect(gewaehlt).toBe(ziel)
})

it('bleibt fuer jedes andere Listenfeld die schlichte Auswahl', () => {
  // Die Kacheln gelten dem Presenter. Eine Aufloesung als Bilderraster waere
  // Unfug, und ein Feld ohne Vorschauen duerfte nicht leer dastehen.
  const aufloesung = studioSchema('heygen-twin').properties!.resolution!
  render(<SchemaControl name="resolution" schema={aufloesung} value="720p" onChange={() => {}} disabled={false} />)
  expect(screen.queryByLabelText('Presenter')).toBeNull()
  expect(screen.getByRole('combobox')).toBeTruthy()
})
