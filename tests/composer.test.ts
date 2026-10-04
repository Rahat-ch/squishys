import { expect, test } from 'claude-code/testing'

import { BUBBLE_COLOR, MARK_COLOR, RING_COLOR, SPARKLE_COLOR, ZZZ_COLOR, compose } from '../src/composer'
import type { Size } from '../src/composer'
import { KIT } from '../src/kit'
import type { Grid, Kit } from '../src/kit'
import { roll } from '../src/roller'
import { seeded } from '../src/seeded'
import { SQUISHY_STATES } from '../src/states'
import type { SquishyState } from '../src/states'
import { eachPart } from './pictures'

const BLANK: Grid = Array.from({ length: 16 }, () => '................')
const GREY = 0x808080
const SHINY_GREY = 0xc0c0c0
const EYE = 0x000000
const LEAF = 0x00ff00

/** A grid filled with one key, apart from the rows given by row number. */
function grid(fill: string, rows: Readonly<Record<number, string>> = {}): Grid {
  return Array.from({ length: 16 }, (_, row) => rows[row] ?? fill.repeat(16))
}

const TEST_KIT: Kit = {
  bodies: [{ id: 'block', rarity: 'common', syllable: 'mo', grid: grid('b') }],
  faces: [{ id: 'eye', rarity: 'common', syllable: 'chi', grid: grid('.', { 5: '.....e..........' }) }],
  palettes: [
    { id: 'grey', rarity: 'common', syllable: '', colors: { b: GREY, e: EYE, a: LEAF }, shiny: { b: SHINY_GREY, e: EYE, a: LEAF } },
  ],
  accessories: [{ id: 'leaf', rarity: 'common', syllable: '', grid: grid('.', { 0: 'a...............' }) }],
  legendaries: [],
  starters: [],
}

const PLAIN = roll(TEST_KIT, { live: [], rng: seeded(1), odds: { shiny: 0 } })
const SHINY = roll(TEST_KIT, { live: [], rng: seeded(1), odds: { shiny: 1 } })

test('a squishy is its body, with its face and then its accessory drawn over it, in its palette', () => {
  const pixels = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0 })

  expect(pixels[5]?.[5]).toBe(EYE)
  expect(pixels[0]?.[0]).toBe(LEAF)
  expect(pixels[15]?.[15]).toBe(GREY)
})

test('a shiny squishy is drawn in its palette’s shiny colors', () => {
  const plain = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0 })
  const shiny = compose(TEST_KIT, SHINY, { state: 'working', frame: 0 })

  expect(plain[10]?.[10]).toBe(GREY)
  expect(shiny[10]?.[10]).toBe(SHINY_GREY)
  // The parts drawn over the body keep their own colors
  expect(shiny[5]?.[5]).toBe(EYE)
})

test('at 2× every pixel becomes a 2x2 block', () => {
  const pixels = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0, size: 'double' })

  expect(pixels).toHaveLength(32)
  expect(pixels[0]?.slice(0, 3)).toEqual([LEAF, LEAF, GREY])
  expect(pixels[1]?.slice(0, 3)).toEqual([LEAF, LEAF, GREY])
  expect(pixels[10]?.slice(9, 13)).toEqual([GREY, EYE, EYE, GREY])
  expect(pixels[11]?.slice(9, 13)).toEqual([GREY, EYE, EYE, GREY])
})

test('the 8x8 mini keeps a pixel wherever most of its 2x2 block is drawn', () => {
  // Left half drawn, right half see-through, a lone pixel at the far right
  const kit: Kit = {
    ...TEST_KIT,
    bodies: [{ id: 'half', rarity: 'common', syllable: 'mo', grid: grid('.', Object.fromEntries(
      Array.from({ length: 16 }, (_, row) => [row, 'bbbbbbbb.......' + (row === 0 ? 'b' : '.')]),
    )) }],
    faces: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
    accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
  }
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } })

  const mini = compose(kit, squishy, { state: 'working', frame: 0, size: 'mini' })

  const row = [GREY, GREY, GREY, GREY, null, null, null, null]
  expect(mini).toEqual(Array.from({ length: 8 }, () => row))
})

