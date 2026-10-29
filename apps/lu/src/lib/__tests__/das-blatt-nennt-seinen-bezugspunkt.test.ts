import { describe, it, expect } from 'vitest'
import { releaseNoteFor, itemDetail, SHEET_CATALOGUE_MODELS, SHEET_CHAT_MODELS } from '../release-notes'
import { CLOUD_PITCH, cloudPitchLines } from '../cloud-pitch'

/**
 * Jede Zahl im Was-ist-neu-Blatt nennt die Menge, auf die sie sich bezieht.
 *
 * Das Blatt fuehrt zwei Mengen nebeneinander: den Messlauf vom 10.09.2026 und
 * den Katalog. Ein Rueckverweis wie "of those models" zeigt danach auf beide
 * und damit auf keine. Vor diesem Waechter stand die Freimengenzeile als
 * "12 of those models" direkt hinter der Zeile mit 27 und 46 und las sich
 * damit als Schnittmenge aus gemessenen und abrechnungsfreien Modellen. Diese
 * Schnittmenge ist nirgends gemessen, also darf keine Zeile sie behaupten
 * (R6-7). Das Cloud-Tor in `cloud-pitch.ts` hat den Bezugspunkt schon
 * ausgeschrieben; T13 hat am 12.09.2026 auf der Windows-Box gemessen, dass
 * Blatt und Tor deshalb auseinanderliefen.
 *
 * Negativkontrolle: gegen den Wortlaut vor dem Fix
 * ("12 of those models cost no credits at all in chat on a paid plan") sind
 * die ersten beiden Faelle rot.
 */
describe('das Blatt nennt seinen Bezugspunkt', () => {
  const blatt = releaseNoteFor('3.0.0')
  const zeilen = [...(blatt?.lines ?? []), ...(blatt?.details ?? []).flatMap((s) => s.items)].map(itemDetail)

  it('nennt die Freimenge gegen den Katalog, mit dem Wort Katalog', () => {
    const freimenge = zeilen.filter((l) => l.includes('cost no credits at all in chat'))
    expect(freimenge).toHaveLength(1)
    expect(freimenge[0]).toContain(`${CLOUD_PITCH.flashModels} of the ${SHEET_CATALOGUE_MODELS} models in the catalogue`)
  })

  it('laesst keine Zahl auf ein "those models" zeigen', () => {
    expect(zeilen.filter((l) => /\bof those models\b/.test(l))).toEqual([])
  })

  it('gibt der Freimenge denselben Bezugspunkt wie das Cloud-Tor', () => {
    const blattzeile = zeilen.find((l) => l.includes('cost no credits at all in chat'))!
    const torzeile = cloudPitchLines().find((l) => l.includes('cost no credits at all in chat'))!
    const bezug = /(\d+) of the (\d+) models in the catalogue/
    expect(blattzeile.match(bezug)?.slice(1)).toEqual(torzeile.match(bezug)?.slice(1))
  })

  it('haelt den Messlauf als Nenner der Marke, getrennt vom Katalog', () => {
    // Der Nenner der Marke bleibt der Messlauf. Ohne diesen Fall koennte der
    // Fix oben die Zeile darueber mitziehen und aus 46 einen Katalog machen.
    expect(SHEET_CHAT_MODELS).toBe(CLOUD_PITCH.measuredChatModels)
    expect(SHEET_CATALOGUE_MODELS).toBe(CLOUD_PITCH.chatModels)
    expect(zeilen.some((l) => l.includes(`of the ${SHEET_CHAT_MODELS} cloud chat models we measured`))).toBe(true)
  })
})
