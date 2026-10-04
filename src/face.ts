// The tiny face: a squishy's face, cropped from its picture and shrunk to
// fit one row of colored half-block text, as the spinner draws the
// partner's beside Claude Code's own (src/spinner.tsx). Pure: it takes the
// kit and a squishy as plain data and never touches Claude Code.

import { compose } from './composer'
import type { Kit } from './kit'
import type { Pixel, Pixels } from './raster'
import type { Squishy } from './roller'

/** How many rows of text the tiny face takes. */
export const FACE_ROWS = 1

/** Two pixels to a row of text: the top one as ▀'s color, the bottom one as its background. */
const PIXELS_PER_ROW = 2

/** One cell of the tiny face: its glyph and colors, as `Text` props take them. */
export type FaceCell = { glyph: string; color?: string; backgroundColor?: string }

/** One row of text of the tiny face, left to right. */
export type FaceRow = readonly FaceCell[]

type Region = { top: number; left: number; rows: number; columns: number }

/**
 * The squishy's tiny face, at most FACE_ROWS rows of half blocks: its still
 * picture where its face part is drawn, shrunk as little as fits. Nothing
 * for a squishy whose face part draws nothing, or a legendary, which has no
 * face part.
 */
export function tinyFace(kit: Kit, squishy: Squishy): FaceRow[] {
  const region = faceRegion(kit, squishy)
  if (region === undefined) return []
  const picture = compose(kit, squishy, { state: 'working', frame: 0 })
  const face = cropped(picture, region)
  const by = Math.max(1, Math.ceil(region.rows / (FACE_ROWS * PIXELS_PER_ROW)))
  return halfBlockRows(shrunk(face, by))
}

/** Where the squishy's face part draws, in its picture: the box round every pixel it draws. */
function faceRegion(kit: Kit, squishy: Squishy): Region | undefined {
  if (squishy.kind !== 'assembled') return undefined
  const grid = kit.faces.find(face => face.id === squishy.face)?.grid ?? []
  const drawn = grid.flatMap((line, row) => [...line].flatMap((key, column) => (key === '.' ? [] : [{ row, column }])))
  if (drawn.length === 0) return undefined
  const top = Math.min(...drawn.map(cell => cell.row))
  const left = Math.min(...drawn.map(cell => cell.column))
  return {
    top,
    left,
    rows: Math.max(...drawn.map(cell => cell.row)) - top + 1,
    columns: Math.max(...drawn.map(cell => cell.column)) - left + 1,
  }
}

function cropped(picture: Pixels, { top, left, rows, columns }: Region): Pixels {
  return picture.slice(top, top + rows).map(row => row.slice(left, left + columns))
}

/**
 * Each `by` x `by` block as one pixel: see-through where less than half
 * the block is drawn, otherwise the block's color the whole face has least
 * of (the first met on a tie), so eyes, cheeks and mouth outlast the body
 * around them.
 */
function shrunk(pixels: Pixels, by: number): Pixels {
  if (by === 1) return pixels
  const counts = new Map<number, number>()
  for (const row of pixels) for (const pixel of row) if (pixel !== null) counts.set(pixel, (counts.get(pixel) ?? 0) + 1)
  const columns = pixels[0]?.length ?? 0
  return Array.from({ length: Math.ceil(pixels.length / by) }, (_, row) =>
    Array.from({ length: Math.ceil(columns / by) }, (_, column): Pixel => {
      const block = pixels.slice(row * by, (row + 1) * by).flatMap(line => line.slice(column * by, (column + 1) * by))
      const drawn = block.filter((pixel): pixel is number => pixel !== null)
      if (drawn.length * 2 < block.length) return null
      let best: Pixel = null
      for (const pixel of drawn) if (best === null || (counts.get(pixel) ?? 0) < (counts.get(best) ?? 0)) best = pixel
      return best
    }),
  )
}

/** Two pixel rows to a row of half-block cells: ▀ over its background, ▄ alone below, a space for neither. */
function halfBlockRows(pixels: Pixels): FaceRow[] {
  return Array.from({ length: Math.ceil(pixels.length / PIXELS_PER_ROW) }, (_, row) =>
    (pixels[row * PIXELS_PER_ROW] ?? []).map((top, column): FaceCell => {
      const bottom = pixels[row * PIXELS_PER_ROW + 1]?.[column] ?? null
      if (top !== null) return bottom === null ? { glyph: '▀', color: hex(top) } : { glyph: '▀', color: hex(top), backgroundColor: hex(bottom) }
      if (bottom !== null) return { glyph: '▄', color: hex(bottom) }
      return { glyph: ' ' }
    }),
  )
}

function hex(pixel: number): string {
  return `#${pixel.toString(16).padStart(6, '0')}`
}
