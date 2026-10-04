import { expect, test } from 'claude-code/testing'

import { KIT } from '../src/kit'
import type { Kit } from '../src/kit'
import { roll } from '../src/roller'
import type { Squishy } from '../src/roller'
import { seeded } from './seeded'

const BLANK = Array.from({ length: 16 }, () => '................')

// A kit of one part of each kind, so every roll is the same squishy
const ONE_OF_EACH: Kit = {
  bodies: [{ id: 'round', rarity: 'common', syllable: 'mo', grid: BLANK }],
  faces: [{ id: 'smile', rarity: 'common', syllable: 'chi', grid: BLANK }],
  palettes: [{ id: 'cream', rarity: 'common', syllable: '', colors: {}, shiny: {} }],
  accessories: [{ id: 'none', rarity: 'common', syllable: '', grid: BLANK }],
  legendaries: [],
  starters: [],
}

test('a roll assembles a squishy from the kit’s parts and names it from them', () => {
  const squishy = roll(ONE_OF_EACH, { live: [], rng: seeded(1), odds: { legendary: 0, shiny: 0 } })

  expect(squishy).toMatchObject({
    kind: 'assembled',
    body: 'round',
    face: 'smile',
    palette: 'cream',
    accessory: 'none',
    rarity: 'common',
    shiny: false,
    name: 'Mochi',
  })
})

// Seeded, so each run sees the same numbers; the tolerances are still wide
// (four standard deviations or more) so a change to how the roller spends
// its randomness doesn't break them by chance.
function rollMany(samples: number, odds?: Parameters<typeof roll>[1]['odds']) {
  const rng = seeded(2026)
  return Array.from({ length: samples }, () => roll(KIT, { live: [], rng, odds }))
}

// Enough for the legendary share to land within a quarter of 1 in 1,000
const STANDARD_ROLLS = rollMany(250_000)

function share<T>(items: readonly T[], test: (item: T) => boolean): number {
  return items.filter(test).length / items.length
}

test('about 1 in 1,000 rolls is a legendary', () => {
  const legendaryShare = share(STANDARD_ROLLS, squishy => squishy.kind === 'legendary')

  expect(legendaryShare).toBeGreaterThan(0.75 / 1000)
  expect(legendaryShare).toBeLessThan(1.25 / 1000)
})

test('about 1 in 128 rolls is shiny', () => {
  const shinyShare = share(STANDARD_ROLLS, squishy => squishy.shiny)

  expect(shinyShare).toBeGreaterThan(0.9 / 128)
  expect(shinyShare).toBeLessThan(1.1 / 128)
})

test('shiny is rolled independently, so about 1 in 128 legendaries is shiny', () => {
  const rolls = rollMany(100_000, { legendary: 1 })

  expect(rolls.every(squishy => squishy.kind === 'legendary')).toBe(true)
  expect(share(rolls, squishy => squishy.shiny)).toBeGreaterThan(0.85 / 128)
  expect(share(rolls, squishy => squishy.shiny)).toBeLessThan(1.15 / 128)
})

test('each kind of part comes out 70% common, 25% uncommon and 5% rare', () => {
  const rolls = rollMany(100_000, { legendary: 0 })

  for (const [kind, parts] of [
    ['body', KIT.bodies],
    ['face', KIT.faces],
    ['palette', KIT.palettes],
    ['accessory', KIT.accessories],
  ] as const) {
    const rarities = rolls.map(squishy => {
      const id = squishy.kind === 'assembled' ? squishy[kind] : undefined
      return parts.find(part => part.id === id)?.rarity
    })
    expect(share(rarities, rarity => rarity === 'common')).toBeGreaterThan(0.69)
    expect(share(rarities, rarity => rarity === 'common')).toBeLessThan(0.71)
    expect(share(rarities, rarity => rarity === 'uncommon')).toBeGreaterThan(0.24)
    expect(share(rarities, rarity => rarity === 'uncommon')).toBeLessThan(0.26)
    expect(share(rarities, rarity => rarity === 'rare')).toBeGreaterThan(0.045)
    expect(share(rarities, rarity => rarity === 'rare')).toBeLessThan(0.055)
  }
})

