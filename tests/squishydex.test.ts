// The Squishydex: what's recorded in the store as squishys are met, and the
// pane mode that shows it.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, PaneOpenArgs } from 'claude-code'

import { compose } from '../src/composer'
import { KIT, everySpecies } from '../src/kit'
import type { Species } from '../src/kit'
import { OPEN_PANE, PANE_ID } from '../src/pane'
import { PARTNER_KEY, PARTNER_PICTURE, stillPicture } from '../src/partner'
import { halfBlocks } from '../src/raster'
import { REMEMBERED_KEY } from '../src/rebuild'
import type { Remembered } from '../src/rebuild'
import { assembledKey, bareAccessory, legendaryKey, speciesSquishy, squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { FOOTER_COLUMNS } from '../src/slots'
import { DEX_COLUMN_GAP, DEX_GAP, DEX_PLACE_COLUMNS, DEX_PLACE_ROWS, DEX_TITLE_ROWS, SILHOUETTE_COLOR } from '../src/squishydex'
import { SQUISHYDEX_KEY, speciesKey, speciesOfKey, variantKey } from '../src/squishydex-record'
import {
  PANE,
  PARTNERED,
  SQUISHYDEX_COMMAND,
  glyphsOf,
  paneSized,
  readFrom,
  roomFor,
  spawnOf,
  stubAgentList,
  stubSessionStart,
  stubSpawns,
  stubStore,
} from './fixtures'

// Noon UTC, so the date reads the same in every time zone near it
const MET_AT = Date.UTC(2026, 9, 3, 12)
const EARLIER = Date.UTC(2026, 0, 2, 12)
const SHINY_AT = Date.UTC(2026, 4, 6, 12)

const [BODY, OTHER_BODY] = KIT.bodies
const [FACE] = KIT.faces
const [PALETTE, OTHER_PALETTE] = KIT.palettes
const [LEGENDARY] = KIT.legendaries
const [FIRST_STARTER, SECOND_STARTER] = KIT.starters
const BARE = bareAccessory(KIT)
const DRESSED = KIT.accessories.find(part => part !== BARE)
if (!BODY || !OTHER_BODY || !FACE || !PALETTE || !OTHER_PALETTE || !LEGENDARY || !BARE || !DRESSED || !FIRST_STARTER || !SECOND_STARTER) {
  throw new Error('The kit needs two bodies, two palettes, a face, a bare and another accessory, a legendary and two starters')
}

// The species the tests meet: the first body's and the second's, with the first face
const MET: Species = { body: BODY.id, face: FACE.id }
const OTHER: Species = { body: OTHER_BODY.id, face: FACE.id }

// Every place in the Squishydex: each species, then each legendary
const SPECIES_COUNT = everySpecies(KIT).length
const PLACES = SPECIES_COUNT + KIT.legendaries.length

// A pane with room for every place on one page
const ROOMY = paneSized({ placement: 'dock', bodyColumns: PLACES * (DEX_PLACE_COLUMNS + DEX_COLUMN_GAP), bodyRows: PLACES * DEX_PLACE_ROWS })

// The squishys the agents were rolled, as the store keeps them
function rolled(stored: Map<string, unknown>): Squishy[] {
  return (stored.get(REMEMBERED_KEY) as Remembered).map(([, key]) => {
    const squishy = squishyOf(KIT, key)
    if (squishy === undefined) throw new Error(`No squishy for ${key}`)
    return squishy
  })
}

// A species as the starter pick and the partner's slot draw it, in this palette
function drawn(species: Species, palette?: string) {
  const squishy = speciesSquishy(KIT, species, palette)
  if (squishy === undefined) throw new Error(`The kit can't make ${speciesKey(species)}`)
  return squishy
}

// Its mini picture, as the Squishydex draws a species met in this palette
function miniCells(squishy: Squishy): string {
  return halfBlocks(compose(KIT, squishy, { state: 'working', frame: 0, size: 'mini' })).cells
}

// The variant a species shows bare, in this palette
function bare(palette: string, shiny = false): string {
  return variantKey({ palette, accessory: BARE?.id ?? '', shiny })
}

type Dex = { species: Record<string, { met: number; variants: string[] }>; legendaries: Record<string, { met: number; shiny?: number }> }

// The colors a Raster's packed cells use, leaving out the terminal's own
function colorsIn(cells: unknown): Set<number> {
  const bytes = atob(String(cells))
  const word = (at: number) => [0, 1, 2, 3].reduce((sum, byte) => sum + bytes.charCodeAt(at + byte) * 256 ** byte, 0)
  const colors = new Set<number>()
  for (let at = 0; at < bytes.length; at += 12) for (const color of [word(at + 4), word(at + 8)]) if (color !== 0x01000000) colors.add(color)
  return colors
}

// Starts an interactive session, as Claude Code does
async function startSession($: Engine, on: On): Promise<void> {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

async function openSquishydex($: Engine, size: ReturnType<typeof paneSized> = ROOMY) {
  const ui = await $.ui.mount({ ...size, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  return ui
}

// The rows a page of the Squishydex takes as drawn: the title, the counts'
// rows and the gap under them, the places' rows, and the gap and footer rows
async function rowsDrawn(ui: Mounted<'terminal', 'Pane'>): Promise<number> {
  const keys = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '')
  const counts = keys.filter(key => /^squishydex-counts-\d+$/.test(key)).length
  const places = keys.filter(key => key.startsWith('squishydex-row-')).length
  const footer = keys.filter(key => /^squishydex-footer-\d+$/.test(key)).length
  return DEX_TITLE_ROWS + (counts > 0 ? counts + DEX_GAP : 0) + places * DEX_PLACE_ROWS + DEX_GAP + footer
}

// Recording

test('each rolled squishy is recorded, even from spawns at once: its species with the date first met, and its variant', async ($, on) => {
  mock.clock(on, { now: MET_AT })
  const stored = stubStore(on)
  stubSpawns(on)

  await Promise.all([1, 2, 3, 4].map(n => $.agent.spawn(spawnOf(`toolu_${n}`))))

  const dex = stored.get(SQUISHYDEX_KEY) as Dex
  expect(rolled(stored)).toHaveLength(4)
  for (const squishy of rolled(stored)) {
    if (squishy.kind === 'legendary') expect(dex.legendaries[squishy.legendary]?.met).toBe(MET_AT)
    else {
      expect(dex.species[speciesKey(squishy)]?.met).toBe(MET_AT)
      expect(dex.species[speciesKey(squishy)]?.variants).toContain(variantKey(squishy))
    }
  }
})

// After /clear the roster is rebuilt from squishys the store kept, which
// names exactly which squishys are met
test('a species met before keeps its first-met date and gains the new variant; a shiny legendary is met and met shiny', async ($, on) => {
  mock.clock(on, { now: MET_AT })
  const stored = stubStore(on, {
    ...PARTNERED,
    [REMEMBERED_KEY]: [
      ['agent-a', assembledKey({ ...MET, palette: PALETTE.id, accessory: DRESSED.id })],
      ['agent-b', assembledKey({ ...OTHER, palette: PALETTE.id, accessory: DRESSED.id }, true)],
      ['agent-c', legendaryKey(LEGENDARY.id, true)],
    ],
    [SQUISHYDEX_KEY]: { species: { [speciesKey(MET)]: { met: EARLIER, variants: [bare(OTHER_PALETTE.id)] } }, legendaries: {} },
  })
  stubSessionStart(on)
  stubAgentList(on, ['agent-a', 'agent-b', 'agent-c'].map(id => ({ id, description: 'Find config parser', status: 'completed' as const })))

  await $.classic.SessionStart({ source: 'clear' })

  expect(stored.get(SQUISHYDEX_KEY)).toEqual({
    species: {
      [speciesKey(MET)]: { met: EARLIER, variants: [bare(OTHER_PALETTE.id), variantKey({ palette: PALETTE.id, accessory: DRESSED.id, shiny: false })] },
      // A shiny or legendary met for the first time is NEW until its card is viewed
      [speciesKey(OTHER)]: { met: MET_AT, variants: [variantKey({ palette: PALETTE.id, accessory: DRESSED.id, shiny: true })], isNew: true },
    },
    legendaries: { [LEGENDARY.id]: { met: MET_AT, shiny: MET_AT, isNew: true } },
  })
})

test('a clock that fails loses only the record: the squishy is still assigned, its agent Working, and its tool call goes on', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  on('clock.now', () => ({ deny: 'no clock' }))
  on('agent.list', () => ({ value: [{ id: 'teammate-1', description: 'Review the docs', type: 'teammate', status: 'running' }] }))
  on('tool.call', () => ({ result: 'ok' }))
  stubSpawns(on)

  expect(await $.tool.call(readFrom('teammate-1', 'README.md'))).toMatchObject({ result: 'ok' })
  await $.agent.spawn(spawnOf('toolu_1'))

  const [teammate, spawned] = rolled(stored)
  if (teammate === undefined || spawned === undefined) throw new Error('Both agents should have squishys')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const [id, squishy] of [['teammate-1', teammate], ['agent-1', spawned]] as const) {
    expect((await ui.find({ type: 'Raster', key: `picture-${id}` }))?.props.cells).toBe(
      halfBlocks(compose(KIT, squishy, { state: 'working', frame: 0 })).cells,
    )
  }
  expect(stored.get(SQUISHYDEX_KEY)).toEqual(PARTNERED[SQUISHYDEX_KEY])
})

test('picking a starter records the partner as met, so it never shows as a silhouette', async ($, on) => {
  mock.clock(on, { now: MET_AT })
  const stored = stubStore(on)
  await startSession($, on)
  const pick = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.ui.press({ plugin: 'squishys', key: 'starter-2' })

  expect((stored.get(SQUISHYDEX_KEY) as Dex).species[speciesKey(SECOND_STARTER)]).toEqual({ met: MET_AT, variants: [bare(PALETTE.id)] })
  await pick.unmount()
  const ui = await openSquishydex($)
  expect((await ui.find({ type: 'Raster', key: `squishydex-picture-${speciesKey(SECOND_STARTER)}` }))?.props.cells).toBe(
    miniCells(drawn(SECOND_STARTER, PALETTE.id)),
  )
})

test('a partner saved before the Squishydex is recorded at session start, once', async ($, on) => {
  const clock = mock.clock(on, { now: MET_AT })
  const stored = stubStore(on, { [PARTNER_KEY]: { ...OTHER, palette: OTHER_PALETTE.id } })

  await startSession($, on)
  expect((stored.get(SQUISHYDEX_KEY) as Dex).species[speciesKey(OTHER)]).toEqual({ met: MET_AT, variants: [bare(OTHER_PALETTE.id)] })

  await clock.advance(1000)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((stored.get(SQUISHYDEX_KEY) as Dex).species[speciesKey(OTHER)]?.met).toBe(MET_AT)
})

// Opening

test('d in the roster opens the Squishydex in place of the roster, and r returns to the roster', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  mock.clock(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'squishydex' }))?.props.hotkey).toBe('d')

  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  expect(await ui.find({ key: 'squishydex-view' })).toBeDefined()
  expect(await ui.find({ key: 'slot-agent-1' })).toBeUndefined()

  expect((await ui.find({ type: 'Button', key: 'squishydex-roster' }))?.props.hotkey).toBe('r')
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-roster' })
  expect(await ui.find({ key: 'squishydex-view' })).toBeUndefined()
  expect(await ui.find({ key: 'slot-agent-1' })).toBeDefined()
})

