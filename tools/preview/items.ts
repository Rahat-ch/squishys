// The art preview's items: every part, a spread of sample squishys, every
// legendary and the starters, each with a stable id and its picture. Pure:
// it draws through the mod's own roller and composer, so the preview shows
// exactly what ships.

import { compose } from '../../src/composer'
import type { Accessory, Body, Face, Kit, Legendary, Palette } from '../../src/kit'
import type { Pixels } from '../../src/raster'
import { roll } from '../../src/roller'
import type { AssembledSquishy, Squishy } from '../../src/roller'
import { seeded } from '../../src/seeded'

export type Section = 'body' | 'face' | 'palette' | 'accessory' | 'sample' | 'legendary' | 'starter'

/** One picture the maintainer keeps or sends back for a redraw. */
export type PreviewItem = {
  /**
   * Stable while the kit keeps its ids: `<kind>/<part id>` for a part (a
   * palette's shiny colors are `palette/<id>/shiny`), `sample/<squishy key>`,
   * the legendary's squishy key (`legendary/<id>`, `legendary/<id>/shiny`)
   * and `starter/<body>/<face>`.
   */
  id: string
  section: Section
  /** The part's id, or the squishy's Name. */
  heading: string
  /** A short line under the heading: rarity, Name fragment and the like. */
  detail: string
  /** What sets this picture apart from its neighbours: "alone", "shiny". */
  caption: string
  /** The 16x16 picture. */
  pixels: Pixels
  /**
   * A fingerprint of the picture. A verdict records the art it was given
   * on, so a redrawn item shows as changed instead of keeping its verdict.
   */
  art: string
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
  const kitWithBlanks: Kit = { ...kit, faces: [...kit.faces, NO_FACE], accessories: [...kit.accessories, NO_ACCESSORY] }
  const draw = (squishy: Squishy): Pixels => compose(kitWithBlanks, squishy, { state: 'working', frame: 0 })
  const base: Parts = { body, face, palette, accessory: NO_ACCESSORY }
  const part = (section: Section, of: PartBase, idSuffix: string, caption: string, parts: Parts, shiny = false) =>
    item({
      id: `${section}/${of.id}${idSuffix}`,
      section,
      heading: of.id,
      detail: `${of.rarity}, ${of.syllable === '' ? 'no syllable' : `"${of.syllable}"`}`,
      caption,
      pixels: draw(assembled(parts, shiny)),
    })

  return [
    ...kit.bodies.map(each => part('body', each, '', 'alone', { ...base, body: each, face: NO_FACE })),
    ...kit.faces.map(each => part('face', each, '', `on ${body.id}`, { ...base, face: each })),
    ...kit.palettes.flatMap(each => [
      part('palette', each, '', 'plain', { ...base, palette: each }),
      part('palette', each, '/shiny', 'shiny', { ...base, palette: each }, true),
    ]),
    ...kit.accessories.map(each => part('accessory', each, '', `on ${body.id}`, { ...base, accessory: each })),
    ...sampleSquishys(kit, samples, seed).map(squishy =>
      item({
        id: `sample/${squishy.key}`,
        section: 'sample',
        heading: squishy.name || '(no Name)',
        detail: `${squishy.rarity}: ${squishy.body}, ${squishy.face}, ${squishy.palette}, ${squishy.accessory}`,
        caption: squishy.shiny ? 'shiny' : 'plain',
        pixels: draw(squishy),
      }),
    ),
    ...kit.legendaries.flatMap(each =>
      [false, true].map(shiny => {
        const squishy = legendary(each, shiny)
        return item({
          id: squishy.key,
          section: 'legendary',
          heading: squishy.name,
          detail: each.id,
          caption: shiny ? 'shiny' : 'plain',
          pixels: draw(squishy),
        })
      }),
    ),
    ...kit.starters.map(starter => {
      const parts = { ...base, body: partOf(kit.bodies, starter.body, 'body'), face: partOf(kit.faces, starter.face, 'face') }
      const squishy = assembled(parts, false)
      return item({
        id: `starter/${starter.body}/${starter.face}`,
        section: 'starter',
        heading: squishy.name,
        detail: `${starter.body} + ${starter.face}, in ${palette.id}`,
        caption: 'starter',
        pixels: draw(squishy),
      })
    }),
  ]
}

/**
 * Where an item's verdict is kept in the page's database: its id with `/`
 * as `:`, and any other character a document id can't hold (`~` included)
 * as `~` and four hex digits of its code point, so every item gets its own
 * document.
 */
export function verdictDocId(itemId: string): string {
  return Array.from(itemId, char => {
    if (char === '/') return ':'
    if (/[A-Za-z0-9_\-.@+]/.test(char)) return char
    return '~' + (char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')
  }).join('')
}

type PartBase = Body | Face | Palette | Accessory
type Parts = { body: Body; face: Face; palette: Palette; accessory: Accessory }

function item(fields: Omit<PreviewItem, 'art'>): PreviewItem {
  return { ...fields, art: fingerprint(fields.pixels) }
}

/** FNV-1a over every pixel, as eight hex digits. */
function fingerprint(pixels: Pixels): string {
  let hash = 0x811c9dc5
  for (const row of pixels) {
    for (const pixel of row) {
      // A see-through pixel hashes as a value no color can take
      const value = pixel ?? 0x1000000
      for (let shift = 0; shift < 32; shift += 8) {
        hash ^= (value >>> shift) & 0xff
        hash = Math.imul(hash, 0x01000193) >>> 0
      }
    }
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * A squishy of exactly these parts, named and keyed by the roller itself:
 * from a kit holding only these parts there is one squishy to roll.
 */
function assembled({ body, face, palette, accessory }: Parts, shiny: boolean): Squishy {
  const kitOfTheseParts: Kit = { bodies: [body], faces: [face], palettes: [palette], accessories: [accessory], legendaries: [], starters: [] }
  return roll(kitOfTheseParts, { live: [], rng: () => 0, odds: { legendary: 0, shiny: shiny ? 1 : 0 } })
}

/** The legendary as the roller would hand it out, key and all. */
function legendary(of: Legendary, shiny: boolean): Squishy {
  const kitOfThisLegendary: Kit = { bodies: [], faces: [], palettes: [], accessories: [], legendaries: [of], starters: [] }
  return roll(kitOfThisLegendary, { live: [], rng: () => 0, odds: { legendary: 1, shiny: shiny ? 1 : 0 } })
}

/** Up to `count` different assembled squishys, rolled at the standard odds. */
function sampleSquishys(kit: Kit, count: number, seed: number): AssembledSquishy[] {
  const rng = seeded(seed)
  const rolled: AssembledSquishy[] = []
  while (rolled.length < count) {
    const squishy = roll(kit, { live: rolled, rng, odds: { legendary: 0 } })
    if (squishy.kind !== 'assembled') throw new Error('The roller rolled a legendary at odds of 0')
    // A repeat means the kit has no different squishy left to roll
    if (rolled.some(each => each.key === squishy.key)) break
    rolled.push(squishy)
  }
  return rolled
}

function partOf<T extends { id: string }>(parts: readonly T[], id: string, kind: string): T {
  const part = parts.find(each => each.id === id)
  if (part === undefined) throw new Error(`The kit has no ${kind} "${id}"`)
  return part
}
