import { expect, test } from 'claude-code/testing'

import { halfBlockRows, halfBlocks, hexColor } from '../src/raster'
import { glyphsOf } from './fixtures'

const RED = 0xff0000
const BLUE = 0x0000ff

test('two pixel rows pack into one row of half-block cells', () => {
  const picture = halfBlocks([
    [RED, null, null],
    [BLUE, BLUE, null],
  ])
  expect(picture).toMatchObject({ columns: 3, rows: 1 })
  // top and bottom: ▀ · bottom only: ▄ · neither: a space
  expect(glyphsOf(picture.cells)).toEqual(['▀', '▄', ' '])
})

test('an odd last pixel row leaves the bottom half see-through', () => {
  const picture = halfBlocks([[RED], [RED], [RED]])
  expect(picture).toMatchObject({ columns: 1, rows: 2 })
  expect(glyphsOf(picture.cells)).toEqual(['▀', '▀'])
})

test('each half block names its glyph and the colors it is drawn in, null for the terminal’s own', () => {
  expect(halfBlockRows([[RED, null, null], [BLUE, BLUE, null]])).toEqual([
    [
      { glyph: '▀', foreground: RED, background: BLUE },
      { glyph: '▄', foreground: BLUE, background: null },
      { glyph: ' ', foreground: null, background: null },
    ],
  ])
})

test('a color is written as #rrggbb', () => {
  expect(hexColor(BLUE)).toBe('#0000ff')
  expect(hexColor(RED)).toBe('#ff0000')
})
