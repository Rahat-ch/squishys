// A PNG reader of the tests' own, for the PNGs the share card is written
// as: 8-bit indexed or RGB color, no interlace, rows unfiltered, and the
// image data deflated in stored blocks. It checks every chunk's CRC and the
// zlib stream's Adler-32 itself, bit by bit, apart from the encoder's tables.

/** One chunk of a PNG, and whether its CRC matches its type and data. */
export type PngChunk = { type: string; data: Uint8Array; crcMatches: boolean }

/** A decoded PNG: its size and each pixel as 0xRRGGBB, row by row. */
export type DecodedPng = { width: number; height: number; pixels: Uint32Array }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function uint32(bytes: Uint8Array, at: number): number {
  return (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
}

/** CRC-32 as PNG defines it (ISO 3309), one bit at a time. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Adler-32 as zlib defines it. */
function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** The chunks of a PNG, in order; throws when the signature is missing. */
export function pngChunks(png: Uint8Array): PngChunk[] {
  if (SIGNATURE.some((byte, index) => png[index] !== byte)) throw new Error('Not a PNG: no signature')
  const chunks: PngChunk[] = []
  for (let at = 8; at < png.length; ) {
    const length = uint32(png, at)
    const typed = png.slice(at + 4, at + 8 + length)
    const type = String.fromCharCode(...typed.slice(0, 4))
    chunks.push({ type, data: typed.slice(4), crcMatches: crc32(typed) === uint32(png, at + 8 + length) })
    at += 12 + length
  }
  return chunks
}

/** The bytes a zlib stream of stored deflate blocks holds, its Adler-32 checked. */
function inflateStored(stream: Uint8Array): Uint8Array {
  if (((stream[0] ?? 0) * 256 + (stream[1] ?? 0)) % 31 !== 0) throw new Error('Bad zlib header')
  const out: number[] = []
  let at = 2
  for (let last = false; !last; ) {
    const header = stream[at] ?? 0
    last = (header & 1) === 1
    if (header >> 1 !== 0) throw new Error('Only stored blocks are read here')
    const length = (stream[at + 1] ?? 0) | ((stream[at + 2] ?? 0) << 8)
    const complement = (stream[at + 3] ?? 0) | ((stream[at + 4] ?? 0) << 8)
    if ((length ^ 0xffff) !== complement) throw new Error('A stored block’s length and its complement disagree')
    out.push(...stream.slice(at + 5, at + 5 + length))
    at += 5 + length
  }
  const bytes = Uint8Array.from(out)
  if (adler32(bytes) !== uint32(stream, at)) throw new Error('The Adler-32 does not match')
  return bytes
}

/** A PNG's pixels; throws on anything this reader doesn't read. */
export function decodePng(png: Uint8Array): DecodedPng {
  const chunks = pngChunks(png)
  const header = chunks.find(chunk => chunk.type === 'IHDR')?.data
  if (header === undefined) throw new Error('No IHDR')
  const [width, height] = [uint32(header, 0), uint32(header, 4)]
  const [depth, colorType, , , interlace] = header.slice(8)
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 3)) throw new Error('Not a PNG this reader reads')
  const data = inflateStored(Uint8Array.from(chunks.filter(chunk => chunk.type === 'IDAT').flatMap(chunk => [...chunk.data])))
  const palette = chunks.find(chunk => chunk.type === 'PLTE')?.data ?? new Uint8Array()
  const color = (bytes: Uint8Array, at: number) => (((bytes[at] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0)) >>> 0
  const perPixel = colorType === 2 ? 3 : 1
  const rowBytes = 1 + width * perPixel
  if (data.length !== rowBytes * height) throw new Error(`Expected ${rowBytes * height} bytes of image data, got ${data.length}`)
  const pixels = new Uint32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    if (data[row * rowBytes] !== 0) throw new Error('Only unfiltered rows are read here')
    for (let column = 0; column < width; column += 1) {
      const at = row * rowBytes + 1 + column * perPixel
      pixels[row * width + column] = colorType === 2 ? color(data, at) : color(palette, (data[at] ?? 0) * 3)
    }
  }
  return { width, height, pixels }
}
