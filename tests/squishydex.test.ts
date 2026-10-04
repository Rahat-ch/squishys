// The Squishydex: what's recorded in the store as squishys are met, and the
// pane mode that shows it.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { PaneOpenArgs } from 'claude-code'

import { compose } from '../src/composer'
import { KIT } from '../src/kit'
import { OPEN_PANE, PANE_ID } from '../src/pane'
import { PARTNER_KEY, PARTNER_PICTURE, stillPicture } from '../src/partner'
import { halfBlocks } from '../src/raster'
import { REMEMBERED_KEY } from '../src/rebuild'
import type { Remembered } from '../src/rebuild'
import { speciesSquishy, squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { DEX_COLUMN_GAP, DEX_PLACE_COLUMNS, DEX_PLACE_ROWS, DEX_ROW_GAP, SILHOUETTE_COLOR, SQUISHYDEX_KEY } from '../src/squishydex'
import { PANE, PARTNERED, glyphsOf, paneSized, spawnOf, stubAgentList, stubSessionStart, stubSpawns, stubStore } from './fixtures'

// Noon UTC, so the date reads the same in every time zone near it
const MET_AT = Date.UTC(2026, 9, 3, 12)
const EARLIER = Date.UTC(2026, 0, 2, 12)

const [BODY, OTHER_BODY] = KIT.bodies
const [FACE] = KIT.faces
const [PALETTE, OTHER_PALETTE] = KIT.palettes
const [ACCESSORY] = KIT.accessories
const [LEGENDARY] = KIT.legendaries
if (!BODY || !OTHER_BODY || !FACE || !PALETTE || !OTHER_PALETTE || !ACCESSORY || !LEGENDARY) {
  throw new Error('The kit needs two bodies, two palettes, a face, an accessory and a legendary')
}

// The squishys the agents were rolled, by agent id, as the store keeps them
function rolled(stored: Map<string, unknown>): Map<string, Squishy> {
  return new Map(
    (stored.get(REMEMBERED_KEY) as Remembered).map(([agentId, key]) => {
      const squishy = squishyOf(KIT, key)
      if (squishy === undefined) throw new Error(`No squishy for ${key}`)
      return [agentId, squishy]
    }),
  )
}

test('each rolled squishy is recorded, even from spawns at once: its species with the date first met, and its variant', async ($, on) => {
  mock.clock(on, { now: MET_AT })
  const stored = stubStore(on)
  stubSpawns(on)

  await Promise.all([1, 2, 3, 4].map(n => $.agent.spawn(spawnOf(`toolu_${n}`))))

  const dex = stored.get(SQUISHYDEX_KEY) as { species: Record<string, { met: number; variants: string[] }>; legendaries: Record<string, unknown> }
  expect(rolled(stored).size).toBe(4)
  for (const squishy of rolled(stored).values()) {
    if (squishy.kind === 'legendary') {
      expect(dex.legendaries[squishy.legendary]).toMatchObject({ met: MET_AT })
      continue
    }
    const species = dex.species[`${squishy.body}/${squishy.face}`]
    expect(species?.met).toBe(MET_AT)
    expect(species?.variants).toContain(`${squishy.palette}/${squishy.accessory}${squishy.shiny ? '/shiny' : ''}`)
  }
})

// After /clear the roster is rebuilt from squishys the store kept, which
// names exactly which squishys are met
test('a species met before keeps its first-met date and gains the new variant; a shiny legendary is met and met shiny', async ($, on) => {
  mock.clock(on, { now: MET_AT })
  const firstVariant = `${OTHER_PALETTE.id}/${ACCESSORY.id}`
  const stored = stubStore(on, {
    [REMEMBERED_KEY]: [
      ['agent-a', `${BODY.id}/${FACE.id}/${PALETTE.id}/${ACCESSORY.id}`],
      ['agent-b', `${OTHER_BODY.id}/${FACE.id}/${PALETTE.id}/${ACCESSORY.id}/shiny`],
      ['agent-c', `legendary/${LEGENDARY.id}/shiny`],
    ],
    [SQUISHYDEX_KEY]: { species: { [`${BODY.id}/${FACE.id}`]: { met: EARLIER, variants: [firstVariant] } }, legendaries: {} },
  })
  stubSessionStart(on)
  stubAgentList(on, ['agent-a', 'agent-b', 'agent-c'].map(id => ({ id, description: 'Find config parser', status: 'completed' as const })))

  await $.classic.SessionStart({ source: 'clear' })

  expect(stored.get(SQUISHYDEX_KEY)).toEqual({
    species: {
      [`${BODY.id}/${FACE.id}`]: { met: EARLIER, variants: [firstVariant, `${PALETTE.id}/${ACCESSORY.id}`] },
      [`${OTHER_BODY.id}/${FACE.id}`]: { met: MET_AT, variants: [`${PALETTE.id}/${ACCESSORY.id}/shiny`] },
    },
    legendaries: { [LEGENDARY.id]: { met: MET_AT, shiny: MET_AT } },
  })
})

// The user typing /squishydex at the prompt
const SQUISHYDEX_COMMAND = {
  command: 'squishydex',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

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

// The bare accessory, which the detail leaves out of a variant's name
const BARE = KIT.accessories.find(part => part.grid.every(row => /^\.*$/.test(row)))
if (BARE === undefined) throw new Error('The kit needs a bare accessory')

// Every place in the Squishydex: each species (every body with every face), then each legendary
const SPECIES_COUNT = KIT.bodies.length * KIT.faces.length
const PLACES = SPECIES_COUNT + KIT.legendaries.length

// A pane with room for every place on one page
const ROOMY = paneSized({ placement: 'dock', bodyColumns: PLACES * (DEX_PLACE_COLUMNS + DEX_COLUMN_GAP), bodyRows: 60 })

// A species' mini picture as the Squishydex draws a met one: in this palette
function miniCells(species: { body: string; face: string }, palette?: string): string {
  return halfBlocks(compose(KIT, drawn(species, palette), { state: 'working', frame: 0, size: 'mini' })).cells
}

// A species as the starter pick and the partner's slot draw it, in this palette
function drawn(species: { body: string; face: string }, palette?: string) {
  const squishy = speciesSquishy(KIT, species, palette)
  if (squishy === undefined) throw new Error(`The kit can't make ${species.body}/${species.face}`)
  return squishy
}

// The colors a Raster's packed cells use, leaving out the terminal's own
function colorsIn(cells: unknown): Set<number> {
  const bytes = atob(String(cells))
  const word = (at: number) => [0, 1, 2, 3].reduce((sum, byte) => sum + bytes.charCodeAt(at + byte) * 256 ** byte, 0)
  const colors = new Set<number>()
  for (let at = 0; at < bytes.length; at += 12) for (const color of [word(at + 4), word(at + 8)]) if (color !== 0x01000000) colors.add(color)
  return colors
}

async function openSquishydex($: Engine, size: ReturnType<typeof paneSized> = ROOMY) {
  const ui = await $.ui.mount({ ...size, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  return ui
}

test('met species show in color, in the palette first met; unmet ones as solid dark silhouettes; unmet legendaries as ???', async ($, on) => {
  stubStore(on, {
    ...PARTNERED,
    [SQUISHYDEX_KEY]: {
      species: { [`${BODY.id}/${FACE.id}`]: { met: MET_AT, variants: [`${OTHER_PALETTE.id}/${ACCESSORY.id}`, `${PALETTE.id}/${ACCESSORY.id}`] } },
      legendaries: {},
    },
  })
  const ui = await openSquishydex($)

  const met = await ui.find({ type: 'Raster', key: `squishydex-picture-${BODY.id}/${FACE.id}` })
  expect(met?.props.cells).toBe(miniCells({ body: BODY.id, face: FACE.id }, OTHER_PALETTE.id))
  expect(await ui.find({ type: 'Button', key: `squishydex-species-${BODY.id}/${FACE.id}` })).toBeDefined()

  const unmet = { body: OTHER_BODY.id, face: FACE.id }
  const silhouette = await ui.find({ type: 'Raster', key: `squishydex-picture-${OTHER_BODY.id}/${FACE.id}` })
  expect(glyphsOf(silhouette?.props.cells)).toEqual(glyphsOf(miniCells(unmet)))
  expect([...colorsIn(silhouette?.props.cells)]).toEqual([SILHOUETTE_COLOR])
  expect(await ui.find({ type: 'Button', key: `squishydex-species-${OTHER_BODY.id}/${FACE.id}` })).toBeUndefined()

  expect(await ui.find({ key: `squishydex-unmet-${LEGENDARY.id}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '???' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: `squishydex-legendary-${LEGENDARY.id}` })).toBeUndefined()
  // Every species has its place, met or not
  expect((await ui.findAll({ type: 'Raster' })).length).toBe(SPECIES_COUNT)
})

test('a met legendary shows in color, under its Name', async ($, on) => {
  stubStore(on, { ...PARTNERED, [SQUISHYDEX_KEY]: { species: {}, legendaries: { [LEGENDARY.id]: { met: MET_AT } } } })
  const ui = await openSquishydex($)

  const picture = await ui.find({ type: 'Raster', key: `squishydex-legendary-${LEGENDARY.id}` })
  const squishy = squishyOf(KIT, `legendary/${LEGENDARY.id}`)
  if (squishy === undefined) throw new Error('No legendary')
  expect(picture?.props.cells).toBe(halfBlocks(compose(KIT, squishy, { state: 'working', frame: 0, size: 'mini' })).cells)
  expect(await ui.find({ type: 'Text', text: LEGENDARY.name })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '???' })).toBeUndefined()
})

test('the counts show species met of every species in the kit, shinies met, and legendaries met of all', async ($, on) => {
  stubStore(on, {
    ...PARTNERED,
    [SQUISHYDEX_KEY]: {
      species: {
        [`${BODY.id}/${FACE.id}`]: { met: MET_AT, variants: [`${PALETTE.id}/${ACCESSORY.id}`, `${PALETTE.id}/${ACCESSORY.id}/shiny`] },
        [`${OTHER_BODY.id}/${FACE.id}`]: { met: MET_AT, variants: [`${PALETTE.id}/${ACCESSORY.id}`] },
      },
      legendaries: { [LEGENDARY.id]: { met: MET_AT, shiny: MET_AT } },
    },
  })
  const ui = await openSquishydex($)

  expect(await ui.find({ type: 'Text', text: `Species 2/${SPECIES_COUNT}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Shinies 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `Legendaries 1/${KIT.legendaries.length}` })).toBeDefined()
})

test('on a small pane the Squishydex pages its places: each page fits, and every place is on one page', async ($, on) => {
  stubStore(on, PARTNERED)
  // Two places across and two down, under the title, the counts a row each
  // (they don't fit across) and the gap under them, and over the gap and footer
  const small = paneSized({ placement: 'inline', bodyColumns: 2 * DEX_PLACE_COLUMNS + DEX_COLUMN_GAP, bodyRows: 7 + 2 * DEX_PLACE_ROWS + DEX_ROW_GAP })
  const ui = await openSquishydex($, small)

  const seen: string[] = []
  for (let page = 1; page <= PLACES; page += 1) {
    const boxes = await ui.findAll({ type: 'Box' })
    const rows = boxes.filter(box => box.key?.startsWith('squishydex-row-'))
    expect(rows.length).toBeLessThanOrEqual(2)
    for (const row of rows) expect(JSON.stringify(row).match(/"squishydex-place-\d+"/g)?.length ?? 0).toBeLessThanOrEqual(2)
    seen.push(...boxes.flatMap(box => (box.key?.startsWith('squishydex-place-') ? [box.key] : [])))
    const next = await ui.find({ type: 'Button', key: 'squishydex-next' })
    if (next === undefined) break
    expect(next.props.hotkey).toBe('n')
    await $.ui.press({ plugin: 'squishys', key: 'squishydex-next' })
  }

  expect(seen).toEqual(Array.from({ length: PLACES }, (_, index) => `squishydex-place-${index + 1}`))
  expect((await ui.find({ type: 'Button', key: 'squishydex-previous' }))?.props.hotkey).toBe('p')
})

test('picking a met species shows the variants met and the date first met, and can make it the partner', async ($, on) => {
  const species = `${OTHER_BODY.id}/${FACE.id}`
  const looks = drawn({ body: OTHER_BODY.id, face: FACE.id }, OTHER_PALETTE.id)
  const stored = stubStore(on, {
    ...PARTNERED,
    [SQUISHYDEX_KEY]: { species: { [species]: { met: MET_AT, variants: [`${OTHER_PALETTE.id}/${BARE.id}`, `${PALETTE.id}/${BARE.id}/shiny`] } }, legendaries: {} },
  })
  const ui = await openSquishydex($)
  expect((await ui.find({ type: 'Button', key: `squishydex-species-${species}` }))?.props.hotkey).toBe('1')

  await $.ui.press({ plugin: 'squishys', key: `squishydex-species-${species}` })

  expect(await ui.find({ type: 'Text', text: 'First met 2026-10-03' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Variants met: 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `${OTHER_PALETTE.id}, shiny ${PALETTE.id}` })).toBeDefined()
  expect((await ui.find({ type: 'Raster', key: 'squishydex-detail-picture' }))?.props.cells).toBe(stillPicture(looks).cells)

  expect((await ui.find({ type: 'Button', key: 'squishydex-partner' }))?.props.hotkey).toBe('m')
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-partner' })

  expect(stored.get(PARTNER_KEY)).toEqual({ body: OTHER_BODY.id, face: FACE.id, palette: OTHER_PALETTE.id })
  expect(await ui.find({ type: 'Text', text: '★ Your partner' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'squishydex-partner' })).toBeUndefined()

  // Back to the pages, then to the roster, where the new partner is pinned first
  expect((await ui.find({ type: 'Button', key: 'squishydex-back' }))?.props.hotkey).toBe('b')
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
  expect(await ui.find({ key: 'squishydex-view' })).toBeDefined()
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-roster' })
  expect((await ui.find({ type: 'Raster', key: PARTNER_PICTURE }))?.props.cells).toBe(stillPicture(looks).cells)
})

test('/squishydex before the first partner is picked returns to the starter pick, never a roster without a partner', async ($, on) => {
  stubStore(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: 'Squishys', isShown: true, isFocused: false, isPlaced: true }] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'starter-1' })).toBeDefined()

  await $.command.run(SQUISHYDEX_COMMAND)
  expect(await ui.find({ key: 'squishydex-view' })).toBeDefined()
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-roster' })

  expect(await ui.find({ key: 'starter-1' })).toBeDefined()
})
