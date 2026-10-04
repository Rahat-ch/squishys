import { expect, test } from 'claude-code/testing'

import { PICTURE_SIZE, SIDES } from '../src/composer'
import type { Colors, Grid, Kit } from '../src/kit'
import type { Squishy } from '../src/roller'
import { miniRows } from '../src/spinner-mini'

const OUTLINE = 0x202030
const BASE = 0xf0d0c0
const COLORS: Colors = { outline: OUTLINE, dark: 0x806070, base: BASE, highlight: 0xffffff }

const BLANK: Grid = Array.from({ length: PICTURE_SIZE }, () => '.'.repeat(PICTURE_SIZE))

// A square body, drawn all in base: from a fifth of the picture to four
// fifths, so the mini (half the side) has it from its second row and column
// to its fourth
const FROM = PICTURE_SIZE / 5
const TO = (PICTURE_SIZE * 4) / 5
const SQUARE: Grid = BLANK.map((line, row) => (row >= FROM && row < TO ? '.'.repeat(FROM) + 'b'.repeat(TO - FROM) + '.'.repeat(PICTURE_SIZE - TO) : line))

const TEST_KIT: Kit = {
  bodies: [{ id: 'square', rarity: 'common', syllable: 'mo', grid: SQUARE }],
  faces: [{ id: 'blank', rarity: 'common', syllable: 'chi', grid: BLANK }],
  palettes: [{ id: 'gbc', rarity: 'common', syllable: '', colors: COLORS, shiny: { ...COLORS, sparkle: 0xffff00 } }],
  accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
  legendaries: [],
  starters: [],
}

const SQUISHY: Squishy = { kind: 'assembled', body: 'square', face: 'blank', palette: 'gbc', accessory: 'none', rarity: 'common', shiny: false, name: '', key: '' }

const NONE = { glyph: ' ' }
const OUTLINE_BELOW = { glyph: '▄', color: '#202030' }
const OUTLINE_ON_OUTLINE = { glyph: '▀', color: '#202030', backgroundColor: '#202030' }
const BASE_ON_OUTLINE = { glyph: '▀', color: '#f0d0c0', backgroundColor: '#202030' }

test('the spinner’s mini is the mini picture at rest as half-block cells: two pixels to a row, #rrggbb colors, see-through left to the terminal', () => {
  // The mini is 5x5: the square shrinks to 3x3, its edge in the outline
  // and its middle in base; three rows of text, the last only top halves
  const rows = miniRows(TEST_KIT, SQUISHY)

  expect(rows).toHaveLength(Math.ceil(SIDES.mini / 2))
  expect(rows).toEqual([
    [NONE, OUTLINE_BELOW, OUTLINE_BELOW, OUTLINE_BELOW, NONE],
    [NONE, OUTLINE_ON_OUTLINE, BASE_ON_OUTLINE, OUTLINE_ON_OUTLINE, NONE],
    [NONE, NONE, NONE, NONE, NONE],
  ])
})
