// Shiny and legendary moments: the pure rules (which rolls are one, what
// their toast says, how long they sparkle), and the mod announcing one.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AudioClip, On } from 'claude-code'

import { KIT } from '../src/kit'
import { SPARKLE_MS, isSparkling, momentToast, sparkleUntil } from '../src/moments'
import { FRAME_MS } from '../src/pane'
import { DEX_COLUMN_GAP, DEX_PLACE_COLUMNS, DEX_PLACE_ROWS } from '../src/squishydex'
import { SQUISHYDEX_KEY, speciesKey, variantKey } from '../src/squishydex-record'
import { REMEMBERED_KEY, rememberedFrom } from '../src/rebuild'
import { assembledKey, bareAccessory, forcedOdds, legendaryKey, roll, squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { seeded } from '../src/seeded'
import { PANE, PARTNERED, finishOf, paneSized, readFrom, spawnOf, stubAgentList, stubBlits, stubSessionStart, stubSpawns, stubStore, stubTurns } from './fixtures'
import { cellsOf } from './pictures'

const MOCHIBI: Squishy = {
  kind: 'assembled',
  body: 'dumpling',
  face: 'smile',
  palette: 'cream',
  accessory: 'none',
  rarity: 'common',
  shiny: false,
  name: 'Mochibi',
  key: 'dumpling/smile/cream/none',
}
const GREAT: Squishy = { kind: 'legendary', legendary: 'xiaolongbao', shiny: false, name: 'The Great Xiaolongbao', key: 'legendary/xiaolongbao' }

const [LEGENDARY] = KIT.legendaries
if (LEGENDARY === undefined) throw new Error('The kit needs a legendary')

// Reads back every toast the mod shows
function stubToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

// The squishy an agent was given, as the store keeps it
function squishyOfAgent(stored: Map<string, unknown>, agentId: string): Squishy {
  const key = new Map(rememberedFrom(stored.get(REMEMBERED_KEY))).get(agentId)
  const squishy = key === undefined ? undefined : squishyOf(KIT, key)
  if (squishy === undefined) throw new Error(`${agentId} has no squishy`)
  return squishy
}

// Pure: forced rolls

test('a forced roll is always what it names: plain, shiny, legendary or a shiny legendary', () => {
  const rng = seeded(18)
  const rolls = (value: string) => Array.from({ length: 200 }, () => roll(KIT, { live: [], rng, odds: forcedOdds(value) }))

  expect(rolls('plain').every(squishy => squishy.kind === 'assembled' && !squishy.shiny)).toBe(true)
  expect(rolls('shiny').every(squishy => squishy.kind === 'assembled' && squishy.shiny)).toBe(true)
  expect(rolls('legendary').every(squishy => squishy.kind === 'legendary' && !squishy.shiny)).toBe(true)
  expect(rolls('shiny-legendary').every(squishy => squishy.kind === 'legendary' && squishy.shiny)).toBe(true)
})

test('an unset or unknown forced roll leaves the standard odds', () => {
  expect(forcedOdds(undefined)).toBeUndefined()
  expect(forcedOdds('')).toBeUndefined()
  expect(forcedOdds('golden')).toBeUndefined()
})

// Pure: the toast

test('a shiny, a legendary and a shiny legendary each get a toast naming them; a plain squishy none', () => {
  expect(momentToast({ ...MOCHIBI, shiny: true })).toBe('✨ A shiny Mochibi appeared!')
  expect(momentToast(GREAT)).toBe('👑 A legendary The Great Xiaolongbao appeared!')
  expect(momentToast({ ...GREAT, shiny: true })).toBe('🌟 Whoa! A shiny legendary The Great Xiaolongbao appeared!')
  expect(momentToast(MOCHIBI)).toBeUndefined()
})

// Pure: how long a slot sparkles

test('a shiny or legendary sparkles for SPARKLE_MS after it appears; a plain squishy never', () => {
  const at = 1_000
  const until = sparkleUntil({ ...MOCHIBI, shiny: true }, at)

  expect(isSparkling(until, at)).toBe(true)
  expect(isSparkling(until, at + SPARKLE_MS - 1)).toBe(true)
  expect(isSparkling(until, at + SPARKLE_MS)).toBe(false)
  expect(isSparkling(sparkleUntil(GREAT, at), at)).toBe(true)
  expect(sparkleUntil(MOCHIBI, at)).toBeUndefined()
  expect(isSparkling(undefined, at)).toBe(false)
})

// The mod: the toast

test('a shiny roll shows a toast naming it', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'shiny')
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  const squishy = squishyOfAgent(stored, 'agent-1')
  expect(squishy).toMatchObject({ kind: 'assembled', shiny: true })
  expect(toasts).toEqual([`✨ A shiny ${squishy.name} appeared!`])
})

test('a legendary roll shows a toast naming it', async ($, on) => {
  stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'legendary')
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(toasts).toEqual([`👑 A legendary ${LEGENDARY.name} appeared!`])
})

