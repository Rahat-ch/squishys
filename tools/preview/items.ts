// The art preview's items: every part, a spread of sample squishys, every
// legendary and the starters, each with a stable id and its pictures. Pure:
// it draws through the mod's own roller and composer, so the preview shows
// exactly what ships.

import { compose } from '../../src/composer'
import type { Accessory, Body, Face, Kit, Palette } from '../../src/kit'
import type { Pixels } from '../../src/raster'
import { roll } from '../../src/roller'
import type { Squishy } from '../../src/roller'
import { seeded } from '../../tests/seeded'

export type Section = 'body' | 'face' | 'palette' | 'accessory' | 'sample' | 'legendary' | 'starter'

/** One 16x16 picture of an item, with what makes it differ from its siblings. */
export type Picture = { caption: string; pixels: Pixels }

/** One thing the maintainer keeps or sends back for a redraw. */
export type PreviewItem = {
  /**
   * Stable across runs of the same kit: `<kind>/<part id>` for a part,
   * `sample/<squishy key>`, `legendary/<id>` or `starter/<n>` (from 1).
   */
  id: string
  section: Section
  title: string
  /** A short line under the title: rarity, Name fragment and the like. */
  detail: string
  pictures: readonly Picture[]
}

export type PreviewOptions = {
  /** How many different sample squishys to roll. */
  samples: number
  /** The samples' seed: the same seed and kit always roll the same samples. */
  seed: number
}

/** A see-through face and accessory, so a part can be drawn with nothing over it. */
const NOTHING = Array.from({ length: 16 }, () => '................')
const NO_FACE: Face = { id: 'preview-no-face', rarity: 'common', syllable: '', grid: NOTHING }
const NO_ACCESSORY: Accessory = { id: 'preview-no-accessory', rarity: 'common', syllable: '', grid: NOTHING }

/**
 * The preview's items, in the order the page shows them. Each part is drawn
 * over the plainest base the kit has (its first body, face and palette), so
 * the part is the only thing that changes from one picture to the next.
 */
export function previewItems(kit: Kit, { samples, seed }: PreviewOptions): PreviewItem[] {
  const [body, face, palette] = [kit.bodies[0], kit.faces[0], kit.palettes[0]]
  if (body === undefined || face === undefined || palette === undefined) {
    throw new Error('The kit needs at least one body, face and palette to preview')
  }
  const stage: Kit = { ...kit, faces: [...kit.faces, NO_FACE], accessories: [...kit.accessories, NO_ACCESSORY] }
  const draw = (squishy: Squishy): Pixels => compose(stage, squishy, { state: 'working', frame: 0 })
  const plain = (parts: Parts) => draw(assembled(parts, false))
  const base: Parts = { body, face, palette, accessory: NO_ACCESSORY }

  return [
    ...kit.bodies.map(each => partItem('body', each, [{ caption: 'alone', pixels: plain({ ...base, body: each, face: NO_FACE }) }])),
    ...kit.faces.map(each => partItem('face', each, [{ caption: `on ${body.id}`, pixels: plain({ ...base, face: each }) }])),
    ...kit.palettes.map(each =>
      partItem('palette', each, [
        { caption: 'plain', pixels: plain({ ...base, palette: each }) },
        { caption: 'shiny', pixels: draw(assembled({ ...base, palette: each }, true)) },
      ]),
    ),
    ...kit.accessories.map(each => partItem('accessory', each, [{ caption: `on ${body.id}`, pixels: plain({ ...base, accessory: each }) }])),
    ...sampleSquishys(kit, samples, seed).map(squishy => squishyItem(squishy, draw(squishy))),
    ...kit.legendaries.map(legendary => ({
      id: `legendary/${legendary.id}`,
      section: 'legendary' as const,
      title: legendary.name,
      detail: legendary.id,
      pictures: [false, true].map(shiny => ({
        caption: shiny ? 'shiny' : 'plain',
        pixels: draw({ kind: 'legendary', legendary: legendary.id, shiny, name: legendary.name, key: legendary.id }),
      })),
    })),
    ...kit.starters.map((starter, index) => {
      const squishy = assembled(
        { body: partOf(kit.bodies, starter.body, 'body'), face: partOf(kit.faces, starter.face, 'face'), palette, accessory: NO_ACCESSORY },
        false,
      )
      return {
        id: `starter/${index + 1}`,
        section: 'starter' as const,
        title: squishy.name,
        detail: `${starter.body} + ${starter.face}, in ${palette.id}`,
        pictures: [{ caption: `starter ${index + 1}`, pixels: draw(squishy) }],
      }
    }),
  ]
}

/**
 * Where an item's verdict is kept in the page's database: its id with `/`
 * as `:` and anything else a document id can't hold as `~` and four hex
 * digits, so every item gets its own document.
 */
export function verdictDocId(itemId: string): string {
  return Array.from(itemId, char => {
    if (char === '/') return ':'
    if (/[A-Za-z0-9_\-.@+]/.test(char)) return char
    return '~' + (char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')
  }).join('')
}

type Parts = { body: Body; face: Face; palette: Palette; accessory: Accessory }

function partItem(section: Section, part: Body | Face | Palette | Accessory, pictures: Picture[]): PreviewItem {
  const syllable = part.syllable === '' ? 'no syllable' : `"${part.syllable}"`
  return { id: `${section}/${part.id}`, section, title: part.id, detail: `${part.rarity}, ${syllable}`, pictures }
}

function squishyItem(squishy: Squishy, pixels: Pixels): PreviewItem {
  const detail =
    squishy.kind === 'assembled'
      ? `${squishy.rarity}: ${squishy.body}, ${squishy.face}, ${squishy.palette}, ${squishy.accessory}`
      : 'legendary'
  return {
    id: `sample/${squishy.key}`,
    section: 'sample',
    title: squishy.name || '(no Name)',
    detail,
    pictures: [{ caption: squishy.shiny ? 'shiny' : 'plain', pixels }],
  }
}

/**
 * A squishy of exactly these parts, named and keyed by the roller itself:
 * from a kit holding only these parts there is one squishy to roll.
 */
function assembled({ body, face, palette, accessory }: Parts, shiny: boolean): Squishy {
  const only: Kit = { bodies: [body], faces: [face], palettes: [palette], accessories: [accessory], legendaries: [], starters: [] }
  return roll(only, { live: [], rng: () => 0, odds: { legendary: 0, shiny: shiny ? 1 : 0 } })
}

/** Up to `count` different assembled squishys, rolled at the standard odds. */
function sampleSquishys(kit: Kit, count: number, seed: number): Squishy[] {
  const rng = seeded(seed)
  const rolled: Squishy[] = []
  while (rolled.length < count) {
    const squishy = roll(kit, { live: rolled, rng, odds: { legendary: 0 } })
    // A repeat, or a legendary despite its zero odds, means the kit has no
    // different assembled squishy left to roll
    if (squishy.kind !== 'assembled' || rolled.some(each => each.key === squishy.key)) break
    rolled.push(squishy)
  }
  return rolled
}

function partOf<T extends { id: string }>(parts: readonly T[], id: string, kind: string): T {
  const part = parts.find(each => each.id === id)
  if (part === undefined) throw new Error(`The kit has no ${kind} "${id}"`)
  return part
}
