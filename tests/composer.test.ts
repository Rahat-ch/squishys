import { expect, test } from 'claude-code/testing'

import { BUBBLE_COLOR, MARK_COLOR, PICTURE_SIZE, RING_COLOR, SIDES, SPARKLE_COLOR, ZZZ_COLOR, compose } from '../src/composer'
import type { Size } from '../src/composer'
import { KIT } from '../src/kit'
import type { Colors, Grid, Kit, ShinyColors } from '../src/kit'
import { roll } from '../src/roller'
import { seeded } from '../src/seeded'
import { SQUISHY_STATES } from '../src/states'
import type { SquishyState } from '../src/states'
import { eachPart } from './pictures'

const GREY = 0x808080
const SHINY_GREY = 0xc0c0c0
const EYE = 0x000000
const SHADE = 0x404040
const LIGHT = 0xe0e0e0
const SHINY_LIGHT = 0xf0f0f0
const SPARKLE = 0xffff00

const COLORS: Colors = { outline: EYE, dark: SHADE, base: GREY, highlight: LIGHT }
const SHINY_COLORS: ShinyColors = { outline: EYE, dark: SHADE, base: SHINY_GREY, highlight: SHINY_LIGHT, sparkle: SPARKLE }

/** A grid filled with one key, apart from the rows given by row number. */
function grid(fill: string, rows: Readonly<Record<number, string>> = {}): Grid {
  return Array.from({ length: PICTURE_SIZE }, (_, row) => (rows[row] ?? fill.repeat(PICTURE_SIZE)).padEnd(PICTURE_SIZE, '.'))
}

const BLANK = grid('.')

const TEST_KIT: Kit = {
  bodies: [{ id: 'block', rarity: 'common', syllable: 'mo', grid: grid('b') }],
  faces: [{ id: 'eye', rarity: 'common', syllable: 'chi', grid: grid('.', { 5: '.....e' }) }],
  palettes: [{ id: 'grey', rarity: 'common', syllable: '', colors: COLORS, shiny: SHINY_COLORS }],
  accessories: [{ id: 'leaf', rarity: 'common', syllable: '', grid: grid('.', { 0: 'h' }) }],
  legendaries: [],
  starters: [],
}

const PLAIN = roll(TEST_KIT, { live: [], rng: seeded(1), odds: { shiny: 0 } })
const SHINY = roll(TEST_KIT, { live: [], rng: seeded(1), odds: { shiny: 1 } })

test('a squishy is its body, with its face and then its accessory drawn over it, in its palette', () => {
  const pixels = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0 })

  expect(pixels[5]?.[5]).toBe(EYE)
  expect(pixels[0]?.[0]).toBe(LIGHT)
  expect(pixels[PICTURE_SIZE - 1]?.[PICTURE_SIZE - 1]).toBe(GREY)
})

test('every key draws in one of the four colors: eyes and mouth in the outline, blush in the dark shade', () => {
  const kit: Kit = { ...TEST_KIT, bodies: [{ id: 'keys', rarity: 'common', syllable: 'mo', grid: grid('b', { 1: 'oemdcbh' }) }] }
  const pixels = compose(kit, roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } }), { state: 'working', frame: 0 })

  expect(pixels[1]?.slice(0, 7)).toEqual([EYE, EYE, EYE, SHADE, SHADE, GREY, LIGHT])
})

test('a shiny squishy is drawn in its palette’s shiny colors', () => {
  const plain = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0 })
  const shiny = compose(TEST_KIT, SHINY, { state: 'working', frame: 0 })

  expect(plain[PICTURE_SIZE - 2]?.[PICTURE_SIZE - 2]).toBe(GREY)
  expect(shiny[PICTURE_SIZE - 2]?.[PICTURE_SIZE - 2]).toBe(SHINY_GREY)
  expect(shiny[5]?.[5]).toBe(EYE)
})

test('a glint sparkles only on a shiny, and is plain highlight otherwise', () => {
  const kit: Kit = { ...TEST_KIT, bodies: [{ id: 'glinting', rarity: 'common', syllable: 'mo', grid: grid('b', { 2: 'b*' }) }] }
  const at = (shiny: number) =>
    compose(kit, roll(kit, { live: [], rng: seeded(1), odds: { shiny } }), { state: 'working', frame: 0 })[2]?.[1]

  expect(at(0)).toBe(LIGHT)
  expect(at(1)).toBe(SPARKLE)
})

