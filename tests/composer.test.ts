import { expect, test } from 'claude-code/testing'

import { BUBBLE_COLOR, MARK_COLOR, PICTURE_SIZE, RING_COLOR, SHUT_EYE_WIDTH, SIDES, ZZZ_COLOR, compose } from '../src/composer'
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

/** A grid filled with one key, with other keys at the cells given as [row, column, key]. */
function withCells(fill: string, cells: readonly (readonly [number, number, string])[]): Grid {
  return Array.from({ length: PICTURE_SIZE }, (_, row) =>
    Array.from({ length: PICTURE_SIZE }, (_, column) => cells.find(([r, c]) => r === row && c === column)?.[2] ?? fill).join(''),
  )
}

// The test kit's eye: a lone pixel in the middle
const EYE_AT = PICTURE_SIZE / 2

const TEST_KIT: Kit = {
  bodies: [{ id: 'block', rarity: 'common', syllable: 'mo', grid: grid('b') }],
  faces: [{ id: 'eye', rarity: 'common', syllable: 'chi', grid: withCells('.', [[EYE_AT, EYE_AT, 'e']]) }],
  palettes: [{ id: 'grey', rarity: 'common', syllable: '', colors: COLORS, shiny: SHINY_COLORS }],
  accessories: [{ id: 'leaf', rarity: 'common', syllable: '', grid: grid('.', { 0: 'h' }) }],
  legendaries: [],
  starters: [],
}

const PLAIN = roll(TEST_KIT, { live: [], rng: seeded(1), odds: { shiny: 0 } })
const SHINY = roll(TEST_KIT, { live: [], rng: seeded(1), odds: { shiny: 1 } })

test('a squishy is its body, with its face and then its accessory drawn over it, in its palette', () => {
  const pixels = compose(TEST_KIT, PLAIN, { state: 'working', frame: 0 })

  expect(pixels[EYE_AT]?.[EYE_AT]).toBe(EYE)
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
  expect(shiny[EYE_AT]?.[EYE_AT]).toBe(EYE)
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
  // The lone eye becomes the 2x2 block at twice its row and column
  const eyeBlock = [GREY, EYE, EYE, GREY]
  expect(pixels[2 * EYE_AT]?.slice(2 * EYE_AT - 1, 2 * EYE_AT + 3)).toEqual(eyeBlock)
  expect(pixels[2 * EYE_AT + 1]?.slice(2 * EYE_AT - 1, 2 * EYE_AT + 3)).toEqual(eyeBlock)
})

// The test palette's outline, which its eyes share
const OUTLINE = EYE

test('the mini at half size draws a pixel wherever at least half its 2x2 block is, and outlines the shape again', () => {
  // Three blocks' worth drawn at the left, see-through after, a lone pixel at the far right
  const left = 'bbbbbb'
  const kit = kitWith(grid('.', Object.fromEntries(
    Array.from({ length: PICTURE_SIZE }, (_, row) => [row, row === 0 ? left.padEnd(PICTURE_SIZE - 1, '.') + 'b' : left]),
  )))

  const mini = posed(kit, 'working', 0, 'mini')

  const last = PICTURE_SIZE / 2 - 1
  const row = (middle: number) => Array.from({ length: PICTURE_SIZE / 2 }, (_, column) => [OUTLINE, middle, OUTLINE][column] ?? null)
  expect(mini).toEqual(Array.from({ length: PICTURE_SIZE / 2 }, (_, index) => row(index === 0 || index === last ? OUTLINE : GREY)))
})

test('in the mini an eye survives, while a mouth and a shade give way to the fill', () => {
  // Three of the mini's blocks inside its outline, each half drawn in one key:
  // a shade above the middle, a one-pixel eye left of it, a mouth below it
  const middle = Math.floor(SIDES.mini / 2)
  const shade: Block = [middle - 1, middle]
  const eye: Block = [middle, middle - 1]
  const mouth: Block = [middle + 1, middle]
  const kit = kitWith(
    withCells('b', topHalf(shade, 'd')),
    withCells('.', [...rightHalf(eye, 'e'), ...topHalf(mouth, 'm')]),
  )

  const mini = posed(kit, 'working', 0, 'mini')

  expect(mini[shade[0]]?.[shade[1]]).toBe(GREY)
  expect(mini[eye[0]]?.[eye[1]]).toBe(EYE)
  expect(mini[mouth[0]]?.[mouth[1]]).toBe(GREY)
  // Asleep, the shut eye still shows, and a pixel of z sits top right
  const asleep = posed(kit, 'asleep', 0, 'mini')
  expect(asleep[eye[0]]?.[eye[1]]).toBe(EYE)
  expect(asleep[0]?.[SIDES.mini - 1]).toBe(ZZZ_COLOR)
})

