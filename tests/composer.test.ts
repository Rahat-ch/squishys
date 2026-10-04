import { expect, test } from 'claude-code/testing'

import { compose } from '../src/composer'
import type { Size, SquishyState } from '../src/composer'
import { KIT } from '../src/kit'
import type { Grid, Kit } from '../src/kit'
import { roll } from '../src/roller'
import type { Squishy } from '../src/roller'
import { seeded } from '../src/seeded'

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

const STATES: readonly SquishyState[] = ['working', 'thinking', 'needsYou', 'asleep', 'squished']
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

// Every squishy the kit can make, written out part by part
function everySquishy(kit: Kit): Squishy[] {
  const all: Squishy[] = []
  for (const shiny of [false, true]) {
    for (const { id, name } of kit.legendaries) all.push({ kind: 'legendary', legendary: id, shiny, name, key: id })
    for (const body of kit.bodies)
      for (const face of kit.faces)
        for (const palette of kit.palettes)
          for (const accessory of kit.accessories) {
            const parts = { body: body.id, face: face.id, palette: palette.id, accessory: accessory.id }
            all.push({ kind: 'assembled', ...parts, rarity: 'common', shiny, name: '', key: '' })
          }
  }
  return all
}

test('every squishy the kit makes composes to a well-formed grid at every size, state and frame', () => {
  for (const squishy of everySquishy(KIT)) {
    for (const state of STATES) {
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

test('kit art the composer can’t draw is an error, not a gap in the picture', () => {
  const [face] = TEST_KIT.faces
  if (face === undefined) throw new Error('TEST_KIT has a face')
  const uncolored: Kit = { ...TEST_KIT, faces: [{ ...face, grid: grid('.', { 5: '.....q..........' }) }] }
  const short: Kit = { ...TEST_KIT, faces: [{ ...face, grid: BLANK.slice(1) }] }

  expect(() => compose(uncolored, PLAIN, { state: 'working', frame: 0 })).toThrow('no color for "q"')
  expect(() => compose(short, PLAIN, { state: 'working', frame: 0 })).toThrow('16x16')
})
