// The Squishydex: every distinct squishy the user has met, kept in the
// store across sessions. Each squishy rolled for an agent is recorded
// (src/agents.ts and src/rebuild.ts pass it in), and the pane's squishydex
// mode, drawn here, shows every species in the kit, met or not, with the
// counts toward completing it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Squishy } from '../types'
import { compose } from './composer'
import { KIT } from './kit'
import type { Kit, Species } from './kit'
import { OPEN_PANE, PANE_ID, openRefused } from './pane'
import { PARTNER_KEY, partnerFrom, stillPicture } from './partner'
import { halfBlocks } from './raster'
import type { Pixels } from './raster'
import { speciesSquishy } from './roller'
import { BAND_NAME_COLUMNS, BAND_PICTURE_COLUMNS, BAND_PICTURE_ROWS } from './slots'

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
 * machine shares the store's 4 MiB. Species by `body/face`, legendaries by
 * id. Every variant of every species of the full kit (48 species, 160
 * variants each, plain and shiny) comes to a couple of hundred KiB.
 */
export type Squishydex = {
  species: Record<string, MetSpecies>
  legendaries: Record<string, MetLegendary>
}

/** A species' key in the Squishydex. */
export function speciesKey({ body, face }: { body: string; face: string }): string {
  return `${body}/${face}`
}