test('a shiny legendary roll gets a line of its own', async ($, on) => {
  stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'shiny-legendary')
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(toasts).toEqual([`🌟 Whoa! A shiny legendary ${LEGENDARY.name} appeared!`])
})

test('a plain roll shows no toast', async ($, on) => {
  stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'plain')
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(toasts).toEqual([])
})

test('an agent first seen through its tool call is announced too, once the call has gone on', async ($, on) => {
  stubStore(on, PARTNERED)
  mock.clock(on)
  mock.env(on, { SQUISHYS_FORCE_ROLL: 'legendary' })
  on('agent.list', () => ({ value: [{ id: 'teammate-1', description: 'Review the docs', type: 'teammate', status: 'running' }] }))
  const order: string[] = []
  on('tool.call', () => {
    order.push('call')
    return { result: 'ok' }
  })
  on('ui.toast', ($, e) => {
    order.push(e.text)
    return { value: undefined }
  })

  expect(await $.tool.call(readFrom('teammate-1', 'README.md'))).toMatchObject({ result: 'ok' })

  expect(order).toEqual(['call', `👑 A legendary ${LEGENDARY.name} appeared!`])
})

// The mod: the chime, on macOS only

// Stands in for the platform: macOS has afplay, which $.audio plays clips
// with; Linux and Windows have no player, so $.audio plays nothing there
function stubPlatform(on: On, platform: 'macos' | 'linux'): void {
  on('fs.exists', ($, e) => ({ value: platform === 'macos' && e.path === '/usr/bin/afplay' }))
}

// Reads back every clip the mod plays
function stubAudio(on: On): AudioClip[] {
  const played: AudioClip[] = []
  on('audio.play', ($, e) => {
    played.push(e.clip)
    return { value: undefined }
  })
  return played
}

async function openSettings($: Engine) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  return ui
}

test('on macOS, settings offer the chime, off by default, and turning it on saves it', async ($, on) => {
  const stored = stubStore(on)
  stubPlatform(on, 'macos')
  const ui = await openSettings($)

  expect((await ui.find({ type: 'Select', key: 'chime' }))?.props.value).toBe('false')

  await $.ui.select({ plugin: 'squishys', key: 'chime', value: 'true' })
  expect(stored.get('settings')).toEqual({ slotCap: 9, chime: true })
  expect((await ui.find({ type: 'Select', key: 'chime' }))?.props.value).toBe('true')

  await $.ui.select({ plugin: 'squishys', key: 'chime', value: 'false' })
  expect(stored.get('settings')).toEqual({ slotCap: 9 })
})

test('where $.audio makes no sound, settings hide the chime', async ($, on) => {
  stubStore(on)
  stubPlatform(on, 'linux')
  const ui = await openSettings($)

  expect(await ui.find({ type: 'Select', key: 'model' })).toBeDefined()
  expect(await ui.find({ type: 'Select', key: 'chime' })).toBeUndefined()
})

test('with the chime on, a shiny or legendary roll plays the chime, and a plain one plays nothing', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 9, chime: true } })
  mock.clock(on)
  // The forced roll changes from spawn to spawn, so this test answers both itself
  const forced = { roll: 'plain' }
  on('env.get', () => ({ value: forced.roll }))
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `agent-${++spawned}` }))
  const played = stubAudio(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  expect(played).toEqual([])

  forced.roll = 'shiny'
  await $.agent.spawn(spawnOf('toolu_2'))
  forced.roll = 'legendary'
  await $.agent.spawn(spawnOf('toolu_3'))
  expect(played).toEqual([{ asset: 'sounds/chime.wav' }, { asset: 'sounds/chime.wav' }])
})

test('with the chime off, as it starts, a shiny roll plays nothing', async ($, on) => {
  stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'shiny')
  const played = stubAudio(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(played).toEqual([])
})

test('a chime that cannot play leaves the agent its squishy and the toast', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 9, chime: true } })
  mock.clock(on)
  stubSpawns(on, 'shiny')
  on('audio.play', () => ({ deny: 'no player' }))
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(toasts).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'picture-agent-1' })).toBeDefined()
})

// The mod: the sparkle

test('a shiny’s slot sparkles, even Asleep, with glints the animator moves each frame, and rests once SPARKLE_MS is over', async ($, on) => {
  const clock = mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'shiny')
  stubTurns(on)
  const blits = stubBlits(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.turn.complete(finishOf('agent-1'))
  const squishy = squishyOfAgent(stored, 'agent-1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picture = async () => (await ui.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells

  expect(await picture()).toBe(cellsOf(squishy, 'asleep', 0, 'full', true))
  await clock.advance(FRAME_MS * 2)
  expect(blits).toEqual([
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'asleep', 1, 'full', true) },
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'asleep', 2, 'full', true) },
  ])

  // Once the sparkle is over, the slot is repainted at rest, and then left be
  await clock.advance(SPARKLE_MS)
  expect(blits.at(-1)).toEqual({ key: 'picture-agent-1', cells: cellsOf(squishy, 'asleep', 0) })
  const painted = blits.length
  await clock.advance(FRAME_MS * 8)
  expect(blits).toHaveLength(painted)
})

