import { expect, test } from 'claude-code/testing'

import { PICTURE_SIZE } from '../src/composer'
import { tinyFace } from '../src/face'
import type { Colors, Grid, Kit } from '../src/kit'
import type { Squishy } from '../src/roller'

const BODY = 0x808080
const EYE = 0x000000
const CHEEK = 0xff8899
const LEAF = 0x00ff00

// Eyes and mouth share the outline color, blush is the dark shade, and the leaf the highlight
const GREYS: Colors = { outline: EYE, dark: CHEEK, base: BODY, highlight: LEAF }

/** A grid of one key, apart from the rows given, by row number, each laid in from column `left`. */
function grid(fill: string, rows: Readonly<Record<number, string>> = {}, left = 0): Grid {
  return Array.from({ length: PICTURE_SIZE }, (_, row) => {
    const line = rows[row]
    return line === undefined ? fill.repeat(PICTURE_SIZE) : fill.repeat(left) + line + fill.repeat(PICTURE_SIZE - left - line.length)
  })
}

// Where the test faces sit in the picture
const TOP = PICTURE_SIZE / 2
const LEFT = Math.floor(PICTURE_SIZE / 4)

const TEST_KIT: Kit = {
  bodies: [{ id: 'block', rarity: 'common', syllable: 'mo', grid: grid('b') }],
  faces: [
    // Eyes two rows tall, then cheeks either side of the mouth: 6 across, 3 down
    { id: 'smile', rarity: 'common', syllable: 'chi', grid: grid('.', { [TOP]: 'e....e', [TOP + 1]: 'e....e', [TOP + 2]: 'c.mm.c' }, LEFT) },
    // A face already as small as the tiny face: 2 across, 2 down
    { id: 'dots', rarity: 'common', syllable: 'ni', grid: grid('.', { [TOP]: 'e.', [TOP + 1]: '.m' }, LEFT) },
    { id: 'blank', rarity: 'common', syllable: 'mu', grid: grid('.') },
  ],
  palettes: [
    { id: 'grey', rarity: 'common', syllable: '', colors: GREYS, shiny: { ...GREYS, sparkle: LEAF } },
  ],
  // Drawn beside the face, so a crop that strays shows it
  accessories: [{ id: 'leaf', rarity: 'common', syllable: '', grid: grid('.', { [TOP]: 'hh' }, LEFT - 2) }],
  legendaries: [{ id: 'mochi', name: 'Mochi', grid: grid('b'), colors: GREYS, shiny: { ...GREYS, sparkle: LEAF } }],
  starters: [],
}

function squishy(face: string): Squishy {
  return { kind: 'assembled', body: 'block', face, palette: 'grey', accessory: 'leaf', rarity: 'common', shiny: false, name: '', key: '' }
}

test('the tiny face is the picture where its face part is drawn, shrunk to one row of half blocks that keeps eyes, mouth and blush', () => {
  // Shrunk by 2: each 2x2 block shows its eye, else its mouth, else its
  // blush, so they outlast the body around them
  expect(tinyFace(TEST_KIT, squishy('smile'))).toEqual([
    [
      { glyph: '▀', color: '#000000', backgroundColor: '#ff8899' },
      { glyph: '▀', color: '#808080', backgroundColor: '#000000' },
      { glyph: '▀', color: '#000000', backgroundColor: '#ff8899' },
    ],
  ])
})

test('a face that already fits one row is drawn pixel for pixel', () => {
  expect(tinyFace(TEST_KIT, squishy('dots'))).toEqual([
    [
      { glyph: '▀', color: '#000000', backgroundColor: '#808080' },
      { glyph: '▀', color: '#808080', backgroundColor: '#000000' },
    ],
  ])
})

// The 4-color art: a 10x10 squishy whose eyes and mouth share the outline
// color and whose blush is the dark shade
const OUTLINE = 0x202030
const DARK = 0x806070
const BASE = 0xf0d0c0
const ART = 10
const AT = (PICTURE_SIZE - ART) / 2
const FOUR_COLORS: Colors = { outline: OUTLINE, dark: DARK, base: BASE, highlight: 0xffffff }
const FOUR_COLOR_KIT: Kit = {
  bodies: [
    {
      id: 'blob',
      rarity: 'common',
      syllable: 'mo',
      grid: grid('.', Object.fromEntries(Array.from({ length: ART }, (_, row) => [AT + row, row === 0 || row === ART - 1 ? 'o'.repeat(ART) : `o${'b'.repeat(ART - 2)}o`])), AT),
    },
  ],
  // Each eye beside a blush, so an eye and a blush share a shrunk block
  faces: [{ id: 'blush', rarity: 'common', syllable: 'chi', grid: grid('.', { [AT + 4]: 'ec....ce', [AT + 5]: 'ec....ce', [AT + 6]: '...mm...' }, AT + 1) }],
  palettes: [{ id: 'gbc', rarity: 'common', syllable: '', colors: FOUR_COLORS, shiny: { ...FOUR_COLORS, sparkle: 0xffff00 } }],
  accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: grid('.') }],
  legendaries: [],
  starters: [],
}

test('in the 4-color art, a shrunk block shows an eye over the blush beside it, and the mouth over the body', () => {
  const blushing: Squishy = { kind: 'assembled', body: 'blob', face: 'blush', palette: 'gbc', accessory: 'none', rarity: 'common', shiny: false, name: '', key: '' }

  expect(tinyFace(FOUR_COLOR_KIT, blushing)).toEqual([
    [
      { glyph: '▀', color: '#202030', backgroundColor: '#f0d0c0' },
      { glyph: '▀', color: '#f0d0c0', backgroundColor: '#202030' },
      { glyph: '▀', color: '#f0d0c0', backgroundColor: '#202030' },
      { glyph: '▀', color: '#202030', backgroundColor: '#f0d0c0' },
    ],
  ])
})

test('a squishy with no face drawn, or a legendary, has no tiny face', () => {
  expect(tinyFace(TEST_KIT, squishy('blank'))).toEqual([])
  expect(tinyFace(TEST_KIT, { kind: 'legendary', legendary: 'mochi', shiny: false, name: 'Mochi', key: 'mochi' })).toEqual([])
})
