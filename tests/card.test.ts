// The share card: a squishy drawn large and crisp on a colored card, with
// its Name, its rarity, shiny and legendary badges, and a footer.

import { expect, test } from 'claude-code/testing'

import { CROWN_COLOR, INK_COLOR, SPARKLE_COLOR, drawCard, shareCard } from '../src/card'
import type { Card } from '../src/card'
import { stillPixels } from '../src/composer'
import { KIT } from '../src/kit'
import type { Pixels } from '../src/raster'
import { legendaryKey, speciesSquishy, squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'

const PINK = 0xff88aa
const NAVY = 0x223355

const [STARTER] = KIT.starters
const [LEGENDARY] = KIT.legendaries
const PLAIN = STARTER && speciesSquishy(KIT, STARTER)
if (!PLAIN || !LEGENDARY) throw new Error('The kit needs a starter and a legendary')
const SHINY: Squishy = { ...PLAIN, shiny: true }
const CROWNED = squishyOf(KIT, legendaryKey(LEGENDARY.id))
if (!CROWNED) throw new Error('No squishy for the legendary')

/** A `side` × `side` picture: a checkerboard of two colors, its top row see-through. */
function checkerboard(side: number): Pixels {
  return Array.from({ length: side }, (_, row) => Array.from({ length: side }, (_, column) => (row === 0 ? null : (row + column) % 2 === 0 ? PINK : NAVY)))
}

function pixelAt(card: Card, x: number, y: number): number | undefined {
  return card.pixels[y * card.width + x]
}

/** Whether every picture pixel shows on the card as a block of its color, `scale` wide each way. */
function showsPicture(card: Card, picture: Pixels): boolean {
  const { left, top, scale } = card.art
  return picture.every((row, y) =>
    row.every((pixel, x) => {
      if (pixel === null) return true
      for (let down = 0; down < scale; down += 1) {
        for (let across = 0; across < scale; across += 1) {
          if (pixelAt(card, left + x * scale + across, top + y * scale + down) !== pixel) return false
        }
      }
      return true
    }),
  )
}

function hasColor(card: Card, color: number): boolean {
  return card.pixels.includes(color)
}

function differ(one: Card, other: Card): boolean {
  return one.pixels.length !== other.pixels.length || one.pixels.some((pixel, index) => pixel !== other.pixels[index])
}

for (const side of [10, 16]) {
  test(`a ${side}×${side} picture is drawn large and crisp, each pixel a block, on a card about 600 pixels wide`, () => {
    const picture = checkerboard(side)

    const card = drawCard(picture, PLAIN)

    expect(showsPicture(card, picture)).toBe(true)
    expect(card.art.scale * side).toBeGreaterThanOrEqual(400)
    expect(card.width).toBeGreaterThanOrEqual(560)
    expect(card.width).toBeLessThanOrEqual(640)
    expect(card.art.left + card.art.scale * side).toBeLessThan(card.width)
    expect(card.pixels.length).toBe(card.width * card.height)
  })
}

test('a squishy’s card shows its own composed picture, at rest', () => {
  const card = shareCard(KIT, PLAIN)

  expect(showsPicture(card, stillPixels(KIT, PLAIN))).toBe(true)
})

test('a shiny’s card shows a sparkle, and a plain one’s none', () => {
  expect(hasColor(shareCard(KIT, SHINY), SPARKLE_COLOR)).toBe(true)
  expect(hasColor(shareCard(KIT, PLAIN), SPARKLE_COLOR)).toBe(false)
})

test('a legendary’s card shows its crown, and an assembled squishy’s none', () => {
  expect(hasColor(shareCard(KIT, CROWNED), CROWN_COLOR)).toBe(true)
  expect(hasColor(shareCard(KIT, { ...CROWNED, shiny: true }), SPARKLE_COLOR)).toBe(true)
  expect(hasColor(shareCard(KIT, PLAIN), CROWN_COLOR)).toBe(false)
})

test('the card carries the Name and the rarity', () => {
  const card = drawCard(checkerboard(10), PLAIN)

  expect(differ(drawCard(checkerboard(10), { ...PLAIN, name: 'Dumplo' }), card)).toBe(true)
  expect(differ(drawCard(checkerboard(10), { ...PLAIN, rarity: PLAIN.rarity === 'rare' ? 'common' : 'rare' }), card)).toBe(true)
})

test('a long Name is drawn smaller, clear of the card’s edges', () => {
  const card = drawCard(checkerboard(10), { ...PLAIN, name: 'Mochimochimochimochimochimochimochimochi' })
  const margin = 16

  const inked = (x: number) => Array.from({ length: card.height }, (_, y) => pixelAt(card, x, y)).includes(INK_COLOR)
  const edges = Array.from({ length: margin }, (_, index) => [index, card.width - 1 - index]).flat()
  expect(edges.filter(inked)).toEqual([])
  expect(hasColor(card, INK_COLOR)).toBe(true)
})
