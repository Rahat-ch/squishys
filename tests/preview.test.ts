import { expect, test } from 'claude-code/testing'

import { PICTURE_SIZE } from '../src/composer'
import { KIT } from '../src/kit'
import type { Colors, Grid, Kit } from '../src/kit'
import { previewItems, verdictDocId } from '../tools/preview/items'

const GREY = 0x808080
const SHINY_GREY = 0xc0c0c0
const EYE = 0x000000
const GOLD = 0xffcc00

const GREYS: Colors = { outline: EYE, dark: 0x404040, base: GREY, highlight: 0xe0e0e0 }
const GOLDS: Colors = { outline: EYE, dark: 0x996600, base: GOLD, highlight: 0xffee88 }

/** A grid filled with one key, apart from the rows given by row number. */
function grid(fill: string, rows: Readonly<Record<number, string>> = {}): Grid {
  return Array.from({ length: PICTURE_SIZE }, (_, row) => (rows[row] ?? fill.repeat(PICTURE_SIZE)).padEnd(PICTURE_SIZE, '.'))
}

const BOTTOM = PICTURE_SIZE - 1

const TEST_KIT: Kit = {
  bodies: [
    { id: 'block', rarity: 'common', syllable: 'mo', grid: grid('b') },
    { id: 'slab', rarity: 'rare', syllable: 'ta', grid: grid('.', { [BOTTOM]: 'b'.repeat(PICTURE_SIZE) }) },
  ],
  faces: [{ id: 'eye', rarity: 'common', syllable: 'chi', grid: grid('.', { 5: '.....e' }) }],
  palettes: [{ id: 'grey', rarity: 'common', syllable: '', colors: GREYS, shiny: { ...GREYS, base: SHINY_GREY, sparkle: GOLD } }],
  accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: grid('.') }],
  legendaries: [{ id: 'crown', name: 'Crown', grid: grid('b'), colors: GOLDS, shiny: { ...GOLDS, base: SHINY_GREY, sparkle: GREY } }],
  starters: [
    { body: 'block', face: 'eye' },
    { body: 'slab', face: 'eye' },
  ],
}

test('the preview lists every part, then sample squishys, every legendary and the starters, each under a stable id', () => {
  const ids = previewItems(TEST_KIT, { samples: 2, seed: 1 }).map(item => item.id)

  expect(ids).toEqual([
    'body/block',
    'body/slab',
    'face/eye',
    'palette/grey',
    'palette/grey/shiny',
    'accessory/none',
    'sample/block/eye/grey/none',
    'sample/slab/eye/grey/none',
    'legendary/crown',
    'legendary/crown/shiny',
    'starter/block/eye',
    'starter/slab/eye',
  ])
})

test('the same seed always rolls the same sample squishys, none of them twice', () => {
  const samplesOf = (seed: number) =>
    previewItems(KIT, { samples: 12, seed })
      .filter(item => item.section === 'sample')
      .map(item => item.id)

  const samples = samplesOf(7)

  expect(samples).toHaveLength(12)
  expect(new Set(samples).size).toBe(12)
  expect(samplesOf(7)).toEqual(samples)
})

test('the samples stop short when the kit can’t make that many different squishys', () => {
  // Two bodies, one of everything else: two species, each plain or shiny
  const samples = previewItems(TEST_KIT, { samples: 10, seed: 1 }).filter(item => item.section === 'sample')

  expect(samples.length).toBe(4)
})

test('a body is drawn on its own, with no face over it', () => {
  const body = previewItems(TEST_KIT, { samples: 0, seed: 1 }).find(item => item.id === 'body/block')

  expect(body?.pixels[5]?.[5]).toBe(GREY)
  expect(body?.pixels[0]?.[0]).toBe(GREY)
})

test('a palette and a legendary are each drawn plain and shiny, as two items', () => {
  const pixelOf = (id: string, row: number, column: number) =>
    previewItems(TEST_KIT, { samples: 0, seed: 1 }).find(item => item.id === id)?.pixels[row]?.[column]

  expect(pixelOf('palette/grey', BOTTOM, BOTTOM)).toBe(GREY)
  expect(pixelOf('palette/grey/shiny', BOTTOM, BOTTOM)).toBe(SHINY_GREY)
  expect(pixelOf('legendary/crown', 0, 0)).toBe(GOLD)
  expect(pixelOf('legendary/crown/shiny', 0, 0)).toBe(SHINY_GREY)
})

test('a starter is drawn as its species and carries the Name the roller gives it', () => {
  const starter = previewItems(TEST_KIT, { samples: 0, seed: 1 }).find(item => item.id === 'starter/slab/eye')

  expect(starter?.heading).toBe('Tachi')
  expect(starter?.pixels[BOTTOM]?.[0]).toBe(GREY)
  expect(starter?.pixels[5]?.[5]).toBe(EYE)
  expect(starter?.pixels[0]?.[0]).toBe(null)
})

test('every picture in the shipped kit’s preview is a PICTURE_SIZE x PICTURE_SIZE grid', () => {
  for (const { pixels } of previewItems(KIT, { samples: 24, seed: 1 })) {
    expect(pixels).toHaveLength(PICTURE_SIZE)
    for (const row of pixels) expect(row).toHaveLength(PICTURE_SIZE)
  }
})

test('an item’s art fingerprint changes when its picture is redrawn, and only then', () => {
  const artOf = (kit: Kit, id: string) => previewItems(kit, { samples: 0, seed: 1 }).find(item => item.id === id)?.art
  const [block, slab] = TEST_KIT.bodies
  if (block === undefined || slab === undefined) throw new Error('TEST_KIT has two bodies')
  const redrawn: Kit = { ...TEST_KIT, bodies: [{ ...block, grid: grid('b', { 0: '.'.padEnd(PICTURE_SIZE, 'b') }) }, slab] }

  expect(artOf(TEST_KIT, 'body/block')).toBe(artOf(TEST_KIT, 'body/block'))
  expect(artOf(redrawn, 'body/block')).not.toBe(artOf(TEST_KIT, 'body/block'))
  expect(artOf(redrawn, 'body/slab')).toBe(artOf(TEST_KIT, 'body/slab'))
  expect(artOf(TEST_KIT, 'palette/grey/shiny')).not.toBe(artOf(TEST_KIT, 'palette/grey'))
})

test('each item’s verdict is stored under its own database document id', () => {
  const ids = previewItems(KIT, { samples: 24, seed: 1 }).map(item => item.id)
  const docIds = ids.map(verdictDocId)

  expect(verdictDocId('body/dumpling')).toBe('body:dumpling')
  expect(verdictDocId('palette/cream/shiny')).toBe('palette:cream:shiny')
  expect(verdictDocId('sample/a b~')).toBe('sample:a~0020b~007e')
  expect(new Set(docIds).size).toBe(ids.length)
  for (const docId of docIds) expect(docId).toMatch(/^[A-Za-z0-9_\-.~:@+]{1,200}$/)
})
