// The pane's squishydex mode: every species in the kit, met or not, then
// the legendaries, in pages that fit the pane, with the counts toward
// completing the Squishydex; and a card for each species or legendary met.
// What's met is the record in src/squishydex-record.ts, which the agent
// tracker, the rebuild after /clear and the partner add to.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Squishy } from '../types'
import { stillMiniPixels } from './composer'
import { KIT, everySpecies } from './kit'
import type { Kit, Species } from './kit'
import { OPEN_PANE_ASKED, PANE_ID, notePaneOpened, openRefused } from './pane'
import { PARTNER_KEY, partnerFrom, stillPicture } from './partner'
import { halfBlocks } from './raster'
import type { Pixels } from './raster'
import { bareAccessory, legendaryKey, speciesSquishy, squishyOf } from './roller'
import type { AssembledSquishy, LegendarySquishy } from './roller'
import { SHARE_HOTKEY, SHARE_LINK_LABEL, speciesShareKey, unopenedShare } from './share'
import { BAND_PICTURE_COLUMNS, BAND_PICTURE_ROWS, PICTURE_ROWS, buttonColumns, linedUp, nameCut } from './slots'
import { SQUISHYDEX_KEY, isNewIn, partnerPalettes, progressOf, recordMet, recordViewed, speciesKey, squishydexFrom, variantOfKey } from './squishydex-record'
import type { DexPlace, MetLegendary, MetSpecies, Squishydex } from './squishydex-record'

/**
 * One place in the Squishydex's pages: a species of the kit, then a
 * legendary, numbered from 1 in that order. A species' place is keyed by
 * its species key, a legendary's by its squishy key.
 */
type Place =
  | { kind: 'species'; number: number; key: string; species: Species }
  | { kind: 'legendary'; number: number; key: string; legendary: LegendarySquishy }

/** A place as the record names it, for its NEW mark. */
function dexPlaceOf(place: Place): DexPlace {
  return place.kind === 'species' ? { species: place.key } : { legendary: place.legendary.legendary }
}

/** Every place in the Squishydex, in order. */
function placesOf(kit: Kit): Place[] {
  const species = everySpecies(kit)
  const legendaries = kit.legendaries.flatMap(({ id }) => {
    const squishy = squishyOf(kit, legendaryKey(id))
    return squishy?.kind === 'legendary' ? [squishy] : []
  })
  return [
    ...species.map((each, index): Place => ({ kind: 'species', number: index + 1, key: speciesKey(each), species: each })),
    ...legendaries.map((legendary, index): Place => ({ kind: 'legendary', number: species.length + index + 1, key: legendary.key, legendary })),
  ]
}

/**
 * Each place on a page: a mini picture over its Name or number, as in the
 * band, DEX_COLUMN_GAP apart across and touching down.
 */
export const DEX_PLACE_COLUMNS = BAND_PICTURE_COLUMNS
export const DEX_PLACE_ROWS = BAND_PICTURE_ROWS
const DEX_PICTURE_ROWS = BAND_PICTURE_ROWS - 1
export const DEX_COLUMN_GAP = 1
/**
 * The rows a page takes besides its places: the title, the counts (as many
 * rows as they need at the pane's width) and the gap under them, and the
 * gap and the footer (paging and the way back, as many rows as its buttons
 * need) under the places. A pane too short for a row of places with the
 * counts shown leaves them out.
 */
export const DEX_TITLE_ROWS = 1
export const DEX_GAP = 1
/** The columns between the counts, and between buttons in a row. */
export const DEX_ITEM_GAP = 2

/**
 * The color every unmet species is drawn in: its shape alone, solid. A
 * mid-dark slate, which stands out on dark and light terminals alike.
 */
export const SILHOUETTE_COLOR = 0x6a7385

/** A picture with every pixel drawn in SILHOUETTE_COLOR: the shape alone. */
function silhouette(pixels: Pixels): Pixels {
  return pixels.map(row => row.map(pixel => (pixel === null ? null : SILHOUETTE_COLOR)))
}

/** A squishy's mini picture, at rest. */
function miniPixels(squishy: Squishy): Pixels {
  return stillMiniPixels(KIT, squishy)
}

