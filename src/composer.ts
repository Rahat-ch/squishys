// The composer: turns a squishy into pixels, ready for the half-block
// packer in raster.ts. Pure: it takes the kit and a squishy as plain data
// and never touches Claude Code, so tools outside the mod (the art preview)
// draw squishys exactly as the mod does.

import { EYE_KEY, FILL_KEY, KEY_COLORS, keyColor } from './kit'
import type { Colors, Grid, GridKey, Kit, ShinyColors } from './kit'
import type { Pixel, Pixels } from './raster'
import type { Squishy } from './roller'
import type { SquishyState } from './states'

// What a squishy shows about its agent: see states.ts
export type { SquishyState } from './states'

/**
 * A squishy picture's side in pixels, before any resizing: what the kit
 * draws, and what every size and pose is worked out from. It is even, so
 * the mini picture halves it.
 */
export const PICTURE_SIZE = 10

/**
 * How big to draw: `full` is the PICTURE_SIZE square roster picture,
 * `double` the focus-view picture at twice that, `mini` the band picture
 * at half.
 */
export type Size = 'full' | 'double' | 'mini'

/** How many pixels across and down a picture of each size is. */
export const SIDES: Readonly<Record<Size, number>> = { full: PICTURE_SIZE, double: PICTURE_SIZE * 2, mini: PICTURE_SIZE / 2 }

export type Pose = {
  state: SquishyState
  /** Which frame of the state's animation, counting up from 0. */
  frame: number
  size?: Size
  /** Whether it sparkles, as a shiny or legendary does for a while after it appears. */
  sparkle?: boolean
}

/** The key that draws nothing in a part's grid, letting what lies beneath show. */
export const SEE_THROUGH = '.'

/** How a Working squishy leans: its top `rows` rows moved `by` pixels sideways. */
type Lean = { by: number; rows: number }

/** How a Working squishy leans as it wiggles: its rows above the middle, a pixel over. */
const LEAN: Lean = { by: 1, rows: PICTURE_SIZE / 2 - 1 }

/** How many pixels of the PICTURE_SIZE picture shrink to one of the mini's, across and down. */
const MINI_STEP = PICTURE_SIZE / SIDES.mini

/**
 * How the mini leans, drawn at full size before it is shrunk: a whole pixel
 * of the mini over, since LEAN's one pixel is half of one there and shrinking
 * can lose it, and down through the mini's middle row, since its top rows are
 * mostly its flat outline, which shows no lean.
 */
const MINI_LEAN: Lean = { by: MINI_STEP, rows: Math.ceil(SIDES.mini / 2) * MINI_STEP }

/** How wide an Asleep squishy's shut eye is, at least. */
export const SHUT_EYE_WIDTH = Math.ceil(PICTURE_SIZE / 6)

/**
 * The squishy's picture in a pose. Each pose is made from the squishy's
 * still PICTURE_SIZE x PICTURE_SIZE picture, by moving its pixels and drawing over them, so
 * every part and legendary has every pose without art of its own.
 *
 * `frame` counts the animator's ticks: a Working squishy's wiggle moves
 * every second frame, and a Thinking squishy's bounce every frame. The
 * mini leans further (MINI_LEAN), so its wiggle survives shrinking.
 *
 * A squishy that Needs you holds still, with its "!" bubble drawn over the
 * picture once it is at its final size, so the mark keeps its shape there.
 */
export function compose(kit: Kit, squishy: Squishy, pose: Pose): Pixels {
  const { state, frame, size = 'full', sparkle = false } = pose
  const painting = paintingOf(kit, squishy)
  const sized =
    size === 'mini' ? mini(painting, pose) : size === 'double' ? doubled(posedPicture(painting, pose)) : posedPicture(painting, pose)
  const sparkled = sparkle ? withGlints(sized, frame, glintColor(painting.colors, squishy.shiny)) : sized
  return state === 'needsYou' ? withBubble(sparkled) : sparkled
}

/**
 * The squishy at rest: frame 0 of Working, at full size. The partner's
 * picture and a starter's.
 */
export function stillPixels(kit: Kit, squishy: Squishy): Pixels {
  return compose(kit, squishy, { state: 'working', frame: 0 })
}