/** A variant's key within its species: palette, accessory, and `/shiny` for a shiny. */
export function variantKey({ palette, accessory, shiny }: { palette: string; accessory: string; shiny: boolean }): string {
  return `${palette}/${accessory}${shiny ? '/shiny' : ''}`
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
      legendaries[squishy.legendary] = {
        met: known?.met ?? now,
        ...(known?.shiny !== undefined ? { shiny: known.shiny } : squishy.shiny ? { shiny: now } : {}),
      }
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

/** The last write to SQUISHYDEX_KEY this process has queued. */
let recording: Promise<void> = Promise.resolve()

/**
 * The one way the Squishydex is written to the store when squishys are met:
 * each write waits for the one before, then reads the Squishydex again,
 * merges these squishys in and writes, so parallel spawns never lose each
 * other's entries (as rememberSquishys in src/rebuild.ts). The hook passes
 * its own store calls in, as `$` stays in the hook's file. A store that
 * can't be written loses only these sightings.
 */
export function recordMet(
  store: { get: () => Promise<unknown>; set: (dex: Squishydex) => Promise<void> },
  met: readonly Squishy[],
  now: number,
): Promise<void> {
  recording = recording.then(async () => {
    try {
      await store.set(withMet(squishydexFrom(await store.get()), met, now))
    } catch {}
  })
  return recording
}

/**
 * One place in the Squishydex's pages: a species of the kit, every body
 * with every face, then a legendary. `number` is its number in the
 * Squishydex, from 1, in that order.
 */
type Entry =
  | { kind: 'species'; number: number; species: Species; key: string }
  | { kind: 'legendary'; number: number; id: string; name: string }

/** Every species the kit can make, then every legendary, in Squishydex order. */
function entriesOf(kit: Kit): Entry[] {
  const species = kit.bodies.flatMap(body => kit.faces.map(face => ({ body: body.id, face: face.id })))
  return [
    ...species.map((each, index): Entry => ({ kind: 'species', number: index + 1, species: each, key: speciesKey(each) })),
    ...kit.legendaries.map((legendary, index): Entry => ({ kind: 'legendary', number: species.length + index + 1, id: legendary.id, name: legendary.name })),
  ]
}

/** The counts toward completion: species met of all the kit's, shinies met, legendaries met of all. */
function progressOf(dex: Squishydex, kit: Kit) {
  const species = kit.bodies.flatMap(body => kit.faces.map(face => speciesKey({ body: body.id, face: face.id })))
  const legendaries = kit.legendaries.map(legendary => legendary.id)
  const shinyVariants = species.flatMap(key => dex.species[key]?.variants.filter(variant => variant.endsWith('/shiny')) ?? [])
  return {
    species: species.filter(key => dex.species[key] !== undefined).length,
    speciesTotal: species.length,
    shinies: shinyVariants.length + legendaries.filter(id => dex.legendaries[id]?.shiny !== undefined).length,
    legendaries: legendaries.filter(id => dex.legendaries[id] !== undefined).length,
    legendariesTotal: legendaries.length,
  }
}

/**
 * Each place in the Squishydex's pages: a mini picture over its Name or
 * number, as in the band. Places sit DEX_COLUMN_GAP apart across and
 * DEX_ROW_GAP down.
 */
export const DEX_PLACE_COLUMNS = BAND_PICTURE_COLUMNS
export const DEX_PLACE_ROWS = BAND_PICTURE_ROWS
const DEX_PICTURE_ROWS = BAND_PICTURE_ROWS - 1
export const DEX_COLUMN_GAP = 1
export const DEX_ROW_GAP = 0
/**
 * The rows a page takes beside its places: the title, the counts (one row,
 * or one per count where they don't fit across), the gap under them, and
 * the footer (paging and the way back) with the gap above it.
 */
const TITLE_ROWS = 1
const HEADER_GAP = 1
const FOOTER_ROWS = 1
const FOOTER_GAP = 1
/** The columns between the counts, and between the footer's buttons. */
const COUNT_GAP = 2

/** The color every unmet species is drawn in: its shape alone, solid and dark. */
export const SILHOUETTE_COLOR = 0x1a1a24

/** A picture with every pixel drawn in one dark color: the shape alone. */
function silhouette(pixels: Pixels): Pixels {
  return pixels.map(row => row.map(pixel => (pixel === null ? null : SILHOUETTE_COLOR)))
}

/** A species' or legendary's mini picture, still. */
function miniPixels(squishy: Squishy): Pixels {
  return compose(KIT, squishy, { state: 'working', frame: 0, size: 'mini' })
}

/** A species as the Squishydex draws it: in the palette it was first met in. */
function drawnSpecies(species: Species, met: MetSpecies | undefined): Squishy | undefined {
  return speciesSquishy(KIT, species, met?.variants[0]?.split('/')[0])
}

/** A Name cut to fit a place, ending in … when it's longer. */
function nameCut(name: string): string {
  return name.length > BAND_NAME_COLUMNS ? `${name.slice(0, BAND_NAME_COLUMNS - 1)}…` : name
}

/** A number in the Squishydex as it reads: #007. */
function numbered(number: number): string {
  return `#${String(number).padStart(3, '0')}`
}

/** A date as the Squishydex shows it, on the user's local calendar: 2026-10-03. */
function dayOf(ms: number): string {
  const date = new Date(ms)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('-')
}

/** A variant as the detail lists it: "mint with bow", "shiny cream". */
function variantName(key: string): string {
  const [palette = '', accessory = '', shiny] = key.split('/')
  const bare = KIT.accessories.find(part => part.id === accessory)?.grid.every(row => /^\.*$/.test(row)) ?? false
  return `${shiny === 'shiny' ? 'shiny ' : ''}${palette}${bare ? '' : ` with ${accessory}`}`
}

/** How the pages lay out in the pane: places across and down a page, and whether the counts fit on one row. */
function pageLayout(bodyColumns: number, bodyRows: number, countsColumns: number) {
  const countsAcross = countsColumns <= bodyColumns
  const headerRows = TITLE_ROWS + (countsAcross ? 1 : 3) + HEADER_GAP
  const across = Math.max(1, Math.floor((bodyColumns + DEX_COLUMN_GAP) / (DEX_PLACE_COLUMNS + DEX_COLUMN_GAP)))
  const room = bodyRows - headerRows - FOOTER_GAP - FOOTER_ROWS
  const down = Math.max(1, Math.floor((room + DEX_ROW_GAP) / (DEX_PLACE_ROWS + DEX_ROW_GAP)))
  return { across, down, countsAcross }
}

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const squishydexPage = atom({ plugin: 'squishys', key: 'squishydexPage' } as const, 0)
const squishydexSpecies = atom({ plugin: 'squishys', key: 'squishydexSpecies' } as const, null)

export function registerSquishydex(on: On): void {
  // The pane's own session.start hook is the unmatched one, so this one
  // matches every session.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    // immediate, as /squishys is: agents run while the orchestrator is mid-turn
    await $.command.register({ name: 'squishydex', description: 'Open the Squishydex: every squishy you have met', immediate: true })
    return next(e)
  })

  // Opens the pane on the Squishydex's pages. Asked for, the pane is placed
  // at any width, and the band (src/band.tsx) is drawn again to step aside.
  on('command.run', { command: 'squishydex' }, async $ => {
    await showPages($)
    const panes = await $.ui.panes()
    if (!panes.some(pane => pane.id === PANE_ID && pane.isPlaced)) {
      try {
        await $.ui.open(OPEN_PANE)
      } catch (error) {
        $.ui.toast(openRefused(error))
      }
      $.ui.invalidate('ui.render')
    }
    return {}
  })

  // The roster's Squishydex button (src/pane.tsx) opens its pages
  on('ui.press', { plugin: 'squishys', element: 'squishydex' }, async ($, e, next) => {
    await showPages($)
    return next(e)
  })

  // The squishydex mode of the pane: its pages of species, or one species'
  // detail. The pane's id is spelled out, since the engine reads a matcher
  // off this file alone.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'squishydex') return next(e)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const { bodyColumns, scroll } = e.props
    const dex = await readSquishydex($)
    const entries = entriesOf(KIT)
    const roster = <Button key="squishydex-roster" hotkey="r" plain label="Roster" onPress={() => void leave($)} />

    // One species' detail, while a met one is picked
    const picked = await read($, squishydexSpecies)
    const pickedEntry = entries.find(entry => entry.kind === 'species' && entry.key === picked)
    const pickedMet = picked === null ? undefined : dex.species[picked]
    const pickedSquishy = pickedEntry?.kind === 'species' ? drawnSpecies(pickedEntry.species, pickedMet) : undefined
    if (pickedEntry !== undefined && pickedMet !== undefined && pickedSquishy?.kind === 'assembled') {
      const partner = await readPartner($)
      const isPartner = partner?.kind === 'assembled' && speciesKey(partner) === speciesKey(pickedSquishy)
      return (
        <Box key="squishydex-detail" flexDirection="column" rowGap={1}>
          <Text bold>{`${numbered(pickedEntry.number)} ${pickedSquishy.name}`}</Text>
          <Raster key="squishydex-detail-picture" {...stillPicture(pickedSquishy)} />
          <Text>{`First met ${dayOf(pickedMet.met)}`}</Text>
          <Box key="squishydex-variants" flexDirection="column">
            <Text bold>{`Variants met: ${pickedMet.variants.length}`}</Text>
            <Text wrap="wrap">{pickedMet.variants.map(variantName).join(', ')}</Text>
          </Box>
          <Box key="squishydex-detail-footer" flexDirection="row" columnGap={COUNT_GAP}>
            {isPartner ? (
              <Text color="cyan">★ Your partner</Text>
            ) : (
              <Button
                key="squishydex-partner"
                hotkey="m"
                plain
                label="Make partner"
                onPress={() => void makePartner($, pickedSquishy.body, pickedSquishy.face, pickedSquishy.palette)}
              />
            )}
            <Button key="squishydex-back" hotkey="b" plain label="Back" onPress={() => void update($, squishydexSpecies, () => null)} />
            {roster}
          </Box>
        </Box>
      )
    }

    // The pages: as many places on each as fit the pane
    const progress = progressOf(dex, KIT)
    const counts = [
      `Species ${progress.species}/${progress.speciesTotal}`,
      `Shinies ${progress.shinies}`,
      `Legendaries ${progress.legendaries}/${progress.legendariesTotal}`,
    ]
    const layout = pageLayout(bodyColumns, scroll.bodyRows, counts.join(' '.repeat(COUNT_GAP)).length)
    const perPage = layout.across * layout.down
    const pages = Math.max(1, Math.ceil(entries.length / perPage))
    const page = Math.min(Math.max(0, await read($, squishydexPage)), pages - 1)
    const shown = entries.slice(page * perPage, (page + 1) * perPage)
    const rows = Array.from({ length: Math.ceil(shown.length / layout.across) }, (_, row) => shown.slice(row * layout.across, (row + 1) * layout.across))
    // Digits pick the met species on the page, in page order
    let digit = 0

    const placeOf = (entry: Entry) => {
      if (entry.kind === 'legendary') {
        const met = dex.legendaries[entry.id] !== undefined
        const legendary: Squishy = { kind: 'legendary', legendary: entry.id, shiny: false, name: entry.name, key: `legendary/${entry.id}` }
        return (
          <Box key={`squishydex-place-${entry.number}`} flexDirection="column" alignItems="center" width={DEX_PLACE_COLUMNS}>
            {met ? (
              <Raster key={`squishydex-legendary-${entry.id}`} {...halfBlocks(miniPixels(legendary))} />
            ) : (
              <Box key={`squishydex-unmet-${entry.id}`} height={DEX_PICTURE_ROWS} alignItems="center" justifyContent="center">
                <Text dimColor>???</Text>
              </Box>
            )}
            <Text dimColor={!met} wrap="truncate-end">
              {met ? nameCut(entry.name) : numbered(entry.number)}
            </Text>
          </Box>
        )
      }
      const met = dex.species[entry.key]
      const squishy = drawnSpecies(entry.species, met)
      if (squishy === undefined) return null
      const pixels = miniPixels(squishy)
      const hotkey = met !== undefined && (digit += 1) <= 9 ? { hotkey: String(digit) } : {}
      return (
        <Box key={`squishydex-place-${entry.number}`} flexDirection="column" alignItems="center" width={DEX_PLACE_COLUMNS}>
          <Raster key={`squishydex-picture-${entry.key}`} {...halfBlocks(met !== undefined ? pixels : silhouette(pixels))} />
          {met !== undefined ? (
            <Button
              key={`squishydex-species-${entry.key}`}
              {...hotkey}
              plain
              label={nameCut(squishy.name)}
              onPress={() => void update($, squishydexSpecies, () => entry.key)}
            />
          ) : (
            <Text dimColor>{numbered(entry.number)}</Text>
          )}
        </Box>
      )
    }

    return (
      <Box key="squishydex-view" flexDirection="column">
        <Text bold>Squishydex</Text>
        <Box key="squishydex-counts" flexDirection={layout.countsAcross ? 'row' : 'column'} columnGap={COUNT_GAP}>
          {counts.map(count => (
            <Text key={count}>{count}</Text>
          ))}
        </Box>
        <Box key="squishydex-pages" flexDirection="column" rowGap={DEX_ROW_GAP} marginTop={HEADER_GAP} marginBottom={FOOTER_GAP}>
          {rows.map((row, index) => (
            <Box key={`squishydex-row-${index}`} flexDirection="row" columnGap={DEX_COLUMN_GAP}>
              {row.map(placeOf)}
            </Box>
          ))}
        </Box>
        <Box key="squishydex-footer" flexDirection="row" columnGap={COUNT_GAP}>
          {page > 0 ? <Button key="squishydex-previous" hotkey="p" plain label="Prev" onPress={() => void turnTo($, page - 1)} /> : null}
          {page < pages - 1 ? <Button key="squishydex-next" hotkey="n" plain label="Next" onPress={() => void turnTo($, page + 1)} /> : null}
          {pages > 1 ? <Text dimColor>{`${page + 1}/${pages}`}</Text> : null}
          {roster}
        </Box>
      </Box>
    )
  })
}