test('/squishydex is registered to run mid-turn, and opens the pane on the Squishydex', async ($, on) => {
  stubStore(on, PARTNERED)
  const registered: { name: string; immediate?: boolean }[] = []
  on('command.register', ($, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  const opens: PaneOpenArgs[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toContainEqual(expect.objectContaining({ name: 'squishydex', immediate: true }))

  await $.command.run(SQUISHYDEX_COMMAND)

  expect(opens).toEqual([OPEN_PANE])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'squishydex-view' })).toBeDefined()
})

test('/squishydex before the first partner is picked returns to the starter pick, never a roster without a partner', async ($, on) => {
  stubStore(on)
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: 'Squishys', isShown: true, isFocused: false, isPlaced: true }] }))
  await startSession($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'starter-1' })).toBeDefined()

  await $.command.run(SQUISHYDEX_COMMAND)
  expect(await ui.find({ key: 'squishydex-view' })).toBeDefined()
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-roster' })

  expect(await ui.find({ key: 'starter-1' })).toBeDefined()
})

// The pages

test('met species show in color, in the palette first met; unmet ones as solid silhouettes; unmet legendaries as ???', async ($, on) => {
  stubStore(on, {
    ...PARTNERED,
    [SQUISHYDEX_KEY]: { species: { [speciesKey(MET)]: { met: MET_AT, variants: [bare(OTHER_PALETTE.id), bare(PALETTE.id)] } }, legendaries: {} },
  })
  const ui = await openSquishydex($)

  expect((await ui.find({ type: 'Raster', key: `squishydex-picture-${speciesKey(MET)}` }))?.props.cells).toBe(miniCells(drawn(MET, OTHER_PALETTE.id)))
  expect(await ui.find({ type: 'Button', key: `squishydex-pick-${speciesKey(MET)}` })).toBeDefined()

  const silhouette = await ui.find({ type: 'Raster', key: `squishydex-picture-${speciesKey(OTHER)}` })
  expect(glyphsOf(silhouette?.props.cells)).toEqual(glyphsOf(miniCells(drawn(OTHER))))
  expect([...colorsIn(silhouette?.props.cells)]).toEqual([SILHOUETTE_COLOR])
  expect(await ui.find({ type: 'Button', key: `squishydex-pick-${speciesKey(OTHER)}` })).toBeUndefined()

  expect(await ui.find({ key: `squishydex-unmet-${legendaryKey(LEGENDARY.id)}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '???' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `squishydex-pick-${legendaryKey(LEGENDARY.id)}` })).toBeUndefined()
  // Every species has its place, met or not, each keyed by its species
  const pictured = (await ui.findAll({ type: 'Raster' })).map(raster => speciesOfKey(String(raster.key).replace('squishydex-picture-', '')))
  expect(pictured).toEqual(everySpecies(KIT))
})

// WCAG contrast: 3:1 is the least for shapes to read against what's behind them
test('the silhouette color reads on dark and light terminals alike', () => {
  const luminance = (color: number) =>
    [16, 8, 0]
      .map(shift => ((color >> shift) & 0xff) / 255)
      .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0)
  const contrast = (a: number, b: number) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
  }
  // Black, a common dark theme, a common light theme, white
  for (const backdrop of [0x000000, 0x1e1e1e, 0xf5f5f5, 0xffffff]) expect(contrast(SILHOUETTE_COLOR, backdrop)).toBeGreaterThanOrEqual(3)
})

test('the counts show species met of every species in the kit, shinies met, and legendaries met of all', async ($, on) => {
  stubStore(on, {
    ...PARTNERED,
    [SQUISHYDEX_KEY]: {
      species: {
        [speciesKey(MET)]: { met: MET_AT, variants: [bare(PALETTE.id), bare(PALETTE.id, true)] },
        [speciesKey(OTHER)]: { met: MET_AT, variants: [bare(PALETTE.id)] },
      },
      legendaries: { [LEGENDARY.id]: { met: MET_AT, shiny: MET_AT } },
    },
  })
  const ui = await openSquishydex($)

  expect(await ui.find({ type: 'Text', text: `Species 2/${SPECIES_COUNT}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Shinies 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `Legendaries 1/${KIT.legendaries.length}` })).toBeDefined()
})

