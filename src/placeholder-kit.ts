// A small placeholder kit, so the roller and composer work before
// the real art is drawn: three parts of each kind (one of each rarity), one
// legendary and three starters. The real kit replaces this file.

import type { Colors, Grid, Kit } from './kit'

const NOTHING: Grid = Array.from({ length: 10 }, () => '..........')

/** A grid that is see-through except for the rows given, by row number. */
function overlay(rows: Readonly<Record<number, string>>): Grid {
  return NOTHING.map((blank, row) => rows[row] ?? blank)
}

const CREAM: Colors = { outline: 0x222233, dark: 0xccaa88, base: 0xeeddcc, highlight: 0xffffff }

export const PLACEHOLDER_KIT: Kit = {
  bodies: [
    {
      id: 'dumpling',
      rarity: 'common',
      syllable: 'mo',
      grid: [
        '..........',
        '...oooo...',
        '..ohhbbo..',
        '.ohbbbbbo.',
        '.obbbbbbo.',
        'obbbbbbbbo',
        'obbbbbbbbo',
        'odbbbbbbdo',
        '.oddddddo.',
        '..oooooo..',
      ],
    },
    {
      id: 'bun',
      rarity: 'uncommon',
      syllable: 'pu',
      grid: [
        '...oooo...',
        '..ohhbbo..',
        '.ohbbbbbo.',
        '.obbbbbbo.',
        '.obbbbbbo.',
        '.obbbbbbo.',
        '.obbbbbbo.',
        '.odbbbbdo.',
        '..oddddo..',
        '...oooo...',
      ],
    },
    {
      id: 'puddle',
      rarity: 'rare',
      syllable: 'ta',
      grid: [
        '..........',
        '..........',
        '..........',
        '..oooooo..',
        '.oh*bbbbo.',
        'obbbbbbbbo',
        'obbbbbbbbo',
        'obbbbbbbbo',
        'oddddddddo',
        '.oooooooo.',
      ],
    },
  ],
  faces: [
    {
      id: 'smile',
      rarity: 'common',
      syllable: 'chi',
      grid: overlay({
        5: '...e..e...',
        6: '..c.mm.c..',
      }),
    },
    {
      id: 'grin',
      rarity: 'uncommon',
      syllable: 'ni',
      grid: overlay({
        5: '...e..e...',
        6: '...e..e...',
        7: '..cmmmmc..',
      }),
    },
    {
      id: 'joy',
      rarity: 'rare',
      syllable: 'mu',
      grid: overlay({
        5: '..e....e..',
        6: '.e.e..e.e.',
        7: '....mm....',
      }),
    },
  ],
  palettes: [
    {
      id: 'cream',
      rarity: 'common',
      syllable: '',
      colors: CREAM,
      shiny: { outline: 0x222233, dark: 0x9966cc, base: 0xcc99ff, highlight: 0xeeddff, sparkle: 0xffee66 },
    },
    {
      id: 'peach',
      rarity: 'uncommon',
      syllable: 'ko',
      colors: { outline: 0x222233, dark: 0xdd9977, base: 0xffbb99, highlight: 0xffe0d0 },
      shiny: { outline: 0x222233, dark: 0x99bb66, base: 0xccee99, highlight: 0xeeffdd, sparkle: 0xffee66 },
    },
    {
      id: 'mint',
      rarity: 'rare',
      syllable: 'ri',
      colors: { outline: 0x222233, dark: 0x77bb99, base: 0xaaeecc, highlight: 0xe0fff0 },
      shiny: { outline: 0x222233, dark: 0x6699cc, base: 0x99ccff, highlight: 0xe6f2ff, sparkle: 0xffee66 },
    },
  ],
  accessories: [
    { id: 'none', rarity: 'common', syllable: '', grid: NOTHING },
    {
      id: 'sprout',
      rarity: 'uncommon',
      syllable: 'ba',
      grid: overlay({
        0: '......dd..',
        1: '.....d....',
      }),
    },
    {
      id: 'bow',
      rarity: 'rare',
      syllable: 'bi',
      grid: overlay({
        1: '.......o.o',
        2: '.......ooo',
        3: '.......o.o',
      }),
    },
  ],
  legendaries: [
    {
      id: 'daifuku',
      name: 'Daifuku',
      grid: [
        '...d.dd...',
        '...oooo...',
        '..ohhbbo..',
        '.ohbbbbbo.',
        'obbebbebbo',
        'obcbmmbcbo',
        'obbbbbbbbo',
        'odbbbbbbdo',
        '.oddddddo.',
        '..oooooo..',
      ],
      colors: { outline: 0x222233, dark: 0xbbaacc, base: 0xeee6f6, highlight: 0xffffff },
      shiny: { outline: 0x222233, dark: 0xeebb66, base: 0xffeeaa, highlight: 0xffffee, sparkle: 0xff6699 },
    },
  ],
  starters: [
    { body: 'dumpling', face: 'smile' },
    { body: 'bun', face: 'grin' },
    { body: 'puddle', face: 'joy' },
  ],
}
