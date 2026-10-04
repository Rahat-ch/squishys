// The kit's parts, in the style of a Gen 1/Gen 2 menu icon: 10x10, four
// colors each (outline, dark, base, highlight) and a sparkle on a shiny.
// See kit.ts for the shape of the data and the grid keys.
//
// Layout every part keeps to, so any face and accessory sit on any body:
// - Bodies stand on row 8 and fill columns 1-8 of rows 4-6 (the face's
//   place). Each has a highlight and a glint (`*`) at its top left.
// - Faces draw there: eyes in column 3 and 6 (2-3 and 6-7 when two wide)
//   of rows 4-5, the mouth in columns 4-5 of row 6 (and 7), blush in
//   columns 1-2 and 7-8 of row 6. Eyes are `e` and the mouth `m`, both in
//   the outline color, and blush `c`, in the dark one.
// - Accessories perch top right, in rows 0-4 of columns 5-9 (the steam puff
//   top left), drawn in the same four colors.
// - Outlines are a mid-tone of the palette's hue, so they show on dark and
//   light terminals alike (tests/kit.test.ts holds every palette to it).

import type { Grid, Kit } from './kit'

const NOTHING: Grid = Array.from({ length: 10 }, () => '..........')

/** A see-through grid apart from the rows given, by row number. */
function overlay(rows: Readonly<Record<number, string>>): Grid {
  return NOTHING.map((blank, row) => rows[row] ?? blank)
}