/**
 * The squishy's mini picture at rest: frame 0 of Working, at the mini size.
 * The Squishydex's places.
 */
export function stillMiniPixels(kit: Kit, squishy: Squishy): Pixels {
  return compose(kit, squishy, { state: 'working', frame: 0, size: 'mini' })
}

/**
 * Stands in for the eye color in a picture drawn only to find where the
 * eyes went; it is no color, so it never reaches a picture shown.
 */
const EYE_MARK = 0x1000000

/** The z an Asleep squishy shows in the mini: a pixel, top right. */
const MINI_Z: Grid = ['#'.padStart(PICTURE_SIZE / 2, '.')]

/**
 * The band's half-size picture, shrunk from the pose the way a pixel artist
 * would: see shrunk. The eyes are found by drawing the pose a second time
 * with the eyes marked.
 */
function mini(painting: Painting, pose: Pose): Pixels {
  const { colors } = painting
  const posed = posedPicture(painting, pose, { showZ: false, lean: MINI_LEAN })
  const marked = posedPicture(painting, pose, { showZ: false, eyeColor: EYE_MARK, lean: MINI_LEAN })
  const small = shrunk(posed, marked, colors.outline, colors[KEY_COLORS[EYE_KEY]])
  return pose.state === 'asleep' ? overlaid(small, MINI_Z, { '#': ZZZ_COLOR }) : small
}

/** Whether a Working squishy leans at this frame: a 2-frame wiggle, upright then leaning, each frame held for two ticks. */
function leansAt(frame: number): boolean {
  return Math.floor(frame / 2) % 2 === 1
}

/** What a pose is drawn with besides the squishy's own art, and how far it leans. */
type PoseMarks = {
  /** The eyes' color, in place of their own: EYE_MARK, to find where they went. */
  eyeColor?: number
  /** Whether an Asleep squishy shows its z; it does unless told not to. */
  showZ?: boolean
  /** How a Working squishy leans: LEAN unless told otherwise. */
  lean?: Lean
}

