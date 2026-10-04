import { expect, test } from 'claude-code/testing'

import { SIDES, compose } from '../src/composer'
import { miniRows } from '../src/face'
import { KIT } from '../src/kit'
import { halfBlockRows, hexColor } from '../src/raster'
import { speciesSquishy } from '../src/roller'

const STARTER = KIT.starters[0] && speciesSquishy(KIT, KIT.starters[0], KIT.palettes[0]?.id)

test('the spinner’s mini is the band’s mini picture at rest, as rows of half-block cells in #rrggbb colors', () => {
  if (STARTER === undefined) throw new Error('The kit has no starter')
  const pixels = compose(KIT, STARTER, { state: 'working', frame: 0, size: 'mini' })

  const rows = miniRows(KIT, STARTER)

  expect(rows).toHaveLength(Math.ceil(SIDES.mini / 2))
  rows.forEach(row => expect(row).toHaveLength(SIDES.mini))
  expect(rows).toEqual(
    halfBlockRows(pixels).map(row =>
      row.map(({ glyph, foreground, background }) => ({
        glyph,
        ...(foreground === null ? {} : { color: hexColor(foreground) }),
        ...(background === null ? {} : { backgroundColor: hexColor(background) }),
      })),
    ),
  )
  // Every color is a #rrggbb, and see-through cells take the terminal's own
  for (const cell of rows.flat()) {
    for (const color of [cell.color, cell.backgroundColor]) if (color !== undefined) expect(color).toMatch(/^#[0-9a-f]{6}$/)
    if (cell.glyph === ' ') expect(cell).toEqual({ glyph: ' ' })
  }
})