// Shared by several shinies
const WHITE = 0xffffff
const GOLD = 0xffe066

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
      rarity: 'common',
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
    {
      // A crescent, pleated along its top
      id: 'gyoza',
      rarity: 'common',
      syllable: 'gyo',
      grid: [
        '..........',
        '..........',
        '..oooooo..',
        '.odbdbdbo.',
        'oh*bbbbbbo',
        'obbbbbbbbo',
        '.obbbbbbo.',
        '..oddddo..',
        '...oooo...',
        '..........',
      ],
    },
    {
      // A teardrop with a twisted knot on top
      id: 'xiaolongbao',
      rarity: 'uncommon',
      syllable: 'shao',
      grid: [
        '....oo....',
        '...o*do...',
        '...odbo...',
        '..odbdbo..',
        '.oh*bbbbo.',
        'ohbbbbbbbo',
        'obbbbbbbbo',
        'odbbbbbbdo',
        '.oooooooo.',
        '..........',
      ],
    },
    {
      // A small ball stacked on a big one
      id: 'dango',
      rarity: 'uncommon',
      syllable: 'dan',
      grid: [
        '...oooo...',
        '..oh*bbo..',
        '..obbbdo..',
        '.oooddooo.',
        'ohbbbbbbbo',
        'o*bbbbbbbo',
        'obbbbbbbbo',
        'odbbbbbbdo',
        '.oooooooo.',
        '..........',
      ],
    },
    {
      // A squishy tofu cube, its top face catching the light
      id: 'cube',
      rarity: 'rare',
      syllable: 'ku',
      grid: [
        '..........',
        '..........',
        '.oooooooo.',
        'oh*hhhhhdo',
        'obbbbbbbdo',
        'obbbbbbbdo',
        'obbbbbbbdo',
        'obbbbbbbdo',
        'oooooooooo',
        '..........',
      ],
    },
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
      id: 'surprised',
      rarity: 'common',
      syllable: 'po',
      grid: overlay({
        4: '..ee..ee..',
        5: '..ee..ee..',
        6: '....mm....',
        7: '....mm....',
      }),
    },
    {
      // Half-lidded: the dark shade is the lid
      id: 'sleepy',
      rarity: 'common',
      syllable: 'nu',
      grid: overlay({
        4: '..dd..dd..',
        5: '..ee..ee..',
        6: '....mm....',
      }),
    },
    {
      id: 'joy',
      rarity: 'uncommon',
      syllable: 'mu',
      grid: overlay({
        4: '..e....e..',
        5: '.e.e..e.e.',
        6: '....mm....',
      }),
    },
    {
      // Smug half-shut eyes over a cat's little w mouth
      id: 'cat',
      rarity: 'uncommon',
      syllable: 'nya',
      grid: overlay({
        5: '..ee..ee..',
        6: '.c.m..m.c.',
        7: '....mm....',
      }),
    },
    {
      id: 'wink',
      rarity: 'uncommon',
      syllable: 'pi',
      grid: overlay({
        4: '...e......',
        5: '...e..ee..',
        6: '..c.mm.c..',
      }),
    },
    {
      // Brows set over wide eyes; the brows are mouth-colored, not eyes, so they stay open asleep
      id: 'determined',
      rarity: 'uncommon',
      syllable: 'ta',
      grid: overlay({
        3: '..m....m..',
        4: '...m..m...',
        5: '..ee..ee..',
        6: '....mm....',
      }),
    },
    {
      id: 'sparkly',
      rarity: 'rare',
      syllable: 'ki',
      grid: overlay({
        4: '..*e..*e..',
        5: '..ee..ee..',
        6: '.c..mm..c.',
      }),
    },
  ],
  // A palette's dark shade colors its blush and its accessories' shade too.
  palettes: [
    {
      id: 'cream',
      rarity: 'common',
      syllable: 'ru',
      colors: { outline: 0x8a5236, dark: 0xeb9a7c, base: 0xfbe6c4, highlight: WHITE },
      shiny: { outline: 0x8a5236, dark: 0xf08a3c, base: 0xffd447, highlight: 0xfff3b0, sparkle: WHITE },
    },
    {
      id: 'peach',
      rarity: 'common',
      syllable: 'pe',
      colors: { outline: 0xb0503a, dark: 0xf08860, base: 0xffbf99, highlight: WHITE },
      shiny: { outline: 0x2a7068, dark: 0x30a8a8, base: 0x60d0d8, highlight: 0xd8fcff, sparkle: GOLD },
    },
    {
      id: 'matcha',
      rarity: 'common',
      syllable: 'cha',
      colors: { outline: 0x5e7e34, dark: 0x9cc46a, base: 0xd4ecb0, highlight: 0xf6ffe8 },
      shiny: { outline: 0x7a5a30, dark: 0xa87444, base: 0xd0a070, highlight: 0xf4dcb4, sparkle: 0xfff4a0 },
    },
    {
      id: 'sesame',
      rarity: 'common',
      syllable: 'go',
      colors: { outline: 0x6e6878, dark: 0xa8a2b0, base: 0xdcd8e0, highlight: WHITE },
      shiny: { outline: 0x5a5aa8, dark: 0x6878e0, base: 0x98b0ff, highlight: 0xe8ecff, sparkle: GOLD },
    },
    {
      id: 'sky',
      rarity: 'common',
      syllable: 'so',
      colors: { outline: 0x3a78b0, dark: 0x8cc8f0, base: 0xd8f2ff, highlight: WHITE },
      shiny: { outline: 0xa04050, dark: 0xe85a6a, base: 0xff8080, highlight: 0xffe0e0, sparkle: GOLD },
    },
    {
      id: 'mint',
      rarity: 'uncommon',
      syllable: 'su',
      colors: { outline: 0x7a5a8a, dark: 0x77bb99, base: 0xaaeecc, highlight: 0xe0fff0 },
      shiny: { outline: 0x7a5a8a, dark: 0x6699cc, base: 0x99ccff, highlight: 0xe6f2ff, sparkle: 0xffee66 },
    },
    {
      id: 'taro',
      rarity: 'uncommon',
      syllable: 'ro',
      colors: { outline: 0x7a4e9a, dark: 0xb48ee0, base: 0xe2d0f8, highlight: WHITE },
      shiny: { outline: 0x7a4e9a, dark: 0xd050c0, base: 0xf080e0, highlight: 0xffe0f8, sparkle: GOLD },
    },
    {
      id: 'redbean',
      rarity: 'uncommon',
      syllable: 'zu',
      colors: { outline: 0xa84858, dark: 0xd07080, base: 0xf0b0b8, highlight: 0xfff0f2 },
      shiny: { outline: 0x2a6e44, dark: 0x30a060, base: 0x60c888, highlight: 0xe0fff0, sparkle: GOLD },
    },
    {
      id: 'sakura',
      rarity: 'rare',
      syllable: 'ra',
      colors: { outline: 0xa83c68, dark: 0xf27ca4, base: 0xffc8dc, highlight: WHITE },
      shiny: { outline: 0xa83c68, dark: 0x9a5ad8, base: 0xc896f2, highlight: 0xeee0ff, sparkle: 0xfff07a },
    },
    {
      id: 'mango',
      rarity: 'rare',
      syllable: 'ma',
      colors: { outline: 0xa84818, dark: 0xe0581c, base: 0xff8c40, highlight: 0xffd8a0 },
      shiny: { outline: 0x5a8a20, dark: 0x90c840, base: 0xc8f070, highlight: 0xf4ffd0, sparkle: WHITE },
    },
  ],
  accessories: [
    { id: 'none', rarity: 'common', syllable: '', grid: NOTHING },
    {
      id: 'sprout',
      rarity: 'common',
      syllable: 'ba',
      grid: overlay({
        0: '......dd..',
        1: '.....d....',
      }),
    },
    {
      // A puff of steam, up top left
      id: 'steam',
      rarity: 'common',
      syllable: 'fu',
      grid: overlay({
        0: '.oo.......',
        1: 'ohho......',
        2: '.oo.......',
      }),
    },
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
    {
      // A pair stuck in the top, like hair sticks
      id: 'chopsticks',
      rarity: 'uncommon',
      syllable: 'shi',
      grid: overlay({
        0: '........do',
        1: '.......do.',
        2: '......do..',
        3: '.....do...',
      }),
    },
    {
      // A drop of soy sauce floating up top left, like a nervous sweat drop
      id: 'soy',
      rarity: 'uncommon',
      syllable: 'yu',
      grid: overlay({
        0: '.o........',
        1: 'odo.......',
        2: 'o*o.......',
        3: '.o........',
      }),
    },
    {
      // A tiny party hat with a glint on its tip
      id: 'hat',
      rarity: 'rare',
      syllable: 'bo',
      grid: overlay({
        0: '.......o..',
        1: '......o*o.',
        2: '.....oddo.',
        3: '.....oooo.',
      }),
    },
    {
      id: 'flower',
      rarity: 'rare',
      syllable: 'na',
      grid: overlay({
        0: '......oho.',
        1: '.....ohdho',
        2: '......oho.',
      }),
    },
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
      shiny: { outline: 0x8a5236, dark: 0x5cb58a, base: 0xa8ecc8, highlight: 0xff9ec8, sparkle: WHITE },
    },
    {
      // A mooncake with a fluted rim and lashes, a blossom pinned in her hair
      id: 'lady-mooncake',
      name: 'Lady Mooncake',
      grid: [
        '..oooo.oho',
        '.odbdboh*h',
        'odbbbbboho',
        'obbbbbbbdo',
        'obbebbebbo',
        'obeebbeebo',
        'odcbmmbcdo',
        '.obdbdbdo.',
        '..oooooo..',
        '..........',
      ],
      colors: { outline: 0x9a5a28, dark: 0xc07a34, base: 0xf0c070, highlight: 0xffe8f0 },
      shiny: { outline: 0xa83c68, dark: 0xe880a8, base: 0xffc0d8, highlight: 0xfff4f8, sparkle: GOLD },
    },
    {
      // A wise old bao with a long white beard and bushy brows
      id: 'sensei-nikuman',
      name: 'Sensei Nikuman',
      grid: [
        '....oo....',
        '..oo*doo..',
        '.obobbobo.',
        'ohhhbbhhho',
        'obeebbeebo',
        'obbhhhhbbo',
        'odhhhhhhdo',
        '.ohhhhhho.',
        '..ohhhho..',
        '...oooo...',
      ],
      colors: { outline: 0x7a5a48, dark: 0xd8a070, base: 0xf8dcb8, highlight: WHITE },
      shiny: { outline: 0x3a6aa0, dark: 0x70a8e0, base: 0xb8dcff, highlight: WHITE, sparkle: GOLD },
    },
    {
      // A strawberry daifuku, his strawberry for a crown
      id: 'emperor-daifuku',
      name: 'Emperor Daifuku',
      grid: [
        '...h.hh...',
        '...ohhoo..',
        '..od*ddo..',
        '.ooddddoo.',
        'obbebbebbo',
        'obbebbebbo',
        'obdbmmbdbo',
        'obbbbbbbbo',
        '.oooooooo.',
        '..........',
      ],
      colors: { outline: 0x8a4a5a, dark: 0xe8405a, base: 0xfaf4fa, highlight: 0x5cc060 },
      shiny: { outline: 0x8a4a5a, dark: 0xf0b020, base: 0xffe0ec, highlight: 0x5cc060, sparkle: WHITE },
    },
    {
      // A taiyaki in a captain's cap, swimming left
      id: 'captain-taiyaki',
      name: 'Captain Taiyaki',
      grid: [
        '..oooo....',
        '.ohh*ho...',
        '.oooooo...',
        'obbbbbbo.o',
        'oebdbdbboo',
        'obdbdbdbbo',
        'ombbbbbboo',
        '.obbbbbo.o',
        '..ooooo...',
        '..........',
      ],
      colors: { outline: 0x9a6030, dark: 0xd08a40, base: 0xf8c878, highlight: WHITE },
      shiny: { outline: 0x9a6030, dark: 0xe06080, base: 0xffb0c4, highlight: WHITE, sparkle: 0x80e0ff },
    },
  ],
  starters: [
    { body: 'bao', face: 'content' },
    { body: 'mochi', face: 'sparkly' },
    { body: 'gyoza', face: 'joy' },
  ],
}