test('on a narrow pane the Squishydex pages its places: every page fits, and every place is on one page', async ($, on) => {
  stubStore(on, PARTNERED)
  // Two places across, and rows for two down besides what a page needs around them
  const narrow = paneSized({ placement: 'inline', bodyColumns: 2 * DEX_PLACE_COLUMNS + DEX_COLUMN_GAP, bodyRows: 4 * DEX_PLACE_ROWS })
  const ui = await openSquishydex($, narrow)

  const seen: string[] = []
  for (let page = 1; page <= PLACES; page += 1) {
    expect(await rowsDrawn(ui)).toBeLessThanOrEqual(narrow.props.scroll.bodyRows)
    const boxes = await ui.findAll({ type: 'Box' })
    for (const row of boxes.filter(box => box.key?.startsWith('squishydex-row-'))) {
      expect(JSON.stringify(row).match(/"squishydex-place-\d+"/g)?.length ?? 0).toBeLessThanOrEqual(2)
    }
    seen.push(...boxes.flatMap(box => (box.key?.startsWith('squishydex-place-') ? [box.key] : [])))
    const next = await ui.find({ type: 'Button', key: 'squishydex-next' })
    if (next === undefined) break
    expect(next.props.hotkey).toBe('n')
    await $.ui.press({ plugin: 'squishys', key: 'squishydex-next' })
  }

  expect(seen).toEqual(Array.from({ length: PLACES }, (_, index) => `squishydex-place-${index + 1}`))
  expect((await ui.find({ type: 'Button', key: 'squishydex-previous' }))?.props.hotkey).toBe('p')
})

