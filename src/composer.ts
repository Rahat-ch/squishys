// The composer: turns a squishy into pixels, ready for the half-block
// packer in raster.ts. Pure: it takes the kit and a squishy as plain data
// and never touches Claude Code, so tools outside the mod (the art preview)
// draw squishys exactly as the mod does.

import type { Colors, Grid, Kit } from './kit'
import type { Pixel, Pixels } from './raster'
import type { Squishy } from './roller'

/** What a squishy shows about its agent. */
export type SquishyState = 'working' | 'thinking' | 'needsYou' | 'asleep' | 'squished'

/**
 * How big to draw: `full` is the 16x16 roster picture, `double` the 32x32
 * focus-view picture, `mini` the 8x8 band picture.
 */
export type Size = 'full' | 'double' | 'mini'

export type Pose = {
  state: SquishyState
  /** Which frame of the state's animation, counting up from 0. */
  frame: number
  size?: Size
}

const SIDE = 16

/**
 * The squishy's picture in a pose. Every state and frame draws the squishy
 * standing still for now; the state animations come later.
 */
export function compose(kit: Kit, squishy: Squishy, { size = 'full' }: Pose): Pixels {
  const still = assembled(kit, squishy)
  if (size === 'double') return doubled(still)
  if (size === 'mini') return halved(still)
  return still
}

/** The 16x16 picture: body, then face, then accessory, in the squishy's colors. */
function assembled(kit: Kit, squishy: Squishy): Pixels {
  if (squishy.kind === 'legendary') {
    const legendary = partOf(kit.legendaries, squishy.legendary, 'legendary')
    return painted([legendary.grid], colorsFor(legendary, squishy.shiny))
  }
  const body = partOf(kit.bodies, squishy.body, 'body')
  const face = partOf(kit.faces, squishy.face, 'face')
  const accessory = partOf(kit.accessories, squishy.accessory, 'accessory')
  const palette = partOf(kit.palettes, squishy.palette, 'palette')
  return painted([body.grid, face.grid, accessory.grid], colorsFor(palette, squishy.shiny))
}

/** A palette's or legendary's colors, or its shiny ones for a shiny squishy. */
function colorsFor(source: { colors: Colors; shiny: Colors }, shiny: boolean): Colors {
  return shiny ? source.shiny : source.colors
}

function partOf<T extends { id: string }>(parts: readonly T[], id: string, kind: string): T {
  const part = parts.find(each => each.id === id)
  if (part === undefined) throw new Error(`The kit has no ${kind} "${id}"`)
  return part
}

/**
 * Lays grids over one another, the last on top; `.` lets the one beneath
 * show. Art it can't draw (a grid of the wrong size, a key the colors don't
 * cover) throws, so the kit's tests catch it rather than a gap in a picture.
 */
function painted(grids: readonly Grid[], colors: Colors): Pixels {
  for (const grid of grids) {
    if (grid.length !== SIDE || grid.some(line => line.length !== SIDE)) {
      throw new Error(`A grid is not ${SIDE}x${SIDE}: ${JSON.stringify(grid)}`)
    }
  }
  return Array.from({ length: SIDE }, (_, row) =>
    Array.from({ length: SIDE }, (_, column) => {
      let pixel: Pixel = null
      for (const grid of grids) {
        const key = grid[row]?.[column] ?? '.'
        if (key === '.') continue
        const color = colors[key]
        if (color === undefined) throw new Error(`The colors have no color for "${key}"`)
        pixel = color
      }
      return pixel
    }),
  )
}

/** Each pixel as a 2x2 block. */
function doubled(pixels: Pixels): Pixels {
  return pixels.flatMap(row => {
    const wide = row.flatMap(pixel => [pixel, pixel])
    return [wide, wide]
  })
}

/**
 * Each 2x2 block as one pixel: drawn where at least half the block is,
 * in the block's most common color (the first met on a tie).
 */
function halved(pixels: Pixels): Pixels {
  return Array.from({ length: pixels.length / 2 }, (_, row) =>
    Array.from({ length: (pixels[0]?.length ?? 0) / 2 }, (_, column) => {
      const block = [
        pixels[row * 2]?.[column * 2],
        pixels[row * 2]?.[column * 2 + 1],
        pixels[row * 2 + 1]?.[column * 2],
        pixels[row * 2 + 1]?.[column * 2 + 1],
      ].filter((pixel): pixel is number => typeof pixel === 'number')
      if (block.length < 2) return null
      let best = block[0] ?? null
      let bestCount = 0
      for (const pixel of block) {
        const count = block.filter(other => other === pixel).length
        if (count > bestCount) [best, bestCount] = [pixel, count]
      }
      return best
    }),
  )
}
