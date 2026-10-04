// The tiny face: a squishy's face, cropped from its picture and shrunk to
// fit one row of colored half-block text, as the spinner draws the
// partner's beside Claude Code's own (src/spinner.tsx). Pure: it takes the
// kit and a squishy as plain data and never touches Claude Code.

import { SEE_THROUGH, stillPixels } from './composer'
import type { Grid, Kit } from './kit'
import { halfBlockRows, hexColor } from './raster'
import type { Pixel } from './raster'
import type { Squishy } from './roller'

/** How many rows of text the tiny face takes. */
export const FACE_ROWS = 1

/** Two pixels to a row of text: half blocks. */
const PIXELS_PER_ROW = 2

/**
 * The face keys a shrunk block shows first, in order: eyes, mouth, blush
 * (see Grid in kit.ts). Told apart by key, not color: in the 4-color art,
 * eyes and mouth share the outline color and blush the dark shade.
 */
const FEATURE_KEYS: readonly string[] = ['e', 'm', 'c']

/** One cell of the tiny face: its glyph and colors, as `Text` props take them. */
export type FaceCell = { glyph: string; color?: string; backgroundColor?: string }

/** One row of text of the tiny face, left to right. */
export type FaceRow = readonly FaceCell[]

type Region = { top: number; left: number; rows: number; columns: number }

/** A pixel of the face, and the face key that shows there, if any (none where the accessory covers it). */
type FacePixel = { pixel: Pixel; key: string | undefined }

/**
 * The squishy's tiny face, at most FACE_ROWS rows of half blocks: its still
 * picture where its face part is drawn, shrunk as little as fits. Nothing
 * for a squishy whose face part draws nothing, or a legendary, which has no
 * face part.
 */
export function tinyFace(kit: Kit, squishy: Squishy): FaceRow[] {
  if (squishy.kind !== 'assembled') return []
  const face = kit.faces.find(part => part.id === squishy.face)?.grid ?? []
  const region = drawnRegion(face)
  if (region === undefined) return []
  const accessory = kit.accessories.find(part => part.id === squishy.accessory)?.grid ?? []
  const picture = stillPixels(kit, squishy)
  const pixels = Array.from({ length: region.rows }, (_, down) =>
    Array.from({ length: region.columns }, (_, across): FacePixel => {
      const [row, column] = [region.top + down, region.left + across]
      const covered = keyAt(accessory, row, column) !== SEE_THROUGH
      const key = keyAt(face, row, column)
      return { pixel: picture[row]?.[column] ?? null, key: covered || key === SEE_THROUGH ? undefined : key }
    }),
  )
  const factor = Math.max(1, Math.ceil(region.rows / (FACE_ROWS * PIXELS_PER_ROW)))
  return halfBlockRows(shrunk(pixels, factor)).map(row =>
    row.map(({ glyph, foreground, background }) => ({
      glyph,
      ...(foreground === null ? {} : { color: hexColor(foreground) }),
      ...(background === null ? {} : { backgroundColor: hexColor(background) }),
    })),
  )
}

function keyAt(grid: Grid, row: number, column: number): string {
  return grid[row]?.[column] ?? SEE_THROUGH
}

/** The box round every key a grid draws; undefined for a grid that draws nothing. */
function drawnRegion(grid: Grid): Region | undefined {
  const drawn = grid.flatMap((line, row) => [...line].flatMap((key, column) => (key === SEE_THROUGH ? [] : [{ row, column }])))
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

/**
 * Each `factor` x `factor` block as one pixel: see-through where less than
 * half the block is drawn; otherwise the color of the first eye pixel in
 * it, or failing that mouth, then blush (FEATURE_KEYS); otherwise the
 * block's most common color (the first met on a tie).
 */
function shrunk(pixels: readonly (readonly FacePixel[])[], factor: number): Pixel[][] {
  const columns = pixels[0]?.length ?? 0
  return Array.from({ length: Math.ceil(pixels.length / factor) }, (_, row) =>
    Array.from({ length: Math.ceil(columns / factor) }, (_, column): Pixel => {
      const block = pixels.slice(row * factor, (row + 1) * factor).flatMap(line => line.slice(column * factor, (column + 1) * factor))
      const drawn = block.filter(({ pixel }) => pixel !== null)
      if (drawn.length * 2 < block.length) return null
      for (const feature of FEATURE_KEYS) {
        const shown = drawn.find(({ key }) => key === feature)
        if (shown !== undefined) return shown.pixel
      }
      let best: Pixel = null
      let bestCount = 0
      for (const { pixel } of drawn) {
        const count = drawn.filter(other => other.pixel === pixel).length
        if (count > bestCount) [best, bestCount] = [pixel, count]
      }
      return best
    }),
  )
}
