// The composer: turns a squishy into pixels, ready for the half-block
// packer in raster.ts. Pure: it takes the kit and a squishy as plain data
// and never touches Claude Code, so tools outside the mod (the art preview)
// draw squishys exactly as the mod does.

import type { Colors, Grid, Kit } from './kit'
import type { Pixel, Pixels } from './raster'
import type { Squishy } from './roller'
import type { SquishyState } from './states'

// What a squishy shows about its agent: see states.ts
export type { SquishyState } from './states'

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

/** How many rows from the top lean as a Working squishy wiggles. */
const LEANING_ROWS = 7

/**
 * The squishy's picture in a pose. Each pose is made from the squishy's
 * still 16x16 picture, by moving its pixels and drawing over them, so every
 * part and legendary has every pose without art of its own.
 *
 * `frame` counts the animator's ticks: a Working squishy's wiggle moves
 * every second frame, and a Thinking squishy's bounce every frame.
 */
export function compose(kit: Kit, squishy: Squishy, { state, frame, size = 'full' }: Pose): Pixels {
  const picture = posedPicture(kit, squishy, state, frame)
  if (size === 'double') return doubled(picture)
  if (size === 'mini') return halved(picture)
  return picture
}

function posedPicture(kit: Kit, squishy: Squishy, state: SquishyState, frame: number): Pixels {
  const { grids, colors } = gridsOf(kit, squishy)
  const still = painted(grids, colors)
  switch (state) {
    case 'working':
      // A 2-frame wiggle, upright then leaning, each frame held for two ticks
      return Math.floor(frame / 2) % 2 === 0 ? still : leaning(still, 1)
    case 'thinking':
      // A pixel down and back up, a frame each. It starts low, so a Thinking
      // squishy differs from a Working one even standing still. The art keeps
      // its bottom row clear more often than its top one, so down loses less.
      return frame % 2 === 0 ? lowered(still, 1) : still
    case 'needsYou':
      // Held still, so the bubble reads as a call rather than activity
      return overlaid(still, BUBBLE_GLYPH, { o: BUBBLE_COLOR, '!': MARK_COLOR })
    case 'asleep':
      return overlaid(shutEyes(grids, colors), Z_GLYPH, { '#': ZZZ_COLOR })
    case 'squished':
      return flattened(still)
    default:
      return still
  }
}

/**
 * The picture squashed to half its height, standing on its bottom row: from
 * the bottom row up, every other row is kept.
 */
function flattened(pixels: Pixels): Pixels {
  const drawn = pixels.flatMap((row, index) => (row.some(pixel => pixel !== null) ? [index] : []))
  const bottom = Math.max(-1, ...drawn)
  const blank = Array.from({ length: SIDE }, () => null)
  return pixels.map((row, index) => (index > bottom ? row : (pixels[2 * index - bottom] ?? blank)))
}

/** The color of an Asleep squishy's z, the same for every palette. */
export const ZZZ_COLOR = 0x88aaee

/** The z an Asleep squishy shows, top right: `#` is drawn. */
const Z_GLYPH: Grid = [
  '............###.',
  '.............#..',
  '............###.',
]

/**
 * The bubble and mark of a squishy that Needs you, the same for every
 * palette: a white bubble with a red "!" stands out on any art.
 */
export const BUBBLE_COLOR = 0xffffff
export const MARK_COLOR = 0xd02040

/**
 * The "!" bubble a squishy that Needs you shows, top right, where an Asleep
 * squishy's z goes: `o` is the bubble, `!` the mark, and the tail points
 * down at the squishy.
 */
const BUBBLE_GLYPH: Grid = [
  '.............ooo',
  '.............o!o',
  '.............o!o',
  '.............ooo',
  '.............o!o',
  '.............ooo',
  '............o...',
]

/** Pixels drawn over a picture where the glyph has a key of `colors`, in that color. */
function overlaid(pixels: Pixels, glyph: Grid, colors: Readonly<Record<string, number>>): Pixels {
  return pixels.map((row, index) =>
    row.map((pixel, column) => colors[glyph[index]?.[column] ?? '.'] ?? pixel),
  )
}

/**
 * The picture with its eyes shut: wherever an eye shows, what lies beneath
 * it shows instead (the body color where nothing does, as on a legendary),
 * and each eye becomes a line along its bottom row, at least three wide.
 */
