import { expect, test } from 'claude-code/testing'

import { KIT } from '../src/kit'
import type { Grid, Kit } from '../src/kit'
import { previewItems, verdictDocId } from '../tools/preview/items'

const GREY = 0x808080
const SHINY_GREY = 0xc0c0c0
const EYE = 0x000000
const GOLD = 0xffcc00

/** A grid filled with one key, apart from the rows given by row number. */
function grid(fill: string, rows: Readonly<Record<number, string>> = {}): Grid {
  return Array.from({ length: 16 }, (_, row) => rows[row] ?? fill.repeat(16))
}

const TEST_KIT: Kit = {
  bodies: [
    { id: 'block', rarity: 'common', syllable: 'mo', grid: grid('b') },
    { id: 'slab', rarity: 'rare', syllable: 'ta', grid: grid('.', { 15: 'bbbbbbbbbbbbbbbb' }) },
  ],
  faces: [{ id: 'eye', rarity: 'common', syllable: 'chi', grid: grid('.', { 5: '.....e..........' }) }],
  palettes: [{ id: 'grey', rarity: 'common', syllable: '', colors: { b: GREY, e: EYE }, shiny: { b: SHINY_GREY, e: EYE } }],
  accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: grid('.') }],
  legendaries: [{ id: 'crown', name: 'Crown', grid: grid('g'), colors: { g: GOLD }, shiny: { g: SHINY_GREY } }],
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
    'accessory/none',
    'sample/block/eye/grey/none',
    'sample/slab/eye/grey/none',
    'legendary/crown',
    'starter/1',
    'starter/2',
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

  const [picture] = body?.pictures ?? []
  expect(picture?.pixels[5]?.[5]).toBe(GREY)
  expect(picture?.pixels[0]?.[0]).toBe(GREY)
})

test('a palette and a legendary are each drawn plain and shiny', () => {
  const items = previewItems(TEST_KIT, { samples: 0, seed: 1 })
  const palette = items.find(item => item.id === 'palette/grey')
  const legendary = items.find(item => item.id === 'legendary/crown')

  expect(palette?.pictures.map(picture => picture.pixels[10]?.[10])).toEqual([GREY, SHINY_GREY])
  expect(legendary?.pictures.map(picture => picture.pixels[0]?.[0])).toEqual([GOLD, SHINY_GREY])
})

test('a starter is drawn as its species and carries the Name the roller gives it', () => {
  const starter = previewItems(TEST_KIT, { samples: 0, seed: 1 }).find(item => item.id === 'starter/2')

  expect(starter?.title).toBe('Tachi')
  const [picture] = starter?.pictures ?? []
  expect(picture?.pixels[15]?.[0]).toBe(GREY)
  expect(picture?.pixels[5]?.[5]).toBe(EYE)
  expect(picture?.pixels[0]?.[0]).toBe(null)
})

test('every picture in the shipped kit’s preview is a 16x16 grid', () => {
  for (const item of previewItems(KIT, { samples: 24, seed: 1 })) {
    for (const { pixels } of item.pictures) {
      expect(pixels).toHaveLength(16)
      for (const row of pixels) expect(row).toHaveLength(16)
    }
  }
})

test('each item’s verdict is stored under its own database document id', () => {
  const ids = previewItems(KIT, { samples: 24, seed: 1 }).map(item => item.id)
  const docIds = ids.map(verdictDocId)

  expect(verdictDocId('body/dumpling')).toBe('body:dumpling')
  expect(verdictDocId('sample/a b')).toBe('sample:a~0020b')
  expect(new Set(docIds).size).toBe(ids.length)
  for (const docId of docIds) expect(docId).toMatch(/^[A-Za-z0-9_\-.~:@+]{1,200}$/)
})