test('at 2× every pixel becomes a 2x2 block', () => {
  const pixels = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0, size: 'double' })

  expect(pixels).toHaveLength(PICTURE_SIZE * 2)
  expect(pixels[0]?.slice(0, 3)).toEqual([LIGHT, LIGHT, GREY])
  expect(pixels[1]?.slice(0, 3)).toEqual([LIGHT, LIGHT, GREY])
  expect(pixels[10]?.slice(9, 13)).toEqual([GREY, EYE, EYE, GREY])
  expect(pixels[11]?.slice(9, 13)).toEqual([GREY, EYE, EYE, GREY])
})

test('the mini at half size keeps a pixel wherever most of its 2x2 block is drawn', () => {
  // Two blocks' worth drawn at the left, see-through after, a lone pixel at the far right
  const drawnBlocks = 2
  const left = 'b'.repeat(drawnBlocks * 2)
  const kit: Kit = {
    ...TEST_KIT,
    bodies: [{ id: 'half', rarity: 'common', syllable: 'mo', grid: grid('.', Object.fromEntries(
      Array.from({ length: PICTURE_SIZE }, (_, row) => [row, row === 0 ? left.padEnd(PICTURE_SIZE - 1, '.') + 'b' : left]),
    )) }],
    faces: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
    accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
  }
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } })

  const mini = compose(kit, squishy, { state: 'working', frame: 0, size: 'mini' })

  const row = Array.from({ length: PICTURE_SIZE / 2 }, (_, column) => (column < drawnBlocks ? GREY : null))
  expect(mini).toEqual(Array.from({ length: PICTURE_SIZE / 2 }, () => row))
})

function wellFormed(pixels: ReturnType<typeof compose>, side: number): boolean {
  return (
    pixels.length === side &&
    pixels.every(
      row =>
        row.length === side &&
        row.every(pixel => pixel === null || (Number.isInteger(pixel) && pixel >= 0 && pixel <= 0xffffff)),
    )
  )
}

test('every part and legendary composes to a well-formed grid at every size, state and frame', () => {
  for (const squishy of eachPart(KIT)) {
    for (const state of SQUISHY_STATES) {
      for (const frame of [0, 1, 2, 3]) {
        for (const [size, side] of Object.entries(SIDES) as [Size, number][]) {
          const pixels = compose(KIT, squishy, { state, frame, size })
          const what = `${JSON.stringify(squishy)} ${state} ${frame} ${size}`
          if (!wellFormed(pixels, side)) throw new Error(`${what} is not a ${side}x${side} grid of colors`)
          if (!pixels.some(row => row.some(pixel => pixel !== null))) throw new Error(`${what} draws nothing`)
        }
      }
    }
  }
})

test('with every part and legendary, a squishy moves when Working or Thinking, sleeps with a z and lies flat when Squished', () => {
  for (const squishy of eachPart(KIT)) {
    const at = (state: SquishyState, frame: number) => compose(KIT, squishy, { state, frame })
    const still = at('working', 0)
    const what = JSON.stringify(squishy)
    if (JSON.stringify(at('working', 2)) === JSON.stringify(still)) throw new Error(`${what} does not wiggle`)
    if (JSON.stringify(at('thinking', 0)) === JSON.stringify(at('thinking', 1))) throw new Error(`${what} does not bounce`)
    if (JSON.stringify(at('thinking', 0)) === JSON.stringify(still)) throw new Error(`${what} looks Working when Thinking`)
    const asleep = at('asleep', 0)
    if (!(asleep[0]?.[PICTURE_SIZE - 4] === ZZZ_COLOR && asleep[1]?.[PICTURE_SIZE - 3] === ZZZ_COLOR)) throw new Error(`${what} has no z asleep`)
    const squished = at('squished', 0)
    if (rowsDrawn(squished).some(row => row < PICTURE_SIZE / 2 - 1)) throw new Error(`${what} is not flat when Squished`)
    const bottom = Math.max(...rowsDrawn(still))
    if (JSON.stringify(squished[bottom]) !== JSON.stringify(still[bottom])) throw new Error(`${what} leaves its bottom row`)
  }
})