/** Rolls squishys one after another, each with the ones before it live. */
function rollInTurn(kit: Kit, count: number, seed: number) {
  const rng = seeded(seed)
  const live: Squishy[] = []
  for (let n = 0; n < count; n += 1) live.push(roll(kit, { live, rng }))
  return live
}

test('a roll is never a squishy a live agent already has', () => {
  // The placeholder kit makes 3^4 parts × 2 + 1 legendary × 2 = 164 squishys
  const live = rollInTurn(KIT, 160, 7)

  expect(new Set(live.map(squishy => squishy.key)).size).toBe(160)
})

test('when only a shiny is left, the roll is that shiny', () => {
  // Two palettes, each plain or shiny: four squishys in all
  const kit: Kit = {
    ...ONE_OF_EACH,
    palettes: [...ONE_OF_EACH.palettes, { id: 'peach', rarity: 'rare', syllable: 'ko', colors: {}, shiny: {} }],
  }
  const forced = (palette: 'common' | 'rare', shiny: number) =>
    roll(kit, {
      live: [],
      rng: seeded(11),
      odds: { shiny, rarity: { common: 0, uncommon: 0, rare: 0, [palette]: 1 } },
    })
  const live = [forced('common', 0), forced('rare', 0), forced('common', 1)]

  // Plain rolls are 127 in 128, so rolling until the free one came up would
  // take a while
  const last = roll(kit, { live, rng: seeded(12) })

  expect(last).toMatchObject({ palette: 'peach', shiny: true })
})

test('the same parts always make the same name and key, and different ones a different key', () => {
  const namesByKey = new Map<string, string>()
  const keysByLook = new Map<string, string>()
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const squishy of rollInTurn(KIT, 100, seed)) {
      const look =
        squishy.kind === 'legendary'
          ? `${squishy.legendary} ${squishy.shiny}`
          : `${squishy.body} ${squishy.face} ${squishy.palette} ${squishy.accessory} ${squishy.shiny}`
      expect(namesByKey.get(squishy.key) ?? squishy.name).toBe(squishy.name)
      expect(keysByLook.get(look) ?? squishy.key).toBe(squishy.key)
      namesByKey.set(squishy.key, squishy.name)
      keysByLook.set(look, squishy.key)
    }
  }

  // Every look met had a key of its own
  expect(new Set(keysByLook.values()).size).toBe(keysByLook.size)
})

test('a shiny keeps its name but has a key of its own', () => {
  const plain = roll(ONE_OF_EACH, { live: [], rng: seeded(3), odds: { shiny: 0 } })
  const shiny = roll(ONE_OF_EACH, { live: [], rng: seeded(3), odds: { shiny: 1 } })

  expect(shiny).toMatchObject({ shiny: true, name: plain.name })
  expect(shiny.key).not.toBe(plain.key)
})

test('a legendary always carries its fixed name, shiny or not', () => {
  const kit: Kit = {
    ...ONE_OF_EACH,
    legendaries: [{ id: 'grand-bao', name: 'Grand Bao', grid: BLANK, colors: {}, shiny: {} }],
  }

  for (const shiny of [0, 1]) {
    const squishy = roll(kit, { live: [], rng: seeded(4), odds: { legendary: 1, shiny } })
    expect(squishy).toMatchObject({ kind: 'legendary', legendary: 'grand-bao', name: 'Grand Bao', shiny: shiny === 1 })
  }
})

test('a squishy’s rarity is that of its rarest part', () => {
  const kit: Kit = {
    ...ONE_OF_EACH,
    accessories: [{ id: 'bow', rarity: 'rare', syllable: 'bi', grid: BLANK }],
  }

  expect(roll(kit, { live: [], rng: seeded(5) })).toMatchObject({ rarity: 'rare', name: 'Mochibi' })
})
