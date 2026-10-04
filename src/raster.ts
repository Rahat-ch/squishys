// Packs a pixel grid into the cells of a terminal `Raster`, two pixels to a
// cell with half-block glyphs: the top pixel as the foreground of ▀ and the
// bottom one as its background.

/** A pixel's color as 0xRRGGBB, or null where the squishy is see-through. */
export type Pixel = number | null

/** Rows of pixels, top to bottom, every row the same width. */
export type Pixels = readonly (readonly Pixel[])[]

/** The props a `Raster` needs besides its key. */
export type RasterCells = { columns: number; rows: number; cells: string }

const TERMINAL_DEFAULT = 0x01000000
const UPPER_HALF = 0x2580 // ▀
const LOWER_HALF = 0x2584 // ▄
const SPACE = 0x20

export function halfBlocks(pixels: Pixels): RasterCells {
  const columns = pixels[0]?.length ?? 0
  const rows = Math.ceil(pixels.length / 2)
  const view = new DataView(new ArrayBuffer(columns * rows * 12))
  let offset = 0
  const put = (codePoint: number, foreground: number, background: number) => {
    view.setUint32(offset, codePoint, true)
    view.setUint32(offset + 4, foreground, true)
    view.setUint32(offset + 8, background, true)
    offset += 12
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const top = pixels[row * 2]?.[column] ?? null
      const bottom = pixels[row * 2 + 1]?.[column] ?? null
      if (top !== null) put(UPPER_HALF, top, bottom ?? TERMINAL_DEFAULT)
      else if (bottom !== null) put(LOWER_HALF, bottom, TERMINAL_DEFAULT)
      else put(SPACE, TERMINAL_DEFAULT, TERMINAL_DEFAULT)
    }
  }
  return { columns, rows, cells: base64Of(new Uint8Array(view.buffer)) }
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