test('kit art the composer can’t draw is an error, not a gap in the picture', () => {
  const [face] = TEST_KIT.faces
  if (face === undefined) throw new Error('TEST_KIT has a face')
  const uncolored: Kit = { ...TEST_KIT, faces: [{ ...face, grid: grid('.', { 5: '.....q' }) }] }
  const short: Kit = { ...TEST_KIT, faces: [{ ...face, grid: BLANK.slice(1) }] }

  expect(() => compose(uncolored, PLAIN, { state: 'working', frame: 0 })).toThrow('no color for "q"')
  expect(() => compose(short, PLAIN, { state: 'working', frame: 0 })).toThrow(`${PICTURE_SIZE}x${PICTURE_SIZE}`)
})

// The poses: each state's picture is made from the squishy's own still
// picture, so these kits draw single pixels to follow where they go.

/** A kit with this body and face, no accessory, in TEST_KIT's palette. */
function kitWith(body: Grid, face: Grid = BLANK): Kit {
  return {
    ...TEST_KIT,
    bodies: [{ id: 'body', rarity: 'common', syllable: 'mo', grid: body }],
    faces: [{ id: 'face', rarity: 'common', syllable: '', grid: face }],
    accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
  }
}

function posed(kit: Kit, state: SquishyState, frame: number) {
  return compose(kit, roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } }), { state, frame })
}

/** The columns of a row that are drawn. */
function drawnIn(pixels: ReturnType<typeof compose>, row: number): number[] {
  return (pixels[row] ?? []).flatMap((pixel, column) => (pixel === null ? [] : [column]))
}

/** The rows that have anything drawn. */
function rowsDrawn(pixels: ReturnType<typeof compose>): number[] {
  return pixels.flatMap((row, index) => (row.some(pixel => pixel !== null) ? [index] : []))
}

// A pixel near the top and one near the bottom, in one column
const COLUMN = PICTURE_SIZE / 2 - 1
const [TOP, LOW] = [2, PICTURE_SIZE - 4]
const MARKERS = grid('.', { [TOP]: 'b'.padStart(COLUMN + 1, '.'), [LOW]: 'b'.padStart(COLUMN + 1, '.') })

test('a Working squishy wiggles: upright for two frames, then its top leans over for two', () => {
  const at = (frame: number) => posed(kitWith(MARKERS), 'working', frame)

  expect(drawnIn(at(0), TOP)).toEqual([COLUMN])
  expect(drawnIn(at(0), LOW)).toEqual([COLUMN])
  expect(at(1)).toEqual(at(0))
  expect(drawnIn(at(2), TOP)).toEqual([COLUMN + 1])
  expect(drawnIn(at(2), LOW)).toEqual([COLUMN])
  expect(at(3)).toEqual(at(2))
  expect(at(4)).toEqual(at(0))
})

test('a Thinking squishy bounces every frame, twice as fast as the wiggle: a pixel down, then back up', () => {
  const at = (frame: number) => posed(kitWith(MARKERS), 'thinking', frame)

  expect(rowsDrawn(at(0))).toEqual([TOP + 1, LOW + 1])
  expect(drawnIn(at(0), TOP + 1)).toEqual([COLUMN])
  expect(rowsDrawn(at(1))).toEqual([TOP, LOW])
  expect(at(2)).toEqual(at(0))
  expect(at(3)).toEqual(at(1))
})

// Two eyes two pixels tall: left of the middle one a pixel wide, right of it one two wide
const EYES = grid('.', { 5: '..e...ee', 6: '..e...ee' })

test('an Asleep squishy shuts its eyes to a line along their bottom, and a z floats up top right', () => {
  const asleep = posed(kitWith(grid('b'), EYES), 'asleep', 0)

  // The eyes' upper row is body again
  expect(asleep[5]).toEqual(Array.from({ length: PICTURE_SIZE }, () => GREY))
  // A one-pixel eye shuts as a line two wide, widening outward; a wider one stays as wide as it was
  expect(asleep[6]?.slice(0, 9)).toEqual([GREY, EYE, EYE, GREY, GREY, GREY, EYE, EYE, GREY])
  const z = (row: number) => drawnIn(asleep.map(line => line.map(pixel => (pixel === ZZZ_COLOR ? pixel : null))), row)
  const right = [PICTURE_SIZE - 4, PICTURE_SIZE - 3, PICTURE_SIZE - 2]
  expect([z(0), z(1), z(2)]).toEqual([right, [PICTURE_SIZE - 3], right])
  // Asleep holds still
  expect(posed(kitWith(grid('b'), EYES), 'asleep', 1)).toEqual(asleep)
})

