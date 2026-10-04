// The spinner's mini: a squishy's mini picture at rest, the band's, as rows
// of colored half-block text, which the spinner draws after its verb
// (src/spinner.tsx), where no Raster goes. Pure: it takes the kit and a
// squishy as plain data and never touches Claude Code.

import { stillMiniPixels } from './composer'
import type { Kit } from './kit'
import { halfBlockRows, hexColor } from './raster'
import type { Squishy } from './roller'

/** One cell of the mini: its glyph and colors, as `Text` props take them. */
export type MiniCell = { glyph: string; color?: string; backgroundColor?: string }

/** One row of text of the mini, left to right. */
export type MiniRow = readonly MiniCell[]

/**
 * The squishy's mini picture at rest (`stillMiniPixels`), two pixels to a
 * row of text: see `halfBlockRows`. Every `#rrggbb` comes from `hexColor`.
 */
export function miniRows(kit: Kit, squishy: Squishy): MiniRow[] {
  return halfBlockRows(stillMiniPixels(kit, squishy)).map(row =>
    row.map(({ glyph, foreground, background }) => ({
      glyph,
      ...(foreground === null ? {} : { color: hexColor(foreground) }),
      ...(background === null ? {} : { backgroundColor: hexColor(background) }),
    })),
  )
}