test('on a pane too short for the counts, a page leaves them out and still fits a row of places', async ($, on) => {
  stubStore(on, PARTNERED)
  // The title, a row of places, the gap and a footer row
  const short = paneSized({ placement: 'inline', bodyColumns: ROOMY.props.bodyColumns, bodyRows: DEX_TITLE_ROWS + DEX_PLACE_ROWS + DEX_GAP + 1 })
  const ui = await openSquishydex($, short)

  expect(await ui.find({ type: 'Text', text: `Species 1/${SPECIES_COUNT}` })).toBeUndefined()
  expect(await ui.find({ key: 'squishydex-row-0' })).toBeDefined()
  expect(await rowsDrawn(ui)).toBeLessThanOrEqual(short.props.scroll.bodyRows)
})

test('a page fits a narrow pane at every height from one row of places to a few', async ($, on) => {
  stubStore(on, PARTNERED)
  const bodyColumns = 2 * DEX_PLACE_COLUMNS + DEX_COLUMN_GAP
  await (await openSquishydex($)).unmount()
  for (let bodyRows = DEX_TITLE_ROWS + DEX_PLACE_ROWS + DEX_GAP + 2; bodyRows <= 4 * DEX_PLACE_ROWS; bodyRows += 1) {
    const ui = await $.ui.mount({ ...paneSized({ placement: 'inline', bodyColumns, bodyRows }), surface: 'terminal' })
    expect(await rowsDrawn(ui)).toBeLessThanOrEqual(bodyRows)
    await ui.unmount()
  }
})