/** A species as the Squishydex draws it: in `palette`, else the palette it was first met in. */
function drawnSpecies(species: Species, met: MetSpecies | undefined, palette?: string): AssembledSquishy | undefined {
  const first = met === undefined ? undefined : partnerPalettes(met)[0]
  return speciesSquishy(KIT, species, palette ?? first)
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

/** A variant as a species' card lists it: "mint with bow", "shiny cream". */
function variantName(key: string): string {
  const variant = variantOfKey(key)
  if (variant === undefined) return key
  const bare = variant.accessory === bareAccessory(KIT)?.id
  return `${variant.shiny ? 'shiny ' : ''}${variant.palette}${bare ? '' : ` with ${variant.accessory}`}`
}

/** One item of a row that wraps: what to draw and the columns it takes. */
type RowItem = { columns: number; drawn: JSX.Element }

/** The pages' layout: places across and down a page, and whether the counts show. */
function pageLayout(bodyColumns: number, bodyRows: number, countColumns: readonly number[], footerColumns: readonly number[]) {
  const across = Math.max(1, Math.floor((bodyColumns + DEX_COLUMN_GAP) / (DEX_PLACE_COLUMNS + DEX_COLUMN_GAP)))
  const footer = DEX_GAP + linedUp(footerColumns, bodyColumns, DEX_ITEM_GAP).length
  const counted = bodyRows - DEX_TITLE_ROWS - linedUp(countColumns, bodyColumns, DEX_ITEM_GAP).length - DEX_GAP - footer
  const showsCounts = counted >= DEX_PLACE_ROWS
  const room = showsCounts ? counted : bodyRows - DEX_TITLE_ROWS - footer
  return { across, down: Math.max(1, Math.floor(room / DEX_PLACE_ROWS)), showsCounts }
}

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const squishydexPage = atom({ plugin: 'squishys', key: 'squishydexPage' } as const, 0)
const squishydexPicked = atom({ plugin: 'squishys', key: 'squishydexPicked' } as const, null)
const squishydexPalette = atom({ plugin: 'squishys', key: 'squishydexPalette' } as const, null)

export function registerSquishydex(on: On): void {
  // /squishydex (registered with /squishys, in src/pane.tsx) opens the pane
  // on the Squishydex's pages. Asked for, the pane is placed at any width,
  // and asks for the keyboard, opened again while it lacks it; the band
  // (src/band.tsx) is drawn again to step aside.
  on('command.run', { command: 'squishydex' }, async $ => {
    await showPages($)
    const panes = await $.ui.panes()
    if (!panes.some(pane => pane.id === PANE_ID && pane.isPlaced && pane.isFocused)) {
      try {
        await $.ui.open(OPEN_PANE_ASKED)
        notePaneOpened(OPEN_PANE_ASKED)
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

  // The squishydex mode of the pane: its pages, or a card. The pane's id is
  // spelled out, since the engine reads a matcher off this file alone.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'squishydex') return next(e)
    const { Box, Button, Link, Raster, Select, Text } = $.ui.resolve(e)
    const { bodyColumns, scroll } = e.props
    const bodyRows = scroll.bodyRows
    const dex = await readSquishydex($)
    const places = placesOf(KIT)

    const button = (key: string, hotkey: string, label: string, onPress: () => void): RowItem => ({
      columns: buttonColumns(label, hotkey),
      drawn: <Button key={key} hotkey={hotkey} plain label={label} onPress={onPress} />,
    })
    const text = (key: string, value: string, dim = false): RowItem => ({
      columns: value.length,
      drawn: (
        <Box key={key}>
          <Text dimColor={dim}>{value}</Text>
        </Box>
      ),
    })
    // Items as many to a row as fit the pane, so a narrow pane takes more rows rather than overflowing
    const rowsOf = (key: string, items: readonly RowItem[]) => (
      <Box key={key} flexDirection="column">
        {linedUp(
          items.map(item => item.columns),
          bodyColumns,
          DEX_ITEM_GAP,
        ).map((line, index) => (
          <Box key={`${key}-${index}`} flexDirection="row" columnGap={DEX_ITEM_GAP}>
            {line.map(at => items[at]?.drawn)}
          </Box>
        ))}
      </Box>
    )
    const roster = button('squishydex-roster', 'r', 'Roster', () => void leave($))
    const back = button('squishydex-back', 'b', 'Back', () => void update($, squishydexPicked, () => null))

    // A card, while a met species or legendary is picked
    const pickedKey = await read($, squishydexPicked)
    const picked = places.find(place => place.key === pickedKey)
    const metSpecies = picked?.kind === 'species' ? dex.species[picked.key] : undefined
    const metLegendary = picked?.kind === 'legendary' ? dex.legendaries[picked.legendary.legendary] : undefined
    // The full picture where the pane has the rows, else the mini one
    const pictured = (squishy: Squishy) => (bodyRows >= PICTURE_ROWS + 10 ? stillPicture(squishy) : halfBlocks(miniPixels(squishy)))
    if (picked?.kind === 'species' && metSpecies !== undefined) {
      const palettes = partnerPalettes(metSpecies)
      const chosen = await read($, squishydexPalette)
      const palette = chosen !== null && palettes.includes(chosen) ? chosen : palettes[0]
      const squishy = drawnSpecies(picked.species, metSpecies, palette)
      if (squishy !== undefined) return speciesCard(picked, metSpecies, squishy, palettes)
    }
    if (picked?.kind === 'legendary' && metLegendary !== undefined) return legendaryCard(picked, picked.legendary, metLegendary)

    // The pages: as many places on each as fit the pane
    const progress = progressOf(dex, KIT)
    const counts = [
      text('squishydex-count-species', `Species ${progress.species}/${progress.speciesTotal}`),
      text('squishydex-count-shinies', `Shinies ${progress.shinies}`),
      text('squishydex-count-legendaries', `Legendaries ${progress.legendaries}/${progress.legendariesTotal}`),
    ]
    // The footer is budgeted with every item there, the page count at its widest
    const widestPages = `${places.length}/${places.length}`
    const footerBudget = [buttonColumns('Prev', 'p'), buttonColumns('Next', 'n'), widestPages.length, roster.columns]
    const layout = pageLayout(
      bodyColumns,
      bodyRows,
      counts.map(count => count.columns),
      footerBudget,
    )
    const perPage = layout.across * layout.down
    const pages = Math.max(1, Math.ceil(places.length / perPage))
    const page = Math.min(Math.max(0, await read($, squishydexPage)), pages - 1)
    const shown = places.slice(page * perPage, (page + 1) * perPage)
    const rows = Array.from({ length: Math.ceil(shown.length / layout.across) }, (_, row) => shown.slice(row * layout.across, (row + 1) * layout.across))
    // Digits pick the places met on the page, in page order
    let digit = 0
    const pick = (place: Place, name: string) => (
      <Button
        key={`squishydex-pick-${place.key}`}
        {...((digit += 1) <= 9 ? { hotkey: String(digit) } : {})}
        plain
        label={nameCut(name)}
        onPress={() => void openCard($, place)}
      />
    )
    // A place met shiny or legendary since its card was last viewed says so, over its picture's corner
    const newMark = (place: Place) =>
      isNewIn(dex, dexPlaceOf(place)) ? (
        <Box key={`squishydex-new-${place.key}`} position="absolute" top={0} left={0}>
          <Text bold color="yellow">
            NEW
          </Text>
        </Box>
      ) : null
    const placeOf = (place: Place) => {
      if (place.kind === 'legendary') {
        const met = dex.legendaries[place.legendary.legendary] !== undefined
        return (
          <Box key={`squishydex-place-${place.number}`} flexDirection="column" alignItems="center" width={DEX_PLACE_COLUMNS}>
            {met ? (
              <Raster key={`squishydex-picture-${place.key}`} {...halfBlocks(miniPixels(place.legendary))} />
            ) : (
              <Box key={`squishydex-unmet-${place.key}`} height={DEX_PICTURE_ROWS} alignItems="center" justifyContent="center">
                <Text dimColor>???</Text>
              </Box>
            )}
            {met ? pick(place, place.legendary.name) : <Text dimColor>{numbered(place.number)}</Text>}
            {newMark(place)}
          </Box>
        )
      }
      const met = dex.species[place.key]
      const squishy = drawnSpecies(place.species, met)
      if (squishy === undefined) return null
      const pixels = miniPixels(squishy)
      return (
        <Box key={`squishydex-place-${place.number}`} flexDirection="column" alignItems="center" width={DEX_PLACE_COLUMNS}>
          <Raster key={`squishydex-picture-${place.key}`} {...halfBlocks(met !== undefined ? pixels : silhouette(pixels))} />
          {met !== undefined ? pick(place, squishy.name) : <Text dimColor>{numbered(place.number)}</Text>}
          {newMark(place)}
        </Box>
      )
    }
    const footer = [
      ...(page > 0 ? [button('squishydex-previous', 'p', 'Prev', () => void turnTo($, page - 1))] : []),
      ...(page < pages - 1 ? [button('squishydex-next', 'n', 'Next', () => void turnTo($, page + 1))] : []),
      ...(pages > 1 ? [text('squishydex-page', `${page + 1}/${pages}`, true)] : []),
      roster,
    ]
    return (
      <Box key="squishydex-view" flexDirection="column">
        <Text bold>Squishydex</Text>
        {layout.showsCounts ? rowsOf('squishydex-counts', counts) : null}
        <Box key="squishydex-pages" flexDirection="column" marginTop={layout.showsCounts ? DEX_GAP : 0} marginBottom={DEX_GAP}>
          {rows.map((row, index) => (
            <Box key={`squishydex-row-${index}`} flexDirection="row" columnGap={DEX_COLUMN_GAP}>
              {row.map(placeOf)}
            </Box>
          ))}
        </Box>
        {rowsOf('squishydex-footer', footer)}
      </Box>
    )

    // A species' card: the variants met, the date first met, making it the
    // partner in a palette it was met in, and sharing it
    async function speciesCard(place: Place, met: MetSpecies, squishy: AssembledSquishy, palettes: readonly string[]) {
      const partner = await readPartner($)
      // The compose page of a Share the browser didn't open
      const shareLink = unopenedShare(speciesShareKey(squishy.key))
      const sameSpecies = partner?.kind === 'assembled' && speciesKey(partner) === place.key
      const isPartner = sameSpecies && partner.palette === squishy.palette
      const actions = [
        ...(isPartner ? [] : [button('squishydex-partner', 'm', 'Make partner', () => void makePartner($, squishy))]),
        // Answered by the ui.press hook in share.tsx
        button(speciesShareKey(squishy.key), SHARE_HOTKEY, 'Share', () => {}),
        back,
        roster,
      ]
      return (
        <Box key="squishydex-card" flexDirection="column" rowGap={1}>
          <Text bold>{`${numbered(place.number)} ${squishy.name}`}</Text>
          <Raster key="squishydex-card-picture" {...pictured(squishy)} />
          {sameSpecies ? <Text color="cyan">★ Your partner</Text> : null}
          <Text>{`First met ${dayOf(met.met)}`}</Text>
          <Box key="squishydex-variants" flexDirection="column">
            <Text bold>{`Variants met: ${met.variants.length}`}</Text>
            <Text wrap="wrap">{met.variants.map(variantName).join(', ')}</Text>
          </Box>
          {palettes.length > 1 ? (
            <Select
              key="squishydex-palette"
              label="Partner palette"
              options={palettes.map(value => ({ value }))}
              value={squishy.palette}
              onSelect={value => void update($, squishydexPalette, () => value)}
            />
          ) : null}
          {rowsOf('squishydex-card-footer', actions)}
          {shareLink !== undefined ? <Link key="squishydex-share-link" href={shareLink} label={SHARE_LINK_LABEL} /> : null}
        </Box>
      )
    }

    // A legendary's card: the date first met, and first met shiny. A
    // legendary is no species, so it can't be the partner.
    function legendaryCard(place: Place, legendary: LegendarySquishy, met: MetLegendary) {
      return (
        <Box key="squishydex-card" flexDirection="column" rowGap={1}>
          <Text bold>{`${numbered(place.number)} ${legendary.name}`}</Text>
          <Raster key="squishydex-card-picture" {...pictured(legendary)} />
          <Text>{`First met ${dayOf(met.met)}`}</Text>
          <Text>{met.shiny !== undefined ? `First met shiny ${dayOf(met.shiny)}` : 'Not met shiny yet'}</Text>
          {rowsOf('squishydex-card-footer', [back, roster])}
        </Box>
      )
    }
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
  await update($, squishydexPicked, () => null)
  await update($, mode, () => 'squishydex')
}

/**
 * Shows a place's card, its palette pick back on the first met, and marks
 * it viewed, so it's no longer NEW.
 */
async function openCard($: EngineInterface, place: Place): Promise<void> {
  await recordViewed({ get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) }, dexPlaceOf(place))
  await update($, squishydexPalette, () => null)
  await update($, squishydexPicked, () => place.key)
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
 * Saves a species met as the partner, in the palette picked on its card,
 * as the starter pick saves one (src/partner.tsx), and records it as met
 * in that palette. A store that can't be written leaves the partner as it was.
 */
async function makePartner($: EngineInterface, squishy: AssembledSquishy): Promise<void> {
  const { body, face, palette } = squishy
  try {
    await $.store.set(PARTNER_KEY, { body, face, palette })
  } catch {}
  await recordMet({ get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), now: () => $.clock.now() }, [squishy])
  // The store isn't $.state, so nothing redraws the pane on its own.
  $.ui.invalidate('ui.render')
}
