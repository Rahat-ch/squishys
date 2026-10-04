// The PNG encoder: writes a bitmap as the bytes of a PNG file, so the share
// card (src/card.ts) can be saved as an image. Pure and dependency-free: the
// image data is deflated in stored blocks (no compression), which every PNG
// reader takes. Nothing here touches Claude Code.

/** An image as plain data: `width` × `height` pixels, row by row, each 0xRRGGBB. */
export type Bitmap = { width: number; height: number; pixels: Uint32Array }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** The most bytes a stored deflate block holds. */
const STORED_BLOCK = 0xffff

/** The most colors a palette (an indexed PNG) holds. */
const PALETTE_SIZE = 256

/**
 * The PNG of a bitmap: 8-bit indexed color when it has at most 256 colors
 * (a third of the size, which the share card always is), else 8-bit RGB.
 */
export function encodePng({ width, height, pixels }: Bitmap): Uint8Array {
  const palette = paletteOf(pixels)
  const indexed = palette !== undefined
  const perPixel = indexed ? 1 : 3
  const rowBytes = 1 + width * perPixel
  // Each row starts with its filter type: 0, none
  const raw = new Uint8Array(rowBytes * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const pixel = pixels[row * width + column] ?? 0
      const at = row * rowBytes + 1 + column * perPixel
      if (indexed) raw[at] = palette.get(pixel) ?? 0
      else raw.set([pixel >>> 16, (pixel >>> 8) & 0xff, pixel & 0xff], at)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  // Bit depth 8; color type 3 (indexed) or 2 (RGB); deflate, no filter method, no interlace
  header.set([8, indexed ? 3 : 2, 0, 0, 0], 8)
  const plte = indexed ? [chunk('PLTE', Uint8Array.from([...palette.keys()].flatMap(pixel => [pixel >>> 16, (pixel >>> 8) & 0xff, pixel & 0xff])))] : []
  return concatenated([Uint8Array.from(SIGNATURE), chunk('IHDR', header), ...plte, chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array())])
}

/** Each color's palette index, in the order first met; undefined past PALETTE_SIZE colors. */
function paletteOf(pixels: Uint32Array): Map<number, number> | undefined {
  const palette = new Map<number, number>()
  for (const pixel of pixels) {
    if (palette.has(pixel)) continue
    if (palette.size === PALETTE_SIZE) return undefined
    palette.set(pixel, palette.size)
  }
  return palette
}

/** A chunk: its data's length, its type, the data, and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index)
  bytes.set(data, 8)
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)))
  return bytes
}

/** A zlib stream of `data` in stored deflate blocks, ending with its Adler-32. */
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_BLOCK))
  const bytes = new Uint8Array(2 + blocks * 5 + data.length + 4)
  const view = new DataView(bytes.buffer)
  // Deflate with a 32 KiB window, no dictionary, fastest: a header whose check bits make it a multiple of 31
  bytes.set([0x78, 0x01])
  let at = 2
  for (let block = 0; block < blocks; block += 1) {
    const part = data.subarray(block * STORED_BLOCK, (block + 1) * STORED_BLOCK)
    bytes[at] = block === blocks - 1 ? 1 : 0
    view.setUint16(at + 1, part.length, true)
    view.setUint16(at + 3, part.length ^ 0xffff, true)
    bytes.set(part, at + 5)
    at += 5 + part.length
  }
  view.setUint32(at, adler32(data))
  return bytes
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  return crc >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function concatenated(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  return bytes
}
