// The one placeholder squishy every agent gets until the kit, roller and
// sprite composer land: a 16x16 dumpling drawn as a palette-indexed grid.

import type { Pixel, Pixels } from './raster'

const PALETTE: Record<string, Pixel> = {
  '.': null,
  o: 0x222233, // outline
  b: 0xeeddcc, // body
  h: 0xffffff, // highlight
  e: 0x222233, // eye
  c: 0xff99aa, // cheek
  m: 0x993344, // mouth
}

const GRID = [
  '................',
  '................',
  '......oooo......',
  '....oohhbboo....',
  '...ohhbbbbbbo...',
  '..ohbbbbbbbbbo..',
  '..obbbbbbbbbbo..',
  '.obbebbbbbbebbo.',
  '.obbebbbbbbebbo.',
  '.obcbbbmmbbbcbo.',
  '.obbbbbbbbbbbbo.',
  'obbbbbbbbbbbbbbo',
  'obbbbbbbbbbbbbbo',
  '.obbbbbbbbbbbbo.',
  '..oooooooooooo..',
  '................',
]

export const PLACEHOLDER_SQUISHY: Pixels = GRID.map(row => [...row].map(key => PALETTE[key] ?? null))
