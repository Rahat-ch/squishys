import { expect, test } from 'claude-code/testing'

import { compose } from '../src/composer'
import { KIT } from '../src/kit'
import type { PartBase, Rarity } from '../src/kit'
import { SHINY_MARK, roll } from '../src/roller'
import type { Squishy } from '../src/roller'
import { seeded } from '../src/seeded'
import { eachPart } from './pictures'

const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare']
const KINDS = [
  ['bodies', KIT.bodies],
  ['faces', KIT.faces],
  ['palettes', KIT.palettes],
  ['accessories', KIT.accessories],
] as const

test('the kit has 6 bodies, 8 faces, 10 palettes, 8 accessories, 5 legendaries and 3 starters', () => {
  expect(KIT.bodies).toHaveLength(6)
  expect(KIT.faces).toHaveLength(8)
  expect(KIT.palettes).toHaveLength(10)
  expect(KIT.accessories).toHaveLength(8)
  expect(KIT.legendaries).toHaveLength(5)
  expect(KIT.starters).toHaveLength(3)
})

test('every kind of part has common, uncommon and rare parts, each part with an id of its own', () => {
  for (const [kind, parts] of KINDS) {
    const ids: readonly string[] = parts.map((part: PartBase) => part.id)
    if (new Set(ids).size !== ids.length) throw new Error(`Two ${kind} share an id: ${ids.join(', ')}`)
    for (const rarity of RARITIES) {
      if (!parts.some((part: PartBase) => part.rarity === rarity)) throw new Error(`No ${rarity} ${kind}`)
    }
  }
})

test('one accessory is none, which draws nothing', () => {
  const none = KIT.accessories.find(accessory => accessory.id === 'none')

  expect(none?.grid.every(row => /^\.+$/.test(row))).toBe(true)
})

test('every legendary has an id and a fixed Name of its own', () => {
  const ids = KIT.legendaries.map(legendary => legendary.id)
  const names = KIT.legendaries.map(legendary => legendary.name)

  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(names).size).toBe(names.length)
})

test('the three starters are species of the kit, each a different body', () => {
  for (const { body, face } of KIT.starters) {
    expect(KIT.bodies.some(part => part.id === body)).toBe(true)
    expect(KIT.faces.some(part => part.id === face)).toBe(true)
  }

  expect(KIT.starters).toHaveLength(3)
  expect(new Set(KIT.starters.map(starter => starter.body)).size).toBe(3)
})

// Rolled at the standard odds, as agents get them
const ROLLED: Squishy[] = (() => {
  const rng = seeded(5)
  return Array.from({ length: 2000 }, () => roll(KIT, { live: [], rng, odds: { legendary: 0 } }))
})()

/**
 * Every regular squishy's Name, built from its parts' syllables as the
 * roller builds it (lowercase). Building the strings is cheap, so this walks
 * every combination; no test composes or spawns them all.
 */
const EVERY_NAME: string[] = KIT.bodies.flatMap(body =>
  KIT.faces.flatMap(face =>
    KIT.palettes.flatMap(palette => KIT.accessories.map(accessory => body.syllable + face.syllable + palette.syllable + accessory.syllable)),
  ),
)

test('every body, face and palette has a syllable, and of the accessories only none goes without', () => {
  for (const [kind, parts] of KINDS) {
    for (const part of parts as readonly PartBase[]) {
      if (part.syllable === '' && !(kind === 'accessories' && part.id === 'none')) throw new Error(`The ${part.id} part has no syllable`)
    }
  }
})

test('every regular squishy has a Name of its own, and no legendary shares one', () => {
  const names = new Set(EVERY_NAME.map(name => name.toLowerCase()))

  expect(names.size).toBe(EVERY_NAME.length)
  for (const { name } of KIT.legendaries) expect(names.has(name.toLowerCase())).toBe(false)
})

/** Syllables of an optional consonant or two, a vowel or two, and maybe a closing n. */
const PRONOUNCEABLE = /^(?:[bcdfghjkmnprstwyz]{0,2}[aeiou]{1,2}n?)+$/
/** The most letters a Name has, so it stays a cute 3 or 4 syllables (a slot cuts what doesn't fit it). */
const MOST_LETTERS = 13

test('every Name is short, and made of easy syllables', () => {
  for (const name of EVERY_NAME) {
    if (name.length > MOST_LETTERS) throw new Error(`"${name}" is longer than ${MOST_LETTERS}`)
    if (!PRONOUNCEABLE.test(name)) throw new Error(`"${name}" is hard to say`)
    if (/(.)\1\1/.test(name)) throw new Error(`"${name}" repeats a letter three times`)
  }
  // The roller spells them the same way, capitalized, after SHINY_MARK on a shiny
  for (const squishy of ROLLED) expect(EVERY_NAME).toContain(squishy.name.replace(SHINY_MARK, '').toLowerCase())
})