function shutEyes(grids: readonly Grid[], colors: Colors): Pixels {
  const lidded = painted(grids, colors, { eyesShut: true })
  const eye = colors.e
  if (eye === undefined) return lidded
  const lines = eyesOf(grids).map(cells => {
    const row = Math.max(...cells.map(([at]) => at))
    let left = Math.min(...cells.map(([, column]) => column))
    let right = Math.max(...cells.map(([, column]) => column))
    if (left === right) [left, right] = [left - 1, right + 1]
    return { row, left, right }
  })
  return lidded.map((pixels, row) =>
    pixels.map((pixel, column) =>
      lines.some(line => line.row === row && column >= line.left && column <= line.right) ? eye : pixel,
    ),
  )
}

type Cell = readonly [row: number, column: number]

/** Each eye: the pixels where an eye shows, grouped into touching sets (corners count). */
function eyesOf(grids: readonly Grid[]): Cell[][] {
  const showing = (row: number, column: number) => topKey(grids, row, column) === 'e'
  // Which pixels are in an eye found so far, by row * SIDE + column
  const seen: boolean[] = []
  const eyes: Cell[][] = []
  for (let row = 0; row < SIDE; row += 1) {
    for (let column = 0; column < SIDE; column += 1) {
      if (!showing(row, column) || seen[row * SIDE + column]) continue
      const eye: Cell[] = []
      const queue: Cell[] = [[row, column]]
      seen[row * SIDE + column] = true
      for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
        eye.push(next)
        const [at, across] = next
        for (const [down, right] of NEIGHBORS) {
          const [r, c] = [at + down, across + right]
          if (r < 0 || r >= SIDE || c < 0 || c >= SIDE || seen[r * SIDE + c] || !showing(r, c)) continue
          seen[r * SIDE + c] = true
          queue.push([r, c])
        }
      }
      eyes.push(eye)
    }
  }
  return eyes
}

const NEIGHBORS: readonly Cell[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
]

/** The key that shows at a pixel: the topmost grid's that isn't `.`. */
function topKey(grids: readonly Grid[], row: number, column: number): string {
  let shown = '.'
  for (const grid of grids) {
    const key = grid[row]?.[column] ?? '.'
    if (key !== '.') shown = key
  }
  return shown
}

/** The top rows moved sideways by `by` pixels; what moves off the edge is lost. */
function leaning(pixels: Pixels, by: number): Pixels {
  return pixels.map((row, index) => (index < LEANING_ROWS ? row.map((_, column) => row[column - by] ?? null) : row))
}

/** The whole picture moved down by `by` pixels; what moves off the bottom is lost. */
function lowered(pixels: Pixels, by: number): Pixels {
  return pixels.map((row, index) => pixels[index - by] ?? row.map(() => null))
}

/**
 * What the 16x16 picture is painted from: body, then face, then accessory
 * (or a legendary's one grid), and the squishy's colors.
 */
function gridsOf(kit: Kit, squishy: Squishy): { grids: readonly Grid[]; colors: Colors } {
  if (squishy.kind === 'legendary') {
    const legendary = partOf(kit.legendaries, squishy.legendary, 'legendary')
    return { grids: [legendary.grid], colors: colorsFor(legendary, squishy.shiny) }
  }
  const body = partOf(kit.bodies, squishy.body, 'body')
  const face = partOf(kit.faces, squishy.face, 'face')
  const accessory = partOf(kit.accessories, squishy.accessory, 'accessory')
  const palette = partOf(kit.palettes, squishy.palette, 'palette')
  return { grids: [body.grid, face.grid, accessory.grid], colors: colorsFor(palette, squishy.shiny) }
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
 *
 * With `eyesShut`, eye pixels (`e`) are passed over like `.`, and where only
 * eyes were drawn the body color fills in.
 */
function painted(grids: readonly Grid[], colors: Colors, { eyesShut = false } = {}): Pixels {
  for (const grid of grids) {
    if (grid.length !== SIDE || grid.some(line => line.length !== SIDE)) {
      throw new Error(`A grid is not ${SIDE}x${SIDE}: ${JSON.stringify(grid)}`)
    }
  }
  return Array.from({ length: SIDE }, (_, row) =>
    Array.from({ length: SIDE }, (_, column) => {
      let pixel: Pixel = null
      for (const grid of grids) {
        let key = grid[row]?.[column] ?? '.'
        if (key === 'e' && eyesShut) key = pixel === null ? 'b' : '.'
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