function posedPicture({ grids, colors }: Painting, { state, frame }: Pose, { eyeColor, showZ = true, lean = LEAN }: PoseMarks = {}): Pixels {
  // Colors that stand in for their keys' own, by key
  const overrides: KeyOverrides = eyeColor === undefined ? {} : { [EYE_KEY]: eyeColor }
  const still = painted(grids, colors, { overrides })
  switch (state) {
    case 'working':
      return leansAt(frame) ? leaning(still, lean) : still
    case 'thinking':
      // A pixel down and back up, a frame each. It starts low, so a Thinking
      // squishy differs from a Working one even standing still. The art keeps
      // its bottom row clear more often than its top one, so down loses less.
      return frame % 2 === 0 ? lowered(still, 1) : still
    case 'asleep': {
      const shut = shutEyes(grids, colors, overrides)
      return showZ ? overlaid(shut, Z_GLYPH, { '#': ZZZ_COLOR }) : shut
    }
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
  const blank = Array.from({ length: PICTURE_SIZE }, () => null)
  return pixels.map((row, index) => (index > bottom ? row : (pixels[2 * index - bottom] ?? blank)))
}

/** The color of an Asleep squishy's z, the same for every palette. */
export const ZZZ_COLOR = 0x88aaee

/** The z an Asleep squishy shows, top right, a pixel in from the edge: `#` is drawn. */
const Z_GLYPH: Grid = ['###.', '.#..', '###.'].map(row => row.padStart(PICTURE_SIZE, '.'))

/**
 * The colors of a squishy's "!" bubble when it Needs you, the same for every
 * palette: a dark ring stands out on light art, and the white bubble and red
 * mark inside it on dark art.
 */
export const RING_COLOR = 0x1c1c2a
export const BUBBLE_COLOR = 0xffffff
export const MARK_COLOR = 0xd02040

const BUBBLE_COLORS: Readonly<Record<string, number>> = { k: RING_COLOR, w: BUBBLE_COLOR, '!': MARK_COLOR }

/**
 * The bubble, drawn top right where an Asleep squishy's z goes: `k` is the
 * ring, `w` the bubble and `!` the mark. A picture at least BUBBLE_FROM wide
 * gets the whole bubble, one copy of it per BUBBLE_FROM pixels; one at least
 * COMPACT_BUBBLE_FROM wide gets a ringed "!" alone; a smaller one a ringed dot.
 */
const BUBBLE: Grid = ['kkkkk', 'kw!wk', 'kw!wk', 'kwwwk', 'kw!wk', 'kkkkk']
const COMPACT_BUBBLE: Grid = ['kkk', 'k!k', 'kkk', 'k!k', 'kkk']
const TINY_BUBBLE: Grid = ['kkk', 'k!k', 'kkk']
// In PICTURE_SIZE terms: the whole bubble at 2x, the compact one at full size, the dot on the mini
const BUBBLE_FROM = SIDES.double
const COMPACT_BUBBLE_FROM = SIDES.full

/** The picture, at whatever size, with the "!" bubble of a squishy that Needs you. */
function withBubble(pixels: Pixels): Pixels {
  const side = pixels.length
  const bubble =
    side >= BUBBLE_FROM ? scaled(BUBBLE, Math.floor(side / BUBBLE_FROM)) : side >= COMPACT_BUBBLE_FROM ? COMPACT_BUBBLE : TINY_BUBBLE
  const left = '.'.repeat(Math.max(0, side - (bubble[0]?.length ?? 0)))
  return overlaid(pixels, bubble.map(row => left + row), BUBBLE_COLORS)
}

/**
 * The color of a glint over each pixel, the one place that tells a shiny's
 * glints from any other's. A shiny's are its fifth color, sparkle. Anything
 * else that sparkles (a legendary, as it appears) keeps to its four colors:
 * its highlight, or its base where it lands on its highlight (the Great
 * Xiaolongbao's crown, say), so a glint never vanishes into what's beneath.
 */
function glintColor(colors: ShinyColors, shiny: boolean): (beneath: Pixel) => number {
  if (shiny) return () => colors.sparkle
  return beneath => (beneath === colors.highlight ? colors.base : colors.highlight)
}

/**
 * Where glints show, as eighths of the picture's side (row, column):
 * around the squishy's edges, taken GLINT_STEP apart so the glints shown
 * together are spread out.
 */
const GLINT_SPOTS: readonly (readonly [row: number, column: number])[] = [
  [1, 1],
  [3, 7],
  [6, 6],
  [1, 5],
  [7, 2],
  [4, 0],
]
const GLINTS_AT_ONCE = 2
const GLINT_STEP = GLINT_SPOTS.length / GLINTS_AT_ONCE
const EIGHTHS = 8

/**
 * The picture, at whatever size, with its glints at this frame. Each glint
 * shows for two frames, a lone pixel and then a plus whose arms are as
 * long as one pixel of the kit's art at this size, then the glints move on
 * to the next spots. On the mini, where a pixel of the art is less than
 * one, the plus is nothing: the glint twinkles out.
 */
function withGlints(pixels: Pixels, frame: number, colorOver: (beneath: Pixel) => number): Pixels {
  const side = pixels.length
  const reach = Math.floor(side / PICTURE_SIZE)
  if (frame % 2 === 1 && reach === 0) return pixels
  const arm = frame % 2 === 0 ? 0 : reach
  const lit = new Set<number>()
  for (let glint = 0; glint < GLINTS_AT_ONCE; glint += 1) {
    const spot = GLINT_SPOTS[(Math.floor(frame / 2) + glint * GLINT_STEP) % GLINT_SPOTS.length]
    if (spot === undefined) continue
    // Inset by an arm, so a plus is never cut off at the edge
    const [row, column] = spot.map(eighths => Math.min(side - 1 - arm, Math.max(arm, Math.floor((eighths * side) / EIGHTHS))))
    if (row === undefined || column === undefined) continue
    for (let by = -arm; by <= arm; by += 1) {
      lit.add((row + by) * side + column)
      lit.add(row * side + column + by)
    }
  }
  return pixels.map((line, row) => line.map((pixel, column) => (lit.has(row * side + column) ? colorOver(pixel) : pixel)))
}

/** Each key of a glyph as a `by` x `by` block. */
function scaled(glyph: Grid, by: number): Grid {
  return glyph.flatMap(row => {
    const wide = [...row].map(key => key.repeat(by)).join('')
    return Array.from({ length: by }, () => wide)
  })
}

/** Pixels drawn over a picture where the glyph has a key of `colors`, in that color. */
function overlaid(pixels: Pixels, glyph: Grid, colors: Readonly<Record<string, number>>): Pixels {
  return pixels.map((row, index) =>
    row.map((pixel, column) => colors[glyph[index]?.[column] ?? '.'] ?? pixel),
  )
}

/**
 * The picture with its eyes shut: wherever an eye shows, what lies beneath
 * it shows instead (the body color where nothing does, as on a legendary),
 * and each eye becomes a line along its bottom row, at least SHUT_EYE_WIDTH
 * wide, widening away from the middle so two eyes stay apart.
 */
function shutEyes(grids: readonly Grid[], colors: ShinyColors, overrides: KeyOverrides): Pixels {
  const lidded = painted(grids, colors, { eyesShut: true, overrides })
  const eye = overrides[EYE_KEY] ?? colors[KEY_COLORS[EYE_KEY]]
  const middle = (PICTURE_SIZE - 1) / 2
  const lines = eyesOf(grids).map(cells => {
    const row = Math.max(...cells.map(([at]) => at))
    let left = Math.min(...cells.map(([, column]) => column))
    let right = Math.max(...cells.map(([, column]) => column))
    // Widen a pixel at a time, outward first, then inward, and so on
    const leftOfMiddle = (left + right) / 2 < middle
    for (let outward = true; right - left + 1 < SHUT_EYE_WIDTH; outward = !outward) {
      if (outward === leftOfMiddle) left -= 1
      else right += 1
    }
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
  const showing = (row: number, column: number) => topKey(grids, row, column) === EYE_KEY
  // Which pixels are in an eye found so far, by row * PICTURE_SIZE + column
  const seen: boolean[] = []
  const eyes: Cell[][] = []
  for (let row = 0; row < PICTURE_SIZE; row += 1) {
    for (let column = 0; column < PICTURE_SIZE; column += 1) {
      if (!showing(row, column) || seen[row * PICTURE_SIZE + column]) continue
      const eye: Cell[] = []
      const queue: Cell[] = [[row, column]]
      seen[row * PICTURE_SIZE + column] = true
      for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
        eye.push(next)
        const [at, across] = next
        for (const [down, right] of NEIGHBORS) {
          const [r, c] = [at + down, across + right]
          if (r < 0 || r >= PICTURE_SIZE || c < 0 || c >= PICTURE_SIZE || seen[r * PICTURE_SIZE + c] || !showing(r, c)) continue
          seen[r * PICTURE_SIZE + c] = true
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

/** The key that shows at a pixel: the topmost grid's that isn't see-through. */
function topKey(grids: readonly Grid[], row: number, column: number): string {
  let shown = SEE_THROUGH
  for (const grid of grids) {
    const key = grid[row]?.[column] ?? SEE_THROUGH
    if (key !== SEE_THROUGH) shown = key
  }
  return shown
}

/** The top `rows` rows moved sideways by `by` pixels; what moves off the edge is lost. */
function leaning(pixels: Pixels, { by, rows }: Lean): Pixels {
  return pixels.map((row, index) => (index < rows ? row.map((_, column) => row[column - by] ?? null) : row))
}

/** The whole picture moved down by `by` pixels; what moves off the bottom is lost. */
function lowered(pixels: Pixels, by: number): Pixels {
  return pixels.map((row, index) => pixels[index - by] ?? row.map(() => null))
}

/**
 * What a squishy's pictures are painted from: body, then face, then
 * accessory (or a legendary's one grid), and its colors.
 */
type Painting = { grids: readonly Grid[]; colors: ShinyColors }

function paintingOf(kit: Kit, squishy: Squishy): Painting {
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

/**
 * A palette's or legendary's colors, or its shiny ones for a shiny squishy.
 * Only a shiny sparkles: elsewhere a glint is just highlight.
 */
function colorsFor(source: { colors: Colors; shiny: ShinyColors }, shiny: boolean): ShinyColors {
  return shiny ? source.shiny : { ...source.colors, sparkle: source.colors.highlight }
}

function partOf<T extends { id: string }>(parts: readonly T[], id: string, kind: string): T {
  const part = parts.find(each => each.id === id)
  if (part === undefined) throw new Error(`The kit has no ${kind} "${id}"`)
  return part
}

/** Colors that stand in for some keys' own (KEY_COLORS), by key. */
type KeyOverrides = Readonly<Partial<Record<GridKey, number>>>

/**
 * Lays grids over one another, the last on top; see-through lets the one
 * beneath show. Each key draws in its color from KEY_COLORS, or its color in
 * `overrides`. Art it can't draw (a grid of the wrong size, a key the kit
 * doesn't use) throws, so the kit's tests catch it rather than a gap in a
 * picture.
 *
 * With `eyesShut`, eye pixels are passed over like see-through, and where
 * only eyes were drawn the body's fill shows instead.
 */
function painted(
  grids: readonly Grid[],
  colors: ShinyColors,
  { eyesShut = false, overrides = {} }: { eyesShut?: boolean; overrides?: KeyOverrides } = {},
): Pixels {
  for (const grid of grids) {
    if (grid.length !== PICTURE_SIZE || grid.some(line => line.length !== PICTURE_SIZE)) {
      throw new Error(`A grid is not ${PICTURE_SIZE}x${PICTURE_SIZE}: ${JSON.stringify(grid)}`)
    }
  }
  return Array.from({ length: PICTURE_SIZE }, (_, row) =>
    Array.from({ length: PICTURE_SIZE }, (_, column) => {
      let pixel: Pixel = null
      for (const grid of grids) {
        let key = grid[row]?.[column] ?? SEE_THROUGH
        if (key === EYE_KEY && eyesShut) key = pixel === null ? FILL_KEY : SEE_THROUGH
        if (key === SEE_THROUGH) continue
        const color = overrides[key as GridKey] ?? keyColor(colors, key)
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
 * The picture at half size, each 2x2 block one pixel, redrawn the way a
 * pixel artist would shrink it, since at this size a face is a pixel or
 * two: a pixel is drawn where at least half its block is; the edge of the
 * drawn shape is outlined again; a block holding any of an eye (where
 * `marked` has EYE_MARK) keeps the eye; and the rest takes the block's most
 * common fill color, the lighter on a tie, so a mouth or a line in the
 * outline color gives way to the fill.
 */
function shrunk(pixels: Pixels, marked: Pixels, outline: number, eye: number): Pixels {
  const half = pixels.length / 2
  const blockOf = (from: Pixels, row: number, column: number): Pixel[] =>
    [from[row * 2], from[row * 2 + 1]].flatMap(line => [line?.[column * 2] ?? null, line?.[column * 2 + 1] ?? null])
  const drawn = Array.from({ length: half }, (_, row) =>
    Array.from({ length: half }, (_, column) => blockOf(pixels, row, column).filter(pixel => pixel !== null).length >= 2),
  )
  const isDrawn = (row: number, column: number) => drawn[row]?.[column] === true
  return drawn.map((line, row) =>
    line.map((on, column) => {
      if (!on) return null
      const edge = !isDrawn(row - 1, column) || !isDrawn(row + 1, column) || !isDrawn(row, column - 1) || !isDrawn(row, column + 1)
      if (edge) return outline
      if (blockOf(marked, row, column).includes(EYE_MARK)) return eye
      const fills = blockOf(pixels, row, column).filter((pixel): pixel is number => pixel !== null && pixel !== outline)
      return mostCommon(fills) ?? outline
    }),
  )
}

/** The color that turns up most often, the lighter on a tie; undefined for none. */
function mostCommon(colors: readonly number[]): number | undefined {
  let best: number | undefined
  let bestCount = 0
  for (const color of colors) {
    const count = colors.filter(other => other === color).length
    if (count > bestCount || (count === bestCount && best !== undefined && lightness(color) > lightness(best))) {
      ;[best, bestCount] = [color, count]
    }
  }
  return best
}

/** How light a color looks: its luma, weighting green most and blue least. */
function lightness(color: number): number {
  return 0.299 * ((color >> 16) & 0xff) + 0.587 * ((color >> 8) & 0xff) + 0.114 * (color & 0xff)
}