/** One of the mini's pixels, by its row and column: the 2x2 block of the full picture it is shrunk from. */
type Block = readonly [row: number, column: number]
/** The top row of a block's full-size pixels, in one key. */
const topHalf = ([row, column]: Block, key: string) =>
  [[2 * row, 2 * column, key], [2 * row, 2 * column + 1, key]] as const
/** The right column of a block's full-size pixels, in one key. */
const rightHalf = ([row, column]: Block, key: string) =>
  [[2 * row, 2 * column + 1, key], [2 * row + 1, 2 * column + 1, key]] as const

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

/** How many pixels differ between two pictures of one size. */
function pixelsChanged(one: ReturnType<typeof compose>, other: ReturnType<typeof compose>): number {
  return one.reduce((count, row, r) => count + row.filter((pixel, c) => pixel !== other[r]?.[c]).length, 0)
}

// The fewest pixels that read as motion at any size: a lone pixel flickering
// on the mini is easy to miss
const VISIBLY = 2

test('with every part and legendary, at every size, a Working squishy’s wiggle and a Thinking one’s bounce visibly move', () => {
  const [mochi, flower] = [KIT.bodies.find(body => body.id === 'mochi'), KIT.accessories.find(accessory => accessory.id === 'flower')]
  if (mochi === undefined || flower === undefined) throw new Error('The kit has the mochi body and the flower accessory')
  const [first] = eachPart(KIT).filter(squishy => squishy.kind === 'assembled')
  if (first?.kind !== 'assembled') throw new Error('The kit makes assembled squishys')
  // The mochi with the flower once held still on the mini
  const squishys = [{ ...first, body: mochi.id, accessory: flower.id }, ...eachPart(KIT)]
  for (const squishy of squishys) {
    for (const size of Object.keys(SIDES) as Size[]) {
      const at = (state: SquishyState, frame: number) => compose(KIT, squishy, { state, frame, size })
      const what = `${JSON.stringify(squishy)} ${size}`
      // The wiggle holds each frame for two ticks
      const wiggled = pixelsChanged(at('working', 0), at('working', 2))
      if (wiggled < VISIBLY) throw new Error(`${what} wiggles by ${wiggled} pixels`)
      const bounced = pixelsChanged(at('thinking', 0), at('thinking', 1))
      if (bounced < VISIBLY) throw new Error(`${what} bounces by ${bounced} pixels`)
    }
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

function posed(kit: Kit, state: SquishyState, frame: number, size: Size = 'full') {
  return compose(kit, roll(kit, { live: [], rng: seeded(1), odds: { shiny: 0 } }), { state, frame, size })
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

test('on the mini, a Working squishy leans a whole pixel of the mini, down through its middle row', () => {
  const at = (frame: number) => posed(kitWith(grid('b')), 'working', frame, 'mini')
  // The top half of the mini's rows, its middle row among them where it has one
  const leaningRows = Math.ceil(SIDES.mini / 2)
  const every = Array.from({ length: SIDES.mini }, (_, column) => column)

  expect(at(0).map((_, row) => drawnIn(at(0), row))).toEqual(at(0).map(() => every))
  expect(at(2).map((_, row) => drawnIn(at(2), row))).toEqual(at(2).map((_, row) => (row < leaningRows ? every.slice(1) : every)))
  expect(at(1)).toEqual(at(0))
  expect(at(3)).toEqual(at(2))
})

test('with every part and legendary, the mini keeps its outline closed as it wiggles: no fill touches see-through or the edge', () => {
  for (const squishy of eachPart(KIT)) {
    const source = squishy.kind === 'legendary' ? KIT.legendaries.find(each => each.id === squishy.legendary) : KIT.palettes.find(each => each.id === squishy.palette)
    if (source === undefined) throw new Error(`The kit has the colors of ${JSON.stringify(squishy)}`)
    const { outline } = squishy.shiny ? source.shiny : source.colors
    for (const frame of [0, 2]) {
      const mini = compose(KIT, squishy, { state: 'working', frame, size: 'mini' })
      mini.forEach((row, r) =>
        row.forEach((pixel, c) => {
          if (pixel === null || pixel === outline) return
          const open = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([down, across]) => (mini[down ?? -1]?.[across ?? -1] ?? null) === null)
          if (open) throw new Error(`${JSON.stringify(squishy)} frame ${frame}: the fill at ${r},${c} has no outline beside it`)
        }),
      )
    }
  }
})

test('a Thinking squishy bounces every frame, twice as fast as the wiggle: a pixel down, then back up', () => {
  const at = (frame: number) => posed(kitWith(MARKERS), 'thinking', frame)

  expect(rowsDrawn(at(0))).toEqual([TOP + 1, LOW + 1])
  expect(drawnIn(at(0), TOP + 1)).toEqual([COLUMN])
  expect(rowsDrawn(at(1))).toEqual([TOP, LOW])
  expect(at(2)).toEqual(at(0))
  expect(at(3)).toEqual(at(1))
})

// Two eyes two pixels tall: left of the middle one a pixel wide, with room to
// widen outward; right of it one wider than a shut eye needs to be
const EYE_TOP = PICTURE_SIZE / 2 - 1
const NARROW_EYE = SHUT_EYE_WIDTH
const WIDE_EYE = { from: PICTURE_SIZE - 2 - SHUT_EYE_WIDTH, to: PICTURE_SIZE - 2 }
const EYES = withCells(
  '.',
  [EYE_TOP, EYE_TOP + 1].flatMap(row => [
    [row, NARROW_EYE, 'e'] as const,
    ...Array.from({ length: WIDE_EYE.to - WIDE_EYE.from + 1 }, (_, at) => [row, WIDE_EYE.from + at, 'e'] as const),
  ]),
)

/**
 * The columns a one-pixel eye at `column` shuts across: SHUT_EYE_WIDTH
 * wide, a pixel at a time outward (away from the middle) first, then inward.
 */
function shutSpan(column: number): { from: number; to: number } {
  const extra = SHUT_EYE_WIDTH - 1
  const [outward, inward] = [Math.ceil(extra / 2), Math.floor(extra / 2)]
  return column < (PICTURE_SIZE - 1) / 2 ? { from: column - outward, to: column + inward } : { from: column - inward, to: column + outward }
}

/** A row of body with eye-colored spans across it. */
function rowWithSpans(...spans: { from: number; to: number }[]): number[] {
  return Array.from({ length: PICTURE_SIZE }, (_, column) => (spans.some(({ from, to }) => column >= from && column <= to) ? EYE : GREY))
}

test('an Asleep squishy shuts its eyes to a line along their bottom, and a z floats up top right', () => {
  const asleep = posed(kitWith(grid('b'), EYES), 'asleep', 0)

  // The eyes' upper row is body again
  expect(asleep[EYE_TOP]).toEqual(Array.from({ length: PICTURE_SIZE }, () => GREY))
  // A one-pixel eye shuts as a line SHUT_EYE_WIDTH wide, widening outward first; a wider one stays as wide as it was
  expect(asleep[EYE_TOP + 1]).toEqual(rowWithSpans(shutSpan(NARROW_EYE), WIDE_EYE))
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
      {
        id: 'blob',
        name: 'Blob',
        grid: withCells('b', [[EYE_TOP, NARROW_EYE, 'e'], [EYE_TOP + 1, NARROW_EYE, 'e']]),
        colors: COLORS,
        shiny: SHINY_COLORS,
      },
    ],
  }
  const squishy = roll(kit, { live: [], rng: seeded(1), odds: { legendary: 1, shiny: 0 } })

  const asleep = compose(kit, squishy, { state: 'asleep', frame: 0 })

  expect(asleep[EYE_TOP]?.[NARROW_EYE]).toBe(GREY)
  expect(asleep[EYE_TOP + 1]).toEqual(rowWithSpans(shutSpan(NARROW_EYE)))
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

test('a plain legendary keeps to its four colors when it sparkles: its glints are its highlight, or its base over its highlight', () => {
  const glintsOn = (fill: string) => {
    const kit: Kit = { ...TEST_KIT, legendaries: [{ id: 'blob', name: 'Blob', grid: grid(fill), colors: COLORS, shiny: SHINY_COLORS }] }
    const legendary = roll(kit, { live: [], rng: seeded(1), odds: { legendary: 1, shiny: 0 } })
    return [0, 1].flatMap(frame => [
      ...changed(compose(kit, legendary, { state: 'working', frame }), compose(kit, legendary, { state: 'working', frame, sparkle: true })).colors,
    ])
  }

  expect(new Set(glintsOn('b'))).toEqual(new Set([LIGHT]))
  // Glints that landed on highlight would vanish, so they take the base instead
  expect(new Set(glintsOn('h'))).toEqual(new Set([GREY]))
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
