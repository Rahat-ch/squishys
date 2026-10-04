// Packs a pixel grid into the cells of a terminal `Raster`, two pixels to a
// cell with half-block glyphs: the top pixel as the foreground of ▀ and the
// bottom one as its background.

/** A pixel's color as 0xRRGGBB, or null where the squishy is see-through. */
export type Pixel = number | null

/** Rows of pixels, top to bottom, every row the same width. */
export type Pixels = readonly (readonly Pixel[])[]

/** The props a `Raster` needs besides its key. */
export type RasterCells = { columns: number; rows: number; cells: string }

/**
 * One cell of two pixels, one over the other: its glyph, and the colors it
 * is drawn in (null for the terminal's own).
 */
export type HalfBlock = { glyph: '▀' | '▄' | ' '; foreground: Pixel; background: Pixel }

const TERMINAL_DEFAULT = 0x01000000

/**
 * Two pixel rows to a row of cells: ▀ in the top pixel's color over the
 * bottom one's, ▄ in the bottom one's where only it is drawn, a space where
 * neither is. An odd last row leaves the bottom halves see-through. The
 * Raster packer and the spinner's tiny face both draw through this.
 */
export function halfBlockRows(pixels: Pixels): HalfBlock[][] {
  return Array.from({ length: Math.ceil(pixels.length / 2) }, (_, row) =>
    (pixels[row * 2] ?? []).map((top, column): HalfBlock => {
      const bottom = pixels[row * 2 + 1]?.[column] ?? null
      if (top !== null) return { glyph: '▀', foreground: top, background: bottom }
      if (bottom !== null) return { glyph: '▄', foreground: bottom, background: null }
      return { glyph: ' ', foreground: null, background: null }
    }),
  )
}

export function halfBlocks(pixels: Pixels): RasterCells {
  const columns = pixels[0]?.length ?? 0
  const blocks = halfBlockRows(pixels)
  const view = new DataView(new ArrayBuffer(columns * blocks.length * 12))
  let offset = 0
  for (const { glyph, foreground, background } of blocks.flat()) {
    view.setUint32(offset, glyph.codePointAt(0) ?? 0, true)
    view.setUint32(offset + 4, foreground ?? TERMINAL_DEFAULT, true)
    view.setUint32(offset + 8, background ?? TERMINAL_DEFAULT, true)
    offset += 12
  }
  return { columns, rows: blocks.length, cells: base64Of(new Uint8Array(view.buffer)) }
}

/** A pixel's color as `#rrggbb`. */
export function hexColor(pixel: number): string {
  return `#${pixel.toString(16).padStart(6, '0')}`
}

/** Bytes as base64: a Raster's cells, and the share card's PNG. */
export function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