// The cards

test('a species card shows the variants met and the date first met, and makes it the partner in a palette it was met in', async ($, on) => {
  mock.clock(on, { now: MET_AT })
  const variants = [bare(OTHER_PALETTE.id), bare(PALETTE.id, true), variantKey({ palette: PALETTE.id, accessory: DRESSED.id, shiny: false })]
  const stored = stubStore(on, { ...PARTNERED, [SQUISHYDEX_KEY]: { species: { [speciesKey(OTHER)]: { met: MET_AT, variants } }, legendaries: {} } })
  const ui = await openSquishydex($)
  expect((await ui.find({ type: 'Button', key: `squishydex-pick-${speciesKey(OTHER)}` }))?.props.hotkey).toBe('1')

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${speciesKey(OTHER)}` })

  expect(await ui.find({ type: 'Text', text: 'First met 2026-10-03' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Variants met: 3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `${OTHER_PALETTE.id}, shiny ${PALETTE.id}, ${PALETTE.id} with ${DRESSED.id}` })).toBeDefined()
  expect((await ui.find({ type: 'Raster', key: 'squishydex-card-picture' }))?.props.cells).toBe(stillPicture(drawn(OTHER, OTHER_PALETTE.id)).cells)
  // The plain palettes it was met in, the first met first
  const palettes = await ui.find({ type: 'Select', key: 'squishydex-palette' })
  expect(palettes?.props.options).toEqual([{ value: OTHER_PALETTE.id }, { value: PALETTE.id }])
  expect(palettes?.props.value).toBe(OTHER_PALETTE.id)

  await $.ui.select({ plugin: 'squishys', key: 'squishydex-palette', value: PALETTE.id })
  expect((await ui.find({ type: 'Raster', key: 'squishydex-card-picture' }))?.props.cells).toBe(stillPicture(drawn(OTHER, PALETTE.id)).cells)
  expect((await ui.find({ type: 'Button', key: 'squishydex-partner' }))?.props.hotkey).toBe('m')
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-partner' })

  expect(stored.get(PARTNER_KEY)).toEqual({ ...OTHER, palette: PALETTE.id })
  expect(await ui.find({ type: 'Text', text: '★ Your partner' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'squishydex-partner' })).toBeUndefined()

  // Back to the pages, then to the roster, where the new partner is pinned first
  expect((await ui.find({ type: 'Button', key: 'squishydex-back' }))?.props.hotkey).toBe('b')
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
  expect(await ui.find({ key: 'squishydex-view' })).toBeDefined()
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-roster' })
  expect((await ui.find({ type: 'Raster', key: PARTNER_PICTURE }))?.props.cells).toBe(stillPicture(drawn(OTHER, PALETTE.id)).cells)
})

test('a met legendary shows in color and opens a card with the dates first met and first met shiny, and no way to make it the partner', async ($, on) => {
  const legendary = squishyOf(KIT, legendaryKey(LEGENDARY.id))
  if (legendary === undefined) throw new Error('No legendary')
  const stored = stubStore(on, { ...PARTNERED, [SQUISHYDEX_KEY]: { species: {}, legendaries: { [LEGENDARY.id]: { met: MET_AT } } } })
  const ui = await openSquishydex($)
  expect((await ui.find({ type: 'Raster', key: `squishydex-picture-${legendary.key}` }))?.props.cells).toBe(miniCells(legendary))
  expect(await ui.find({ type: 'Text', text: '???' })).toBeUndefined()

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${legendary.key}` })

  expect(await ui.find({ type: 'Text', text: 'First met 2026-10-03' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Not met shiny yet' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'squishydex-partner' })).toBeUndefined()
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })

  stored.set(SQUISHYDEX_KEY, { species: {}, legendaries: { [LEGENDARY.id]: { met: MET_AT, shiny: SHINY_AT } } })
  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${legendary.key}` })
  expect(await ui.find({ type: 'Text', text: 'First met shiny 2026-05-06' })).toBeDefined()
})

// The roster's footer

test('the roster footer fits its pane: its buttons, hotkeys drawn, a row each inline, as many to a row as fit docked', async ($, on) => {
  stubStore(on, PARTNERED)
  // Drawn as Claude Code draws a Button with a hotkey: `x: label`
  const columnsOf = (button: { props: { label?: unknown; hotkey?: unknown } }) =>
    `${button.props.hotkey === undefined ? '' : `${String(button.props.hotkey)}: `}${String(button.props.label)}`.length

  const inline = await $.ui.mount({ ...paneSized(roomFor('inline', 1, 1)), surface: 'terminal' })
  for (const key of ['settings', 'squishydex']) {
    const button = await inline.find({ type: 'Button', key })
    if (button === undefined) throw new Error(`No ${key} button`)
    expect(columnsOf(button)).toBeLessThanOrEqual(FOOTER_COLUMNS)
  }
  await inline.unmount()

  const size = roomFor('dock', 1, 1)
  const docked = await $.ui.mount({ ...paneSized(size), surface: 'terminal' })
  const rows = (await docked.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('footer-row-'))
  expect(rows.length).toBeGreaterThan(1)
  for (const row of rows) {
    const buttons = await Promise.all(
      [...JSON.stringify(row).matchAll(/"key":"(settings|squishydex|overflow)"/g)].map(match => docked.find({ type: 'Button', key: match[1] ?? '' })),
    )
    const columns = buttons.reduce((sum, button) => sum + (button === undefined ? 0 : columnsOf(button)), 0) + 2 * (buttons.length - 1)
    expect(columns).toBeLessThanOrEqual(size.bodyColumns)
  }
})