/** The colors a squishy's still picture uses. */
function colorsIn(squishy: Squishy): Set<number> {
  const pixels = compose(KIT, squishy, { state: 'working', frame: 0 })
  return new Set(pixels.flat().filter((pixel): pixel is number => pixel !== null))
}

test('a squishy is drawn in at most four colors, and a shiny in at most five, the fifth its sparkle', () => {
  for (const squishy of eachPart(KIT)) {
    const used = colorsIn(squishy)
    if (used.size > (squishy.shiny ? 5 : 4)) throw new Error(`${JSON.stringify(squishy)} uses ${used.size} colors`)
  }
  // A normal squishy never shows its own sparkle color, unless one of its four colors is that color anyway
  for (const squishy of eachPart(KIT).filter(each => !each.shiny)) {
    const source =
      squishy.kind === 'legendary'
        ? KIT.legendaries.find(each => each.id === squishy.legendary)
        : KIT.palettes.find(each => each.id === squishy.palette)
    if (source === undefined) throw new Error(`No colors for ${JSON.stringify(squishy)}`)
    const sparkle = source.shiny.sparkle
    if (colorsIn(squishy).has(sparkle) && !Object.values(source.colors).includes(sparkle)) {
      throw new Error(`${JSON.stringify(squishy)} shows its sparkle`)
    }
  }
})

type Rgb = readonly [number, number, number]
const rgbOf = (color: number): Rgb => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
const distance = (one: Rgb, other: Rgb) => Math.hypot(one[0] - other[0], one[1] - other[1], one[2] - other[2])

test('a shiny’s base color is far from its own palette’s, and from every plain palette’s', () => {
  for (const palette of KIT.palettes) {
    for (const plain of KIT.palettes) {
      if (distance(rgbOf(palette.shiny.base), rgbOf(plain.colors.base)) < 60) {
        throw new Error(`${palette.id}'s shiny looks like plain ${plain.id}`)
      }
    }
  }
})

// The 256 colors a terminal without true color offers: a 6x6x6 cube and 24 greys
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255]
const XTERM_256: readonly Rgb[] = [
  ...CUBE_LEVELS.flatMap(r => CUBE_LEVELS.flatMap(g => CUBE_LEVELS.map(b => [r, g, b] as const))),
  ...Array.from({ length: 24 }, (_, n) => [8 + n * 10, 8 + n * 10, 8 + n * 10] as const),
]
const nearest256 = (color: number): number => {
  const rgb = rgbOf(color)
  let best = 0
  XTERM_256.forEach((each, index) => {
    if (distance(rgb, each) < distance(rgb, XTERM_256[best] ?? each)) best = index
  })
  return best
}

test('on a 256-color terminal, no two of a palette’s or legendary’s colors round to the same color', () => {
  const sets = [...KIT.palettes, ...KIT.legendaries].flatMap(({ id, colors, shiny }) => [
    { what: id, colors: Object.values(colors) },
    { what: `${id} shiny`, colors: Object.values(shiny) },
  ])
  for (const { what, colors } of sets) {
    const distinct = [...new Set(colors)]
    if (new Set(distinct.map(nearest256)).size !== distinct.length) throw new Error(`Two of ${what}'s colors round to one`)
  }
})

/** WCAG relative luminance. */
function luminance(color: number): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgbOf(color)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio, 1 to 21. */
function contrast(one: number, other: number): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

// The backgrounds of a typical dark and light terminal, which see-through pixels show
const DARK_TERMINAL = 0x1e1e1e
const LIGHT_TERMINAL = 0xfafafa

test('every outline shows against a dark and a light terminal, and every face against its body', () => {
  for (const { id, colors, shiny } of [...KIT.palettes, ...KIT.legendaries]) {
    for (const [what, each] of [[id, colors], [`${id} shiny`, shiny]] as const) {
      if (contrast(each.outline, DARK_TERMINAL) < 2.5) throw new Error(`${what}'s outline is lost on a dark terminal`)
      if (contrast(each.outline, LIGHT_TERMINAL) < 3) throw new Error(`${what}'s outline is lost on a light terminal`)
      if (contrast(each.outline, each.base) < 2.5) throw new Error(`${what}'s eyes are lost on its body`)
    }
  }
})

/** The foreground and background pairs a squishy's half-block cells paint. */
function colorPairs(squishy: Squishy): Set<string> {
  const pixels = compose(KIT, squishy, { state: 'working', frame: 0 })
  const pairs = new Set<string>()
  for (let row = 0; row < pixels.length; row += 2) {
    pixels[row]?.forEach((top, column) => pairs.add(`${top}/${pixels[row + 1]?.[column]}`))
  }
  return pairs
}

test('a full roster of nine squishys paints fewer than the 1024 color pairs a Raster paints exactly', () => {
  const most = Math.max(...[...ROLLED.slice(0, 300), ...eachPart(KIT)].map(squishy => colorPairs(squishy).size))

  expect(most * 9).toBeLessThan(1024)
})
