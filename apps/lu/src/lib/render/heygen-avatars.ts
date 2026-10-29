// Vorschaubilder zu den Presenter-Namen.
//
// 19.09.2026: der Avatar steht im Anbieterschema nur als Name in einer Liste
// von 500. Wer daraus waehlen soll, ohne zu wissen, wie die Person aussieht,
// zahlt fuer einen Lauf, um es herauszufinden. Die Bilder kommen aus HeyGens
// eigener Look-Liste (GET /v3/avatars/looks), einmal gezogen, verkleinert und
// unter public abgelegt. Wir hosten selbst: ein Verweis auf files2.heygen.ai
// liesse den Browser jedes Kunden dort nachladen.
//
// Neun Namen aus dem Schema fuehrt HeyGen oeffentlich nicht mehr (Edward und
// die acht Jocelyn-Eintraege). Sie bleiben waehlbar, nur ohne Bild: die Liste
// ist die des Anbieters, nicht unsere.
import karte from './heygen-avatars.json'

const AVATARS = karte as Record<string, string[]>

export function avatarPreview(name: string): string | undefined {
  const slug = AVATARS[name]?.[0]
  return slug ? `/heygen-avatars/${slug}.webp` : undefined
}

export function avatarGender(name: string): 'f' | 'm' | '' {
  const g = AVATARS[name]?.[1]
  return g === 'f' || g === 'm' ? g : ''
}

/** Der Personenname ohne Szene und Blickrichtung: "Annie Bar Standing Side 2"
 *  ist Annie. Der Waehler gruppiert danach, sonst stehen dort 500 Kacheln
 *  derselben acht Gesichter hintereinander. */
export function avatarPerson(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

export function avatarNames(): string[] {
  return Object.keys(AVATARS)
}