/** The top right of a picture, `width` by `height`, as the bubble's keys: `k` ring, `w` bubble, `!` mark. */
function topRight(pixels: ReturnType<typeof compose>, width: number, height: number): string[] {
  const key = (pixel: number | null) =>
    pixel === RING_COLOR ? 'k' : pixel === BUBBLE_COLOR ? 'w' : pixel === MARK_COLOR ? '!' : '.'
  return pixels.slice(0, height).map(row => row.slice(row.length - width).map(key).join(''))
}

test('a squishy that Needs you holds still with a ringed “!” bubble up top right, over its picture', () => {
  const needsYou = posed(kitWith(grid('b')), 'needsYou', 0)
  const still = posed(kitWith(grid('b')), 'working', 0)

  expect(topRight(needsYou, 4, 6)).toEqual(['.kkk', '.k!k', '.kkk', '.k!k', '.kkk', '....'])
  // Everywhere else it is the still picture
  expect(needsYou.slice(5)).toEqual(still.slice(5))
  expect(needsYou.map(row => row.slice(0, PICTURE_SIZE - 3))).toEqual(still.map(row => row.slice(0, PICTURE_SIZE - 3)))
  expect(posed(kitWith(grid('b')), 'needsYou', 1)).toEqual(needsYou)
})

test('the “!” bubble is drawn at the picture’s own size: the whole bubble at 2×, a ringed dot on the mini', () => {
  const kit = kitWith(grid('b'))
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } })

  const double = compose(kit, squishy, { state: 'needsYou', frame: 0, size: 'double' })
  expect(topRight(double, 6, 7)).toEqual(['.kkkkk', '.kw!wk', '.kw!wk', '.kwwwk', '.kw!wk', '.kkkkk', '......'])

  const mini = compose(kit, squishy, { state: 'needsYou', frame: 0, size: 'mini' })
  expect(topRight(mini, 4, 4)).toEqual(['.kkk', '.k!k', '.kkk', '....'])
})

test('with every part and legendary, at every size, the “!” shows and the bubble’s ring differs from the squishy beneath it', () => {
  for (const squishy of eachPart(KIT)) {
    for (const size of Object.keys(SIDES) as Size[]) {
      const needsYou = compose(KIT, squishy, { state: 'needsYou', frame: 0, size })
      const still = compose(KIT, squishy, { state: 'working', frame: 0, size })
      const what = `${JSON.stringify(squishy)} ${size}`
      if (!needsYou.some(row => row.includes(MARK_COLOR))) throw new Error(`${what} shows no “!”`)
      needsYou.forEach((row, at) =>
        row.forEach((pixel, column) => {
          if (pixel === RING_COLOR && still[at]?.[column] === RING_COLOR) {
            throw new Error(`${what}: the bubble’s ring at ${at},${column} is the color beneath it`)
          }
        }),
      )
    }
  }
})

test('a Squished squishy lies flat: half as tall, every other row kept, still standing on its bottom row', () => {
  // A post from row 2 to a floor, a mark on row 4 and one on row 5
  const floor = PICTURE_SIZE - 2
  const post = 'b'.padStart(COLUMN + 1, '.')
  const body = grid('.', {
    ...Object.fromEntries(Array.from({ length: floor - 2 }, (_, index) => [index + 2, post])),
    4: post.slice(0, 3) + 'b' + post.slice(4),
    5: post.padEnd(PICTURE_SIZE - 3, '.') + 'b',
    [floor]: 'b'.repeat(PICTURE_SIZE),
  })

  const squished = posed(kitWith(body), 'squished', 0)

  // Row r of the flat picture shows row 2r - floor of the upright one
  const firstRow = (2 + floor) / 2
  expect(rowsDrawn(squished)).toEqual(Array.from({ length: floor - firstRow + 1 }, (_, index) => firstRow + index))
  expect(drawnIn(squished, floor)).toHaveLength(PICTURE_SIZE)
  expect(drawnIn(squished, (4 + floor) / 2)).toEqual([3, COLUMN])
  // Row 5 falls between kept rows, so its mark is gone
  expect(squished.some(row => row[PICTURE_SIZE - 3] !== null && row !== squished[floor])).toBe(false)
  expect(posed(kitWith(body), 'squished', 1)).toEqual(squished)
})

