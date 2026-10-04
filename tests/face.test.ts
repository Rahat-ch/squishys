import { expect, test } from 'claude-code/testing'

import { PICTURE_SIZE } from '../src/composer'
import { tinyFace } from '../src/face'
import type { Grid, Kit } from '../src/kit'
import type { Squishy } from '../src/roller'

const BODY = 0x808080
const EYE = 0x000000
const CHEEK = 0xff8899
const MOUTH = 0x993344
const LEAF = 0x00ff00

/** A grid of one key, apart from the rows given, by row number, each laid in from column `left`. */
function grid(fill: string, rows: Readonly<Record<number, string>> = {}, left = 0): Grid {
  return Array.from({ length: PICTURE_SIZE }, (_, row) => {
    const line = rows[row]
    return line === undefined ? fill.repeat(PICTURE_SIZE) : fill.repeat(left) + line + fill.repeat(PICTURE_SIZE - left - line.length)
  })
}

// Where the test faces sit in the picture
const TOP = PICTURE_SIZE / 2
const LEFT = PICTURE_SIZE / 4

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
    { id: 'grey', rarity: 'common', syllable: '', colors: { b: BODY, e: EYE, c: CHEEK, m: MOUTH, a: LEAF }, shiny: { b: BODY, e: EYE, c: CHEEK, m: MOUTH, a: LEAF } },
  ],
  // Drawn beside the face, so a crop that strays shows it
  accessories: [{ id: 'leaf', rarity: 'common', syllable: '', grid: grid('.', { [TOP]: 'aa' }, LEFT - 2) }],
  legendaries: [{ id: 'mochi', name: 'Mochi', grid: grid('b'), colors: { b: BODY }, shiny: { b: BODY } }],
  starters: [],
}

function squishy(face: string): Squishy {
  return { kind: 'assembled', body: 'block', face, palette: 'grey', accessory: 'leaf', rarity: 'common', shiny: false, name: '', key: '' }
}

test('the tiny face is the picture where its face part is drawn, shrunk to one row of half blocks that keeps its features', () => {
  // Shrunk by 2: each 2x2 block shows its color the face has least of, so
  // the eyes, cheeks and mouth outlast the body around them
  expect(tinyFace(TEST_KIT, squishy('smile'))).toEqual([
    [
      { glyph: '▀', color: '#000000', backgroundColor: '#ff8899' },
      { glyph: '▀', color: '#808080', backgroundColor: '#993344' },
      { glyph: '▀', color: '#000000', backgroundColor: '#ff8899' },
    ],
  ])
})

test('a face that already fits one row is drawn pixel for pixel', () => {
  expect(tinyFace(TEST_KIT, squishy('dots'))).toEqual([
    [
      { glyph: '▀', color: '#000000', backgroundColor: '#808080' },
      { glyph: '▀', color: '#808080', backgroundColor: '#993344' },
    ],
  ])
})

test('a squishy with no face drawn, or a legendary, has no tiny face', () => {
  expect(tinyFace(TEST_KIT, squishy('blank'))).toEqual([])
  expect(tinyFace(TEST_KIT, { kind: 'legendary', legendary: 'mochi', shiny: false, name: 'Mochi', key: 'mochi' })).toEqual([])
})
