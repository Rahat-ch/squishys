// The drawn kit: the parts squishys are assembled from, in the style of a
// Gen 1/Gen 2 menu icon at 10x10, four colors each. See kit.ts for the
// shape of the data and the grid keys.
//
// For now this is a sample set for settling the art direction: 2 bodies,
// 2 faces, 2 palettes, 1 accessory besides none and 1 legendary. The
// placeholder kit fills in each kind's rare part (so the roller has a part
// of every rarity) and the third starter.
//
// Layout every part keeps to, so any face and accessory sit on any body:
// - Bodies stand on row 9 and fill columns 1-8 of rows 5-7 (the face's place).
// - Faces draw there: eyes in columns 3 and 6 (2 and 3, 6 and 7 when two
//   wide) of rows 5-6, the mouth in columns 4-5 and blush in columns 1-2 and
//   7-8 of row 7.
// - Accessories sit up top right, in rows 0-3 of columns 5-9.

import type { Grid, Kit } from './kit'
import { PLACEHOLDER_KIT } from './placeholder-kit'

const NOTHING: Grid = Array.from({ length: 10 }, () => '..........')

/** A see-through grid apart from the rows given, by row number. */
function overlay(rows: Readonly<Record<number, string>>): Grid {
  return NOTHING.map((blank, row) => rows[row] ?? blank)
}

/** One part of the placeholder kit, standing in until it is drawn. */
function placeholder<T extends { id: string }>(parts: readonly T[], id: string): T {
  const part = parts.find(each => each.id === id)
  if (part === undefined) throw new Error(`The placeholder kit has no "${id}"`)
  return part
}

export const DRAWN_KIT: Kit = {
  bodies: [
    {
      id: 'bao',
      rarity: 'common',
      syllable: 'bao',
      grid: [
        '....oo....',
        '..oo*doo..',
        '.ohobbobo.',
        'oh*bbbbbbo',
        'obbbbbbbbo',
        'obbbbbbbbo',
        'odbbbbbbdo',
        '.oddddddo.',
        '..oooooo..',
        '..........',
      ],
    },
    {
      id: 'mochi',
      rarity: 'uncommon',
      syllable: 'mo',
      grid: [
        '..........',
        '..........',
        '..oooooo..',
        '.oh*bbbbo.',
        'oh*bbbbbbo',
        'obbbbbbbbo',
        'obbbbbbbbo',
        'odbbbbbbdo',
        'oooooooooo',
        '..........',
      ],
    },
    placeholder(PLACEHOLDER_KIT.bodies, 'puddle'),
  ],
  faces: [
    {
      id: 'content',
      rarity: 'common',
      syllable: 'mi',
      grid: overlay({
        4: '...e..e...',
        5: '...e..e...',
        6: '..c.mm.c..',
      }),
    },
    {
      id: 'sparkly',
      rarity: 'uncommon',
      syllable: 'ki',
      grid: overlay({
        4: '..*e..*e..',
        5: '..ee..ee..',
        6: '.c..mm..c.',
      }),
    },
    placeholder(PLACEHOLDER_KIT.faces, 'joy'),
  ],
  palettes: [
    {
      id: 'cream',
      rarity: 'common',
      syllable: '',
      colors: { outline: 0x8a5236, dark: 0xeb9a7c, base: 0xfbe6c4, highlight: 0xffffff },
      shiny: { outline: 0x8a5236, dark: 0xf08a3c, base: 0xffd447, highlight: 0xfff3b0, sparkle: 0xffffff },
    },
    {
      id: 'sakura',
      rarity: 'uncommon',
      syllable: 'ra',
      colors: { outline: 0xa83c68, dark: 0xf27ca4, base: 0xffc8dc, highlight: 0xffffff },
      shiny: { outline: 0xa83c68, dark: 0x9a5ad8, base: 0xc896f2, highlight: 0xeee0ff, sparkle: 0xfff07a },
    },
    placeholder(PLACEHOLDER_KIT.palettes, 'mint'),
  ],
  accessories: [
    { id: 'none', rarity: 'common', syllable: '', grid: NOTHING },
    {
      id: 'bow',
      rarity: 'uncommon',
      syllable: 'ri',
      grid: overlay({
        0: '.....oo.oo',
        1: '.....ododo',
        2: '.....oo.oo',
      }),
    },
    { ...placeholder(PLACEHOLDER_KIT.accessories, 'sprout'), rarity: 'rare' },
  ],
  legendaries: [
    {
      id: 'great-xiaolongbao',
      name: 'The Great Xiaolongbao',
      grid: [
        '..h.hh.h..',
        '..hh**hh..',
        '..obdbdo..',
        '.odbdbbbo.',
        'obbebbebbo',
        'obbebbebbo',
        'obcbmmbcbo',
        'odbbbbbbdo',
        '.oooooooo.',
        '..........',
      ],
      colors: { outline: 0x8a5236, dark: 0xe8b47c, base: 0xfff0d8, highlight: 0xffc93c },
      shiny: { outline: 0x8a5236, dark: 0x5cb58a, base: 0xa8ecc8, highlight: 0xff9ec8, sparkle: 0xffffff },
    },
  ],
  starters: [
    { body: 'bao', face: 'content' },
    { body: 'mochi', face: 'sparkly' },
    { body: 'puddle', face: 'joy' },
  ],
}