test('a legendary’s slot sparkles too, and a slot drawn after the sparkle is over is drawn at rest', async ($, on) => {
  const clock = mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'legendary')
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells).toBe(cellsOf(squishy, 'working', 0, 'full', true))
  await ui.unmount()

  await clock.advance(SPARKLE_MS)
  const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const cells = (await later.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells
  expect([0, 1, 2, 3].map(frame => cellsOf(squishy, 'working', frame))).toContain(cells)
})

test('with Reduce motion on, a shiny’s slot never sparkles', async ($, on) => {
  const clock = mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'shiny')
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const blits = stubBlits(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(FRAME_MS * 8)

  expect((await ui.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells).toBe(cellsOf(squishy, 'working', 0))
  expect(blits).toEqual([])
})

// The mod: NEW in the Squishydex

// A pane with room for every place of the Squishydex on one page
const PLACES = KIT.bodies.length * KIT.faces.length + KIT.legendaries.length
const ROOMY = paneSized({ placement: 'dock', bodyColumns: PLACES * (DEX_PLACE_COLUMNS + DEX_COLUMN_GAP), bodyRows: PLACES * DEX_PLACE_ROWS })

async function openSquishydex($: Engine) {
  const ui = await $.ui.mount({ ...ROOMY, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  return ui
}

// The NEW mark on a place, by its key: a species key or a legendary's squishy key
async function markedNew(ui: Awaited<ReturnType<typeof openSquishydex>>, placeKey: string): Promise<boolean> {
  const mark = await ui.find({ key: `squishydex-new-${placeKey}` })
  return mark !== undefined && (await ui.find({ type: 'Text', text: 'NEW' })) !== undefined
}

test('a shiny met for the first time is NEW in the Squishydex until its card is viewed', async ($, on) => {
  mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'shiny')
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')
  if (squishy.kind !== 'assembled') throw new Error('A forced shiny is assembled')
  const place = speciesKey(squishy)
  const ui = await openSquishydex($)

  expect(await markedNew(ui, place)).toBe(true)

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${place}` })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
  expect(await markedNew(ui, place)).toBe(false)
  // and it stays viewed in later sessions
  expect((stored.get(SQUISHYDEX_KEY) as { species: Record<string, object> }).species[place]).not.toHaveProperty('isNew')
})

test('a legendary met for the first time is NEW until its card is viewed', async ($, on) => {
  mock.clock(on)
  stubStore(on, PARTNERED)
  stubSpawns(on, 'legendary')
  await $.agent.spawn(spawnOf('toolu_1'))
  const place = legendaryKey(LEGENDARY.id)
  const ui = await openSquishydex($)

  expect(await markedNew(ui, place)).toBe(true)

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${place}` })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
  expect(await markedNew(ui, place)).toBe(false)
})

test('a plain squishy is never NEW, not even a new species: NEW is for shinies and legendaries', async ($, on) => {
  mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'plain')
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')
  if (squishy.kind !== 'assembled') throw new Error('A forced plain roll is assembled')
  const ui = await openSquishydex($)

  expect(await ui.find({ key: `squishydex-new-${speciesKey(squishy)}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'NEW' })).toBeUndefined()
})

test('a species viewed before is NEW again when it is first met shiny, and so is a legendary first met shiny', async ($, on) => {
  mock.clock(on)
  const BARE = bareAccessory(KIT)
  const [BODY] = KIT.bodies
  const [FACE] = KIT.faces
  const [PALETTE] = KIT.palettes
  if (!BARE || !BODY || !FACE || !PALETTE) throw new Error('The kit needs a body, face, palette and bare accessory')
  const species = { body: BODY.id, face: FACE.id }
  // Both met plain, and viewed, in an earlier session; the agents come back shiny after /clear
  stubStore(on, {
    ...PARTNERED,
    agentSquishys: [
      ['agent-a', assembledKey({ ...species, palette: PALETTE.id, accessory: BARE.id }, true)],
      ['agent-b', legendaryKey(LEGENDARY.id, true)],
    ],
    [SQUISHYDEX_KEY]: {
      species: { [speciesKey(species)]: { met: 0, variants: [variantKey({ palette: PALETTE.id, accessory: BARE.id, shiny: false })] } },
      legendaries: { [LEGENDARY.id]: { met: 0 } },
    },
  })
  stubSessionStart(on)
  stubAgentList(on, ['agent-a', 'agent-b'].map(id => ({ id, description: 'Find config parser', status: 'completed' as const })))

  await $.classic.SessionStart({ source: 'clear' })
  const ui = await openSquishydex($)

  expect(await markedNew(ui, speciesKey(species))).toBe(true)
  expect(await markedNew(ui, legendaryKey(LEGENDARY.id))).toBe(true)
})
