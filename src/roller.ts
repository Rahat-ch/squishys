// The roller: decides which squishy an agent gets. Pure: it takes the kit,
// the squishys already live and a source of randomness, and never touches
// Claude Code, so its tests seed the randomness and call it directly.

import { SEE_THROUGH } from './composer'
import type { Accessory, Kit, PartBase, Rarity, Species } from './kit'

/** A squishy assembled from the kit's parts. */
export type AssembledSquishy = {
  kind: 'assembled'
  /** The species: body and face. */
  body: string
  face: string
  /** The variant: palette and accessory. */
  palette: string
  accessory: string
  /** The rarity of its rarest part. */
  rarity: Rarity
  shiny: boolean
  name: string
  /** Stable identity: the same parts and shininess always give the same key. */
  key: string
}

/** One of the kit's legendaries, drawn whole. */
export type LegendarySquishy = {
  kind: 'legendary'
  legendary: string
  shiny: boolean
  /** The legendary's fixed Name. */
  name: string
  key: string
}

/**
 * A squishy's identity: everything that tells one squishy from another.
 * types/index.d.ts writes the same shape out again for the mod's state.
 */
export type Squishy = AssembledSquishy | LegendarySquishy

export type Odds = {
  /** Chance a roll is a legendary. */
  legendary: number
  /** Chance a roll is shiny, rolled independently of everything else. */
  shiny: number
  /** Chance each part comes from each rarity. */
  rarity: Readonly<Record<Rarity, number>>
}

export const ODDS: Odds = {
  legendary: 1 / 1000,
  shiny: 1 / 128,
  rarity: { common: 0.7, uncommon: 0.25, rare: 0.05 },
}

/**
 * The odds a forced roll takes, by what `SQUISHYS_FORCE_ROLL` names: the
 * mod's tests force plain rolls (so a stray shiny's sparkle never shows up
 * in a test about something else) and shiny or legendary ones (to see a
 * moment), and so can a person trying the mod out.
 */
const FORCED_ODDS: Readonly<Record<string, Partial<Odds>>> = {
  plain: { legendary: 0, shiny: 0 },
  shiny: { legendary: 0, shiny: 1 },
  legendary: { legendary: 1, shiny: 0 },
  'shiny-legendary': { legendary: 1, shiny: 1 },
}

/** The odds `SQUISHYS_FORCE_ROLL` forces; undefined (the standard odds) when it's unset or names nothing known. */
export function forcedOdds(value: string | undefined): Partial<Odds> | undefined {
  return value !== undefined && Object.hasOwn(FORCED_ODDS, value) ? FORCED_ODDS[value] : undefined
}

/** A source of randomness: each call returns a number in [0, 1). */
export type Rng = () => number

/** Real randomness, which the mod rolls with: a number in [0, 1) from the platform. */
export function cryptoRandom(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return value / 0x1_0000_0000
}

export type RollOptions = {
  /** The squishys live agents already have; the roll is none of them. */
  live: readonly Squishy[]
  rng: Rng
  /** Odds to roll with in place of the standard ones. */
  odds?: Partial<Odds>
}

/** Rolls before the roller stops rolling and picks among what's left. */
const ATTEMPTS = 32

/**
 * Rolls a squishy that no live agent has. Should every squishy the kit can
 * make be live already, a duplicate can't be avoided and one is returned.
 */
export function roll(kit: Kit, { live, rng, odds: given }: RollOptions): Squishy {
  const odds = { ...ODDS, ...given }
  const taken = new Set(live.map(squishy => squishy.key))
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const squishy = rollOnce(kit, odds, rng)
    if (!taken.has(squishy.key)) return squishy
  }
  // Nearly every squishy is live: pick among the free ones directly, each
  // as likely as rolling until it came up would make it.
  // A squishy the odds rule out (weight 0) never comes up, even here.
  const free = everySquishy(kit, odds).filter(({ value, weight }) => weight > 0 && !taken.has(value.key))
  return free.length > 0 ? pick(free, rng) : rollOnce(kit, odds, rng)
}

/**
 * The key of the squishy made of these parts: what squishyOf reads back.
 * `body/face/palette/accessory`, and `/shiny` for a shiny.
 */
export function assembledKey(parts: { body: string; face: string; palette: string; accessory: string }, shiny = false): string {
  return [parts.body, parts.face, parts.palette, parts.accessory].join('/') + (shiny ? '/shiny' : '')
}

/** The key of a legendary's squishy: what squishyOf reads back. `legendary/<id>`, and `/shiny` for a shiny. */
export function legendaryKey(id: string, shiny = false): string {
  return `legendary/${id}` + (shiny ? '/shiny' : '')
}

/**
 * The squishy a key stands for, so a squishy can be kept as its key alone.
 * Undefined when the kit no longer has one of its parts.
 */
export function squishyOf(kit: Kit, key: string): Squishy | undefined {
  const ids = key.split('/')
  const shiny = ids[ids.length - 1] === 'shiny'
  if (shiny) ids.pop()
  if (ids.length === 2 && ids[0] === 'legendary') {
    const legendary = kit.legendaries.find(each => each.id === ids[1])
    return legendary === undefined ? undefined : legendaryOf(legendary, shiny)
  }
  if (ids.length !== 4) return undefined
  const [body, face, palette, accessory] = [
    kit.bodies.find(part => part.id === ids[0]),
    kit.faces.find(part => part.id === ids[1]),
    kit.palettes.find(part => part.id === ids[2]),
    kit.accessories.find(part => part.id === ids[3]),
  ]
  if (!body || !face || !palette || !accessory) return undefined
  return assembledOf({ body, face, palette, accessory }, shiny)
}