const SIDES: Readonly<Record<Size, number>> = { full: 16, double: 32, mini: 8 }

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
    if (!(asleep[0]?.[12] === ZZZ_COLOR && asleep[1]?.[13] === ZZZ_COLOR)) throw new Error(`${what} has no z asleep`)
    const squished = at('squished', 0)
    if (rowsDrawn(squished).some(row => row < 7)) throw new Error(`${what} is not flat when Squished`)
    const bottom = Math.max(...rowsDrawn(still))
    if (JSON.stringify(squished[bottom]) !== JSON.stringify(still[bottom])) throw new Error(`${what} leaves its bottom row`)
  }
})

test('kit art the composer can’t draw is an error, not a gap in the picture', () => {
  const [face] = TEST_KIT.faces
  if (face === undefined) throw new Error('TEST_KIT has a face')
  const uncolored: Kit = { ...TEST_KIT, faces: [{ ...face, grid: grid('.', { 5: '.....q..........' }) }] }
  const short: Kit = { ...TEST_KIT, faces: [{ ...face, grid: BLANK.slice(1) }] }

  expect(() => compose(uncolored, PLAIN, { state: 'working', frame: 0 })).toThrow('no color for "q"')
  expect(() => compose(short, PLAIN, { state: 'working', frame: 0 })).toThrow('16x16')
})

// The poses: each state's picture is made from the squishy's own 16x16
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

// A pixel near the top and one near the bottom
const MARKERS = grid('.', { 2: '.......b........', 12: '.......b........' })

test('a Working squishy wiggles: upright for two frames, then its top leans over for two', () => {
  const at = (frame: number) => posed(kitWith(MARKERS), 'working', frame)

  expect(drawnIn(at(0), 2)).toEqual([7])
  expect(drawnIn(at(0), 12)).toEqual([7])
  expect(at(1)).toEqual(at(0))
  expect(drawnIn(at(2), 2)).toEqual([8])
  expect(drawnIn(at(2), 12)).toEqual([7])
  expect(at(3)).toEqual(at(2))
  expect(at(4)).toEqual(at(0))
})

test('a Thinking squishy bounces every frame, twice as fast as the wiggle: a pixel down, then back up', () => {
  const at = (frame: number) => posed(kitWith(MARKERS), 'thinking', frame)

  expect(rowsDrawn(at(0))).toEqual([3, 13])
  expect(drawnIn(at(0), 3)).toEqual([7])
  expect(rowsDrawn(at(1))).toEqual([2, 12])
  expect(at(2)).toEqual(at(0))
  expect(at(3)).toEqual(at(1))
})

// Two eyes two pixels tall, one a pixel wide and one two wide
const EYES = grid('.', { 5: '.....e...ee.....', 6: '.....e...ee.....' })

test('an Asleep squishy shuts its eyes to a line along their bottom, and a z floats up top right', () => {
  const asleep = posed(kitWith(grid('b'), EYES), 'asleep', 0)

  // The eyes' upper row is body again
  expect(asleep[5]?.slice(3, 12)).toEqual([GREY, GREY, GREY, GREY, GREY, GREY, GREY, GREY, GREY])
  // A one-pixel eye shuts as a line three wide, a wider one as wide as it was
  expect(asleep[6]?.slice(3, 12)).toEqual([GREY, EYE, EYE, EYE, GREY, GREY, EYE, EYE, GREY])
  const z = (row: number) => drawnIn(asleep.map(line => line.map(pixel => (pixel === ZZZ_COLOR ? pixel : null))), row)
  expect([z(0), z(1), z(2)]).toEqual([[12, 13, 14], [13], [12, 13, 14]])
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

  expect(topRight(needsYou, 6, 7)).toEqual(['.kkkkk', '.kw!wk', '.kw!wk', '.kwwwk', '.kw!wk', '.kkkkk', '......'])
  // Everywhere else it is the still picture
  expect(needsYou.slice(6)).toEqual(still.slice(6))
  expect(needsYou.map(row => row.slice(0, 11))).toEqual(still.map(row => row.slice(0, 11)))
  expect(posed(kitWith(grid('b')), 'needsYou', 1)).toEqual(needsYou)
})