test('a legendary shuts its eyes too, over its own body color', () => {
  const kit: Kit = {
    ...TEST_KIT,
    legendaries: [
      { id: 'blob', name: 'Blob', grid: grid('b', { 5: 'bbebbbbbbb', 6: 'bbebbbbbbb' }), colors: COLORS, shiny: SHINY_COLORS },
    ],
  }
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { legendary: 1, shiny: 0 } })

  const asleep = compose(kit, squishy, { state: 'asleep', frame: 0 })

  expect(asleep[5]?.[2]).toBe(GREY)
  expect(asleep[6]?.slice(1, 4)).toEqual([EYE, EYE, GREY])
})

// Sparkles: a shiny or legendary squishy's glints, for a while after it appears

/** The pixels where `over` differs from `under`, as "row,column", with the colors `over` shows there. */
function changed(under: ReturnType<typeof compose>, over: ReturnType<typeof compose>): { at: string[]; colors: Set<number | null> } {
  const at: string[] = []
  const colors = new Set<number | null>()
  over.forEach((row, r) =>
    row.forEach((pixel, c) => {
      if (pixel !== under[r]?.[c]) {
        at.push(`${r},${c}`)
        colors.add(pixel)
      }
    }),
  )
  return { at, colors }
}

const GLINT_WARM = 0xffaa00
const SPARKLY_KIT: Kit = {
  ...TEST_KIT,
  palettes: TEST_KIT.palettes.map(palette => ({ ...palette, shiny: { ...palette.shiny, sparkle: GLINT_WARM } })),
}

test('a sparkling shiny shows glints over its picture that move from frame to frame, in its palette’s sparkle color', () => {
  const glints = [0, 1, 2, 3].map(frame =>
    changed(compose(SPARKLY_KIT, SHINY, { state: 'working', frame }), compose(SPARKLY_KIT, SHINY, { state: 'working', frame, sparkle: true })),
  )

  for (const { at, colors } of glints) {
    expect(at.length).toBeGreaterThan(0)
    expect([...colors]).toEqual([GLINT_WARM])
  }
  for (const [frame, { at }] of glints.entries()) {
    if (frame > 0) expect(at).not.toEqual(glints[frame - 1]?.at)
  }
})

test('a plain legendary’s glints, which its colors give no sparkle for, are SPARKLE_COLOR', () => {
  const kit: Kit = { ...TEST_KIT, legendaries: [{ id: 'blob', name: 'Blob', grid: grid('b'), colors: COLORS, shiny: SHINY_COLORS }] }
  const legendary = roll(kit, { live: [], rng: seeded(1), odds: { legendary: 1, shiny: 0 } })

  const { colors } = changed(compose(kit, legendary, { state: 'asleep', frame: 0 }), compose(kit, legendary, { state: 'asleep', frame: 0, sparkle: true }))

  expect([...colors]).toEqual([SPARKLE_COLOR])
})

test('glints are drawn at the picture’s own size: two pluses at full size, twice as long at 2×, lone pixels that twinkle on the mini', () => {
  const glintsAt = (size: Size, frame: number) =>
    changed(compose(TEST_KIT, SHINY, { state: 'asleep', frame, size }), compose(TEST_KIT, SHINY, { state: 'asleep', frame, size, sparkle: true })).at.length

  // A glint is a lone pixel, then a plus whose arms are a pixel of the kit's art long
  expect(glintsAt('full', 0)).toBe(2)
  expect(glintsAt('full', 1)).toBe(2 * 5)
  expect(glintsAt('double', 1)).toBe(2 * 9)
  expect(glintsAt('mini', 0)).toBe(2)
  expect(glintsAt('mini', 1)).toBe(0)
})

test('a sparkling squishy that Needs you keeps its “!” bubble on top of the glints', () => {
  for (const frame of [0, 1, 2, 3]) {
    const plain = compose(TEST_KIT, SHINY, { state: 'needsYou', frame })
    const sparkling = compose(TEST_KIT, SHINY, { state: 'needsYou', frame, sparkle: true })
    for (const [r, row] of plain.entries()) {
      for (const [c, pixel] of row.entries()) {
        if (pixel === RING_COLOR || pixel === BUBBLE_COLOR || pixel === MARK_COLOR) expect(sparkling[r]?.[c]).toBe(pixel)
      }
    }
  }
})
