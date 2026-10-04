// The PNG encoder: a bitmap in, the bytes of a PNG file out, with no
// dependencies. Read back here by a decoder of the test's own.

import { expect, test } from 'claude-code/testing'

import { encodePng } from '../src/png'
import { decodePng, pngChunks } from './png-reader'

const RED = 0xff0000
const BLUE = 0x0000ff
const CREAM = 0xf3efe6

test('a PNG starts with the PNG signature and ends with the IEND chunk', () => {
  const png = encodePng({ width: 1, height: 1, pixels: Uint32Array.of(RED) })

  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  // IEND's length, type and its CRC, as every PNG ends
  expect([...png.slice(-12)]).toEqual([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
})

test('every chunk carries the CRC of its type and data, and IHDR says the bitmap’s size', () => {
  const png = encodePng({ width: 3, height: 2, pixels: Uint32Array.of(RED, BLUE, CREAM, CREAM, BLUE, RED) })

  const chunks = pngChunks(png)
  expect(chunks.map(chunk => chunk.type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND'])
  for (const chunk of chunks) expect(chunk.crcMatches).toBe(true)
  expect(decodePng(png)).toMatchObject({ width: 3, height: 2 })
})

test('a PNG decodes to the bitmap’s own pixels', () => {
  const pixels = Uint32Array.of(RED, BLUE, CREAM, CREAM, BLUE, RED)

  expect([...decodePng(encodePng({ width: 3, height: 2, pixels })).pixels]).toEqual([...pixels])
})

test('a bitmap of more than 256 colors is written in full color', () => {
  const pixels = Uint32Array.from({ length: 300 }, (_, index) => index * 0x0101)

  const png = encodePng({ width: 20, height: 15, pixels })

  expect(pngChunks(png).map(chunk => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  expect([...decodePng(png).pixels]).toEqual([...pixels])
})

test('a bitmap bigger than one stored deflate block still decodes whole', () => {
  // 300 × 300 one-byte pixels, plus a filter byte a row: past 65,535 bytes
  const pixels = Uint32Array.from({ length: 300 * 300 }, (_, index) => (index % 7 === 0 ? RED : CREAM))

  expect([...decodePng(encodePng({ width: 300, height: 300, pixels })).pixels]).toEqual([...pixels])
})
