// What the mod's pictures should be, from the pure composer: tests that
// drive the mod read which squishy a slot shows, then check its pictures
// against the poses the composer's own tests pin down.

import { compose } from '../src/composer'
import type { SquishyState } from '../src/composer'
import { KIT } from '../src/kit'
import type { Kit } from '../src/kit'
import { halfBlocks } from '../src/raster'
import type { Squishy } from '../src/roller'

/** Every squishy a kit can make, written out part by part. */
export function everySquishy(kit: Kit = KIT): Squishy[] {
  const all: Squishy[] = []
  for (const shiny of [false, true]) {
    for (const { id, name } of kit.legendaries) all.push({ kind: 'legendary', legendary: id, shiny, name, key: id })
    for (const body of kit.bodies)
      for (const face of kit.faces)
        for (const palette of kit.palettes)
          for (const accessory of kit.accessories) {
            const parts = { body: body.id, face: face.id, palette: palette.id, accessory: accessory.id }
            all.push({ kind: 'assembled', ...parts, rarity: 'common', shiny, name: '', key: '' })
          }
  }
  return all
}

/** The cells of a slot's Raster showing this squishy in this pose. */
export function cellsOf(squishy: Squishy, state: SquishyState, frame = 0): string {
  return halfBlocks(compose(KIT, squishy, { state, frame })).cells
}

const STATES: readonly SquishyState[] = ['working', 'thinking', 'needsYou', 'asleep', 'squished']

/**
 * Which state a picture of this squishy shows, at whichever frame the
 * animation is on; undefined if it shows none.
 */
export function stateIn(cells: unknown, squishy: Squishy): SquishyState | undefined {
  return STATES.find(state => [0, 1, 2, 3].some(frame => cellsOf(squishy, state, frame) === cells))
}

/** Which squishy a picture shows, from a newly spawned (Working, frame 0) picture's cells. */
export function squishyIn(cells: unknown): Squishy {
  const squishy = everySquishy().find(each => cellsOf(each, 'working') === cells)
  if (squishy === undefined) throw new Error('No squishy in the kit draws that picture')
  return squishy
}