/**
 * A species as a squishy, the way a starter and the partner are drawn: in
 * `palette` (the kit's first when it's not given or the kit no longer has
 * it), with the bare accessory (the one that is all `.`, else the kit's
 * first), never shiny. Undefined when the kit lacks the body or face.
 */
export function speciesSquishy(kit: Kit, { body, face }: Species, palette?: string): AssembledSquishy | undefined {
  const parts = {
    body: kit.bodies.find(part => part.id === body),
    face: kit.faces.find(part => part.id === face),
    palette: kit.palettes.find(part => part.id === palette) ?? kit.palettes[0],
    accessory: bareAccessory(kit) ?? kit.accessories[0],
  }
  if (!parts.body || !parts.face || !parts.palette || !parts.accessory) return undefined
  return assembledOf({ body: parts.body, face: parts.face, palette: parts.palette, accessory: parts.accessory }, false)
}

/** The kit's bare accessory: the one that draws nothing, all see-through. */
export function bareAccessory(kit: Kit): Accessory | undefined {
  return kit.accessories.find(part => part.grid.every(row => [...row].every(key => key === SEE_THROUGH)))
}

function rollOnce(kit: Kit, odds: Odds, rng: Rng): Squishy {
  if (kit.legendaries.length > 0 && rng() < odds.legendary) {
    const legendary = pick(
      kit.legendaries.map(value => ({ value, weight: 1 })),
      rng,
    )
    return legendaryOf(legendary, rng() < odds.shiny)
  }
  const body = pick(weighed(kit.bodies, odds), rng)
  const face = pick(weighed(kit.faces, odds), rng)
  const palette = pick(weighed(kit.palettes, odds), rng)
  const accessory = pick(weighed(kit.accessories, odds), rng)
  return assembledOf({ body, face, palette, accessory }, rng() < odds.shiny)
}

type Part = PartBase
type Parts = { body: Part; face: Part; palette: Part; accessory: Part }
type Weighted<T> = { value: T; weight: number }

const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare']

function assembledOf({ body, face, palette, accessory }: Parts, shiny: boolean): AssembledSquishy {
  const parts = [body, face, palette, accessory]
  const rarity = RARITIES[Math.max(...parts.map(part => RARITIES.indexOf(part.rarity)))] ?? 'common'
  const name = capitalized(parts.map(part => part.syllable).join(''))
  const key = assembledKey({ body: body.id, face: face.id, palette: palette.id, accessory: accessory.id }, shiny)
  return {
    kind: 'assembled',
    body: body.id,
    face: face.id,
    palette: palette.id,
    accessory: accessory.id,
    rarity,
    shiny,
    name,
    key,
  }
}

function legendaryOf(legendary: { id: string; name: string }, shiny: boolean): LegendarySquishy {
  const key = legendaryKey(legendary.id, shiny)
  return { kind: 'legendary', legendary: legendary.id, shiny, name: legendary.name, key }
}

function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Each part's chance: its rarity's share, split evenly among the parts of
 * that rarity. A rarity no part has drops out, and the rest scale up.
 */
function weighed<T extends Part>(parts: readonly T[], odds: Odds): Weighted<T>[] {
  const shares = parts.map(value => ({
    value,
    weight: odds.rarity[value.rarity] / parts.filter(part => part.rarity === value.rarity).length,
  }))
  const total = shares.reduce((sum, share) => sum + share.weight, 0)
  return shares.map(({ value, weight }) => ({ value, weight: weight / total }))
}

function pick<T>(choices: readonly Weighted<T>[], rng: Rng): T {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
  let at = rng() * total
  for (const choice of choices) {
    at -= choice.weight
    if (at < 0) return choice.value
  }
  const last = choices[choices.length - 1]
  if (last === undefined) throw new Error('The kit has no part to pick')
  return last.value
}

/** Every squishy the kit can make, weighted by its chance of being rolled. */
function everySquishy(kit: Kit, odds: Odds): Weighted<Squishy>[] {
  const all: Weighted<Squishy>[] = []
  const legendaryChance = kit.legendaries.length > 0 ? odds.legendary : 0
  const shinyChances = [
    { shiny: false, chance: 1 - odds.shiny },
    { shiny: true, chance: odds.shiny },
  ]
  for (const { shiny, chance } of shinyChances) {
    for (const legendary of kit.legendaries) {
      all.push({ value: legendaryOf(legendary, shiny), weight: (legendaryChance / kit.legendaries.length) * chance })
    }
    for (const body of weighed(kit.bodies, odds))
      for (const face of weighed(kit.faces, odds))
        for (const palette of weighed(kit.palettes, odds))
          for (const accessory of weighed(kit.accessories, odds)) {
            const parts = { body: body.value, face: face.value, palette: palette.value, accessory: accessory.value }
            const weight = body.weight * face.weight * palette.weight * accessory.weight
            all.push({ value: assembledOf(parts, shiny), weight: (1 - legendaryChance) * weight * chance })
          }
  }
  return all
}