test('the “!” bubble is drawn at the picture’s own size: twice as big at 2×, a compact ringed “!” on the mini', () => {
  const kit = kitWith(grid('b'))
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } })

  const double = compose(kit, squishy, { state: 'needsYou', frame: 0, size: 'double' })
  const big = ['kkkkk', 'kw!wk', 'kw!wk', 'kwwwk', 'kw!wk', 'kkkkk'].flatMap(row => {
    const wide = [...row].map(key => key + key).join('')
    return [wide, wide]
  })
  expect(topRight(double, 10, 12)).toEqual(big)
  expect(topRight(double, 11, 13)[12]).toBe('...........')

  const mini = compose(kit, squishy, { state: 'needsYou', frame: 0, size: 'mini' })
  expect(topRight(mini, 4, 6)).toEqual(['.kkk', '.k!k', '.kkk', '.k!k', '.kkk', '....'])
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
  // A post from row 2 to a floor at row 14, a mark on row 4 and one on row 5
  const body = grid('.', {
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 2, '.......b........'])),
    4: '...b...b........',
    5: '.......b....b...',
    14: 'bbbbbbbbbbbbbbbb',
  })

  const squished = posed(kitWith(body), 'squished', 0)

  expect(rowsDrawn(squished)).toEqual([8, 9, 10, 11, 12, 13, 14])
  expect(drawnIn(squished, 14)).toHaveLength(16)
  expect(drawnIn(squished, 9)).toEqual([3, 7])
  expect(squished.some(row => row[12] !== null && row !== squished[14])).toBe(false)
  expect(posed(kitWith(body), 'squished', 1)).toEqual(squished)
})

test('a legendary shuts its eyes too, over its own body color', () => {
  const kit: Kit = {
    ...TEST_KIT,
    legendaries: [
      {
        id: 'blob',
        name: 'Blob',
        grid: grid('b', { 5: 'bbbbbebbbbbbbbbb', 6: 'bbbbbebbbbbbbbbb' }),
        colors: { b: GREY, e: EYE },
        shiny: { b: SHINY_GREY, e: EYE },
      },
    ],
  }
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { legendary: 1, shiny: 0 } })

  const asleep = compose(kit, squishy, { state: 'asleep', frame: 0 })

  expect(asleep[5]?.[5]).toBe(GREY)
  expect(asleep[6]?.slice(4, 7)).toEqual([EYE, EYE, EYE])
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

const GLINT_GOLD = 0xffaa00
const SPARKLY_KIT: Kit = {
  ...TEST_KIT,
  palettes: TEST_KIT.palettes.map(palette => ({ ...palette, shiny: { ...palette.shiny, sparkle: GLINT_GOLD } })),
}

test('a sparkling squishy shows glints over its picture that move from frame to frame, in SPARKLE_COLOR where its colors give none', () => {
  const glints = [0, 1, 2, 3].map(frame =>
    changed(compose(TEST_KIT, SHINY, { state: 'working', frame }), compose(TEST_KIT, SHINY, { state: 'working', frame, sparkle: true })),
  )

  for (const { at, colors } of glints) {
    expect(at.length).toBeGreaterThan(0)
    expect([...colors]).toEqual([SPARKLE_COLOR])
  }
  for (const [frame, { at }] of glints.entries()) {
    if (frame > 0) expect(at).not.toEqual(glints[frame - 1]?.at)
  }
})

test('a shiny’s glints take its palette’s sparkle color when it has one', () => {
  const { colors } = changed(compose(SPARKLY_KIT, SHINY, { state: 'asleep', frame: 0 }), compose(SPARKLY_KIT, SHINY, { state: 'asleep', frame: 0, sparkle: true }))

  expect([...colors]).toEqual([GLINT_GOLD])
})

test('glints are drawn at the picture’s own size: two pluses at full size, twice as long at 2×, lone pixels on the mini', () => {
  const glintsAt = (size: Size, frame: number) =>
    changed(compose(TEST_KIT, SHINY, { state: 'asleep', frame, size }), compose(TEST_KIT, SHINY, { state: 'asleep', frame, size, sparkle: true })).at.length

  // A glint is a lone pixel, then a plus whose arms are a pixel of the kit's art long
  expect(glintsAt('full', 0)).toBe(2)
  expect(glintsAt('full', 1)).toBe(2 * 5)
  expect(glintsAt('double', 1)).toBe(2 * 9)
  expect(glintsAt('mini', 1)).toBe(2)
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
