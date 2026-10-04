// The Squishydex's record: what the store keeps of every squishy the user
// has met, and the rules for adding to it and reading it back. Pure: it
// takes plain data and never touches Claude Code; the pane's squishydex
// mode (src/squishydex.tsx) draws it.

import { everySpecies } from './kit'
import type { Kit, Species } from './kit'
import type { Squishy } from './roller'

/** Where the store keeps the Squishydex. */
export const SQUISHYDEX_KEY = 'squishydex'

/**
 * One species met: when first, and each variant seen in it, by variant key
 * (see variantKey), the first seen first. An object rather than a bare
 * date, so more can be kept per species later (a NEW mark, say).
 */
export type MetSpecies = { met: number; variants: string[] }

/** One legendary met: when first, and when first shiny, once it has been. */
export type MetLegendary = { met: number; shiny?: number }

/**
 * The Squishydex as the store keeps it: compact, since every session on the
 * machine shares the store's 4 MiB. Species by species key, legendaries by
 * id. Every variant of every species of the full kit (48 species, 160
 * variants each, plain and shiny) comes to a couple of hundred KiB.
 */
export type Squishydex = {
  species: Record<string, MetSpecies>
  legendaries: Record<string, MetLegendary>
}

/** A squishy's variant within its species. */
export type Variant = { palette: string; accessory: string; shiny: boolean }

/** A species' key in the Squishydex: `body/face`. */
export function speciesKey({ body, face }: Species): string {
  return `${body}/${face}`
}

/** The species a species key names; undefined for anything else. */
export function speciesOfKey(key: string): Species | undefined {
  const [body, face, ...rest] = key.split('/')
  return body && face && rest.length === 0 ? { body, face } : undefined
}

/** A variant's key within its species: `palette/accessory`, and `/shiny` for a shiny. */
export function variantKey({ palette, accessory, shiny }: Variant): string {
  return `${palette}/${accessory}${shiny ? '/shiny' : ''}`
}

/** The variant a variant key names; undefined for anything else. */
export function variantOfKey(key: string): Variant | undefined {
  const [palette, accessory, shiny, ...rest] = key.split('/')
  if (!palette || !accessory || rest.length > 0 || (shiny !== undefined && shiny !== 'shiny')) return undefined
  return { palette, accessory, shiny: shiny === 'shiny' }
}

/** The Squishydex a stored value holds, leaving out anything malformed. */
export function squishydexFrom(stored: unknown): Squishydex {
  const { species, legendaries } = (isRecord(stored) ? stored : {}) as Record<string, unknown>
  const dex: Squishydex = { species: {}, legendaries: {} }
  for (const [key, entry] of Object.entries(isRecord(species) ? species : {})) {
    if (!isRecord(entry) || typeof entry.met !== 'number' || !Array.isArray(entry.variants)) continue
    dex.species[key] = { met: entry.met, variants: entry.variants.filter((variant): variant is string => typeof variant === 'string') }
  }
  for (const [id, entry] of Object.entries(isRecord(legendaries) ? legendaries : {})) {
    if (!isRecord(entry) || typeof entry.met !== 'number') continue
    dex.legendaries[id] = { met: entry.met, ...(typeof entry.shiny === 'number' ? { shiny: entry.shiny } : {}) }
  }
  return dex
}

/** Whether the Squishydex already has this squishy: its species and variant, or its legendary (and shiny, for a shiny). */
export function hasMet(dex: Squishydex, squishy: Squishy): boolean {
  if (squishy.kind === 'legendary') {
    const known = dex.legendaries[squishy.legendary]
    return known !== undefined && (!squishy.shiny || known.shiny !== undefined)
  }
  return dex.species[speciesKey(squishy)]?.variants.includes(variantKey(squishy)) ?? false
}

/**
 * The Squishydex with these squishys met at `now`: a species or legendary
 * already met keeps its first-met date, and a variant already seen isn't
 * added again.
 */
export function withMet(dex: Squishydex, met: readonly Squishy[], now: number): Squishydex {
  const species = { ...dex.species }
  const legendaries = { ...dex.legendaries }
  for (const squishy of met) {
    if (squishy.kind === 'legendary') {
      const known = legendaries[squishy.legendary]
      const shiny = known?.shiny ?? (squishy.shiny ? now : undefined)
      legendaries[squishy.legendary] = { met: known?.met ?? now, ...(shiny !== undefined ? { shiny } : {}) }
      continue
    }
    const key = speciesKey(squishy)
    const known = species[key]
    const variant = variantKey(squishy)
    species[key] = {
      met: known?.met ?? now,
      variants: known === undefined ? [variant] : known.variants.includes(variant) ? known.variants : [...known.variants, variant],
    }
  }
  return { species, legendaries }
}

/**
 * The palettes a species met can be made the partner in: those of its
 * plain variants, the first met first; those of its shiny ones (drawn
 * plain) when it was only ever met shiny.
 */
export function partnerPalettes(met: MetSpecies): string[] {
  const variants = met.variants.flatMap(key => variantOfKey(key) ?? [])
  const plain = variants.filter(variant => !variant.shiny)
  return [...new Set((plain.length > 0 ? plain : variants).map(variant => variant.palette))]
}

/** The counts toward completion: species met of all the kit's, shinies met, legendaries met of all. */
export function progressOf(dex: Squishydex, kit: Kit) {
  const species = everySpecies(kit).map(speciesKey)
  const legendaries = kit.legendaries.map(legendary => legendary.id)
  const shinyVariants = species.flatMap(key => dex.species[key]?.variants.filter(variant => variantOfKey(variant)?.shiny) ?? [])
  return {
    species: species.filter(key => dex.species[key] !== undefined).length,
    speciesTotal: species.length,
    shinies: shinyVariants.length + legendaries.filter(id => dex.legendaries[id]?.shiny !== undefined).length,
    legendaries: legendaries.filter(id => dex.legendaries[id] !== undefined).length,
    legendariesTotal: legendaries.length,
  }
}

/**
 * The store calls a hook hands a module that keeps a value in the store,
 * which names its own key. The engine refuses `$.store` passed as a value,
 * so the hook passes its own calls: `{ get: key => $.store.get(key), ... }`.
 */
export type StoreCalls = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }

/** The last write to the Squishydex this process has queued. */
let recording: Promise<void> = Promise.resolve()

/**
 * The one way squishys met are written to the Squishydex: each write waits
 * for the one before, then reads the Squishydex again, merges these
 * squishys in and writes, so writes from this process (parallel spawns, a
 * spawn during a rebuild) never lose each other's entries, as
 * rememberSquishys in src/rebuild.ts does. Nothing is written when every
 * squishy is met already, and the clock is read only when something is.
 *
 * The store has no atomic update, so another session writing between this
 * read and write can still drop an entry; it comes back the next time that
 * squishy is met. A clock or store that fails loses only these sightings,
 * never the hook that recorded them. The hook passes its own store and clock
 * calls in (see StoreCalls).
 */
export function recordMet({ get, set, now }: StoreCalls & { now: () => Promise<number> }, met: readonly Squishy[]): Promise<void> {
  recording = recording.then(async () => {
    try {
      const dex = squishydexFrom(await get(SQUISHYDEX_KEY))
      if (met.every(squishy => hasMet(dex, squishy))) return
      await set(SQUISHYDEX_KEY, withMet(dex, met, await now()))
    } catch {}
  })
  return recording
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