/** The Squishydex from the store; a store that can't be read shows nothing met. */
async function readSquishydex($: EngineInterface): Promise<Squishydex> {
  try {
    return squishydexFrom(await $.store.get(SQUISHYDEX_KEY))
  } catch {
    return squishydexFrom(undefined)
  }
}

/** The partner from the store; a store that can't be read leaves none. */
async function readPartner($: EngineInterface): Promise<Squishy | undefined> {
  try {
    return partnerFrom(await $.store.get(PARTNER_KEY))
  } catch {
    return undefined
  }
}

/** Shows the Squishydex's pages, at the page last shown. */
async function showPages($: EngineInterface): Promise<void> {
  await update($, squishydexSpecies, () => null)
  await update($, mode, () => 'squishydex')
}

async function turnTo($: EngineInterface, page: number): Promise<void> {
  await update($, squishydexPage, () => page)
}

/**
 * Back to the roster, or to the starter pick while no partner is saved
 * (/squishydex can come before the first pick).
 */
async function leave($: EngineInterface): Promise<void> {
  const partner = await readPartner($)
  await update($, mode, () => (partner === undefined ? 'starter' : 'roster'))
}

/**
 * Saves a species met as the partner, in the palette the Squishydex shows
 * it in, as the starter pick saves one (src/partner.tsx). A store that
 * can't be written leaves the partner as it was.
 */
async function makePartner($: EngineInterface, body: string, face: string, palette: string): Promise<void> {
  try {
    await $.store.set(PARTNER_KEY, { body, face, palette })
  } catch {}
  // The store isn't $.state, so nothing redraws the pane on its own.
  $.ui.invalidate('ui.render')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
