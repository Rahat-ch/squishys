// A small placeholder kit, so the roller and sprite composer work before
// the real art is drawn: three parts of each kind (one of each rarity), one
// legendary and three starters. The real kit replaces this file.

import type { Grid, Kit } from './kit'

const NOTHING: Grid = Array.from({ length: 16 }, () => '................')

/** A grid that is see-through except for the rows given, by row number. */
function overlay(rows: Readonly<Record<number, string>>): Grid {
  return NOTHING.map((blank, row) => rows[row] ?? blank)
}

const CREAM = {
  o: 0x222233,
  b: 0xeeddcc,
  h: 0xffffff,
  s: 0xccbbaa,
  e: 0x222233,
  c: 0xff99aa,
  m: 0x993344,
  a: 0x55aa55,
  d: 0x337733,
}

export const PLACEHOLDER_KIT: Kit = {
  bodies: [
    {
      id: 'dumpling',
      rarity: 'common',
      syllable: 'mo',
      grid: [
        '................',
        '................',
        '......oooo......',
        '....oohhbboo....',
        '...ohhbbbbbbo...',
        '..ohbbbbbbbbbo..',
        '..obbbbbbbbbbo..',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        'obbbbbbbbbbbbbbo',
        'obsbbbbbbbbbbsbo',
        '.obssbbbbbbssbo.',
        '..oooooooooooo..',
        '................',
      ],
    },
    {
      id: 'bun',
      rarity: 'uncommon',
      syllable: 'pu',
      grid: [
        '................',
        '.....oooooo.....',
        '....ohhbbbbo....',
        '...ohbbbbbbbo...',
        '..ohbbbbbbbbbo..',
        '..obbbbbbbbbbo..',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '..osbbbbbbbbso..',
        '...ossbbbbsso...',
        '....oooooooo....',
        '................',
      ],
    },
    {
      id: 'puddle',
      rarity: 'rare',
      syllable: 'ta',
      grid: [
        '................',
        '................',
        '................',
        '................',
        '....oooooooo....',
        '..oohhbbbbbboo..',
        '.ohhbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obsbbbbbbbbbbsbo',
        '.ossbbbbbbbbsso.',
        '..oooooooooooo..',
        '................',
      ],
    },
  ],
  faces: [
    {
      id: 'smile',
      rarity: 'common',
      syllable: 'chi',
      grid: overlay({
        8: '....e......e....',
        9: '....e......e....',
        10: '...c...mm...c...',
      }),
    },
    {
      id: 'grin',
      rarity: 'uncommon',
      syllable: 'ni',
      grid: overlay({
        8: '....ee....ee....',
        9: '....ee....ee....',
        10: '...c..mmmm..c...',
        11: '.......mm.......',
      }),
    },
    {
      id: 'joy',
      rarity: 'rare',
      syllable: 'mu',
      grid: overlay({
        8: '....e......e....',
        9: '...e.e....e.e...',
        10: '...c........c...',
        11: '......mmmm......',
      }),
    },
  ],
  palettes: [
    {
      id: 'cream',
      rarity: 'common',
      syllable: '',
      colors: CREAM,
      shiny: { ...CREAM, b: 0xbbddff, h: 0xeef6ff, s: 0x88aadd, c: 0xffaacc },
    },
    {
      id: 'peach',
      rarity: 'uncommon',
      syllable: 'ko',
      colors: { ...CREAM, b: 0xffbb99, h: 0xffe0d0, s: 0xdd9977, c: 0xff6677, a: 0xffcc33, d: 0xcc8800 },
      shiny: { ...CREAM, b: 0xccee99, h: 0xeeffdd, s: 0x99bb66, c: 0xff8899, a: 0xffcc33, d: 0xcc8800 },
    },
    {
      id: 'mint',
      rarity: 'rare',
      syllable: 'ri',
      colors: { ...CREAM, b: 0xaaeecc, h: 0xe0fff0, s: 0x77bb99, c: 0xff99bb, a: 0xee6688, d: 0xaa3355 },
      shiny: { ...CREAM, b: 0xddaaff, h: 0xf4e6ff, s: 0xaa77cc, c: 0xff99bb, a: 0xffdd44, d: 0xbb8800 },
    },
  ],
  accessories: [
    { id: 'none', rarity: 'common', syllable: '', grid: NOTHING },
    {
      id: 'sprout',
      rarity: 'uncommon',
      syllable: 'ba',
      grid: overlay({
        0: '......aa.aa.....',
        1: '.......ada......',
        2: '........d.......',
      }),
    },
    {
      id: 'bow',
      rarity: 'rare',
      syllable: 'bi',
      grid: overlay({
        3: '.........a..a...',
        4: '.........adda...',
        5: '.........a..a...',
      }),
    },
  ],
  legendaries: [
    {
      id: 'daifuku',
      name: 'Daifuku',
      grid: [
        '.....a.aa.a.....',
        '.....aaaaaa.....',
        '.....oooooo.....',
        '...oohhbbbboo...',
        '..ohhbbbbbbbbo..',
        '.ohbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        'obbbebbbbbbebbbo',
        'obbeeebbbbeeebbo',
        'obcbbbbmmbbbbcbo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obsbbbbbbbbbbsbo',
        '.obssbbbbbbssbo.',
        '..oooooooooooo..',
        '................',
      ],
      colors: { ...CREAM, b: 0xffffff, h: 0xffffff, s: 0xddccee, a: 0xffcc33 },
      shiny: { ...CREAM, b: 0xffeeaa, h: 0xffffee, s: 0xeebb66, a: 0xff6699 },
    },
  ],
  starters: [
    { body: 'dumpling', face: 'smile' },
    { body: 'bun', face: 'grin' },
    { body: 'puddle', face: 'joy' },
  ],
}
