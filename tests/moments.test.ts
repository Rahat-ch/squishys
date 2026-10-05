// Moments: the pure rules (which rolls are one, what their toast says, how
// long they sparkle), and the mod announcing one.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AudioClip, On } from 'claude-code'

import { cycleLabel } from '../src/keys'
import { KIT } from '../src/kit'
import { SPARKLE_MS, isSparkling, momentToast, sparkleUntil, withSparklesTidied } from '../src/moments'
import { FRAME_MS, pictureKey } from '../src/pane'
import { DEX_COLUMN_GAP, DEX_PLACE_COLUMNS, DEX_PLACE_ROWS } from '../src/squishydex'
import { SQUISHYDEX_KEY, speciesKey, squishydexFrom, variantKey } from '../src/squishydex-record'
import { REMEMBERED_KEY, rememberedFrom } from '../src/rebuild'
import { assembledKey, bareAccessory, forcedOdds, legendaryKey, roll, squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { seeded } from '../src/seeded'
import { CHIME_LABEL } from '../src/settings'
import { slotLabel } from '../src/slots'
import { PANE, PARTNERED, finishOf, forceRolls, paneSized, readFrom, spawnOf, stubAgentList, stubBlits, stubSessionStart, stubSpawns, stubStore, stubTurns } from './fixtures'
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
  expect(forcedOdds('sparkly')).toBeUndefined()
})

// Pure: the toast

test('a shiny, a legendary and a shiny legendary each get a toast naming them; a plain squishy none', () => {
  expect(momentToast({ ...MOCHIBI, shiny: true, name: '✨ Mochibi' })).toBe('A shiny ✨ Mochibi appeared!')
  expect(momentToast(GREAT)).toBe('👑 A legendary The Great Xiaolongbao appeared!')
  expect(momentToast({ ...GREAT, shiny: true, name: '✨ The Great Xiaolongbao' })).toBe('🌟 Whoa! A shiny legendary ✨ The Great Xiaolongbao appeared!')
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

test('a sparkle that has passed is cleared, and the next one still to come says when it ends', () => {
  const agents = [{ id: 'a', sparkleUntil: 100 }, { id: 'b', sparkleUntil: 300 }, { id: 'c', sparkleUntil: 200 }, { id: 'd' }]

  expect(withSparklesTidied(agents, 150)).toEqual({ agents: [{ id: 'a' }, { id: 'b', sparkleUntil: 300 }, { id: 'c', sparkleUntil: 200 }, { id: 'd' }], nextEnd: 200 })
  expect(withSparklesTidied(agents, 300)).toEqual({ agents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] })
  // Nothing passed: the same agents, unchanged
  expect(withSparklesTidied(agents, 50).agents).toBe(agents)
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
  expect(squishy.name.startsWith('✨ ')).toBe(true)
  expect(toasts).toEqual([`A shiny ${squishy.name} appeared!`])
})

test('a legendary roll shows a toast naming it', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'legendary')
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  // Whichever of the kit's legendaries came up
  const rolled = squishyOfAgent(stored, 'agent-1')
  expect(rolled.kind).toBe('legendary')
  expect(toasts).toEqual([`👑 A legendary ${rolled.name} appeared!`])
})

test('a shiny legendary roll gets a line of its own', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  mock.clock(on)
  stubSpawns(on, 'shiny-legendary')
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  const rolled = squishyOfAgent(stored, 'agent-1')
  expect(rolled).toMatchObject({ kind: 'legendary', shiny: true })
  const legendary = KIT.legendaries.find(each => rolled.kind === 'legendary' && each.id === rolled.legendary)
  expect(toasts).toEqual([`🌟 Whoa! A shiny legendary ✨ ${legendary?.name} appeared!`])
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
  const stored = stubStore(on, PARTNERED)
  mock.clock(on)
  forceRolls(on, 'legendary')
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

  expect(order).toEqual(['call', `👑 A legendary ${squishyOfAgent(stored, 'teammate-1').name} appeared!`])
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

  const chime = async () => (await ui.find({ type: 'Button', key: 'chime' }))?.props
  expect((await chime())?.hotkey).toBe('c')
  expect((await chime())?.label).toBe(cycleLabel(CHIME_LABEL, 'Off', 'On'))

  await $.ui.press({ plugin: 'squishys', key: 'chime' })
  expect(stored.get('settings')).toEqual({ slotCap: 9, chime: true })
  expect((await chime())?.label).toBe(cycleLabel(CHIME_LABEL, 'On', 'Off'))

  await $.ui.press({ plugin: 'squishys', key: 'chime' })
  expect(stored.get('settings')).toEqual({ slotCap: 9 })
})

test('where $.audio makes no sound, settings hold the chime: dimmed, saying why', async ($, on) => {
  stubStore(on)
  stubPlatform(on, 'linux')
  const ui = await openSettings($)

  expect(await ui.find({ type: 'Button', key: 'model' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'chime' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'held-chime' }))?.props).toMatchObject({ label: `${CHIME_LABEL} (macOS only)`, hotkey: 'c', dimColor: true })
})

test('with the chime on, a shiny or legendary roll plays the chime, and a plain one plays nothing', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 9, chime: true } })
  mock.clock(on)
  stubSpawns(on)
  const forced = forceRolls(on)
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

test('a shiny’s slot sparkles, even Asleep, under its ✨ Name, with glints the animator moves each frame, and rests once SPARKLE_MS is over', async ($, on) => {
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

  expect(squishy.name.startsWith('✨ ')).toBe(true)
  // The slot's button, hotkey 1, shows the Name, cut to fit the slot
  expect((await ui.find({ type: 'Button', key: 'squishy-agent-1' }))?.props.label).toBe(slotLabel(squishy.name, '1'))
  expect(await picture()).toBe(cellsOf(squishy, 'asleep', 0, 'full', true))
  await clock.advance(FRAME_MS * 2)
  expect(blits).toEqual([
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'asleep', 1, 'full', true) },
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'asleep', 2, 'full', true) },
  ])

  // Once the sparkle is over, the slot shows at rest, and then is left be
  await clock.advance(SPARKLE_MS)
  expect(await picture()).toBe(cellsOf(squishy, 'asleep', 0))
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

for (const roll of ['shiny', 'legendary'] as const) {
  test(`a ${roll}’s 2× picture in its focus view sparkles, repainted by blits`, async ($, on) => {
    const clock = mock.clock(on)
    const stored = stubStore(on, PARTNERED)
    stubSpawns(on, roll)
    const blits = stubBlits(on)
    await $.agent.spawn(spawnOf('toolu_1'))
    const squishy = squishyOfAgent(stored, 'agent-1')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

    expect((await ui.find({ type: 'Raster', key: pictureKey('agent-1', 'double') }))?.props.cells).toBe(cellsOf(squishy, 'working', 0, 'double', true))
    await clock.advance(FRAME_MS)
    expect(blits).toEqual([{ key: pictureKey('agent-1', 'double'), cells: cellsOf(squishy, 'working', 1, 'double', true) }])
  })
}

const SESSION_START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

// What Claude Code answers a session start with, beneath the mod
function stubSessionBeneath(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

test('with Reduce motion on, a shiny’s slot never sparkles', async ($, on) => {
  const clock = mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'shiny')
  stubSessionBeneath(on)
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  const blits = stubBlits(on)
  await $.session.start(SESSION_START)
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(FRAME_MS * 8)

  expect((await ui.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells).toBe(cellsOf(squishy, 'working', 0))
  expect(blits).toEqual([])
})

// A clock of the test's own: the time it says, how often it was read, and
// its one-off timers, held until the test lets them pass, or refused (as a
// hot reload drops them). Every timer's periods are refused, so the
// animator never ticks.
function stubClock(on: On, { refuseTimers = false } = {}) {
  const clock = { now: 0, reads: 0 }
  const pending: (() => void)[] = []
  on('clock.now', () => {
    clock.reads += 1
    return { value: clock.now }
  })
  on('clock.after', () =>
    refuseTimers ? { deny: 'dropped' } : new Promise<{ value: undefined }>(resolve => pending.push(() => resolve({ value: undefined }))),
  )
  on('clock.every', () => ({ deny: 'no frames' }))
  const pass = async () => {
    for (const done of pending.splice(0)) done()
    // Lets what the timers started settle
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
  }
  return { clock, pass }
}

test('a sparkle that has passed is cleared from its agent, so drawing reads the clock no more', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'shiny')
  const { clock, pass } = stubClock(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picture = async () => (await ui.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells
  expect(await picture()).toBe(cellsOf(squishy, 'working', 0, 'full', true))

  clock.now = SPARKLE_MS
  await pass()

  expect(await picture()).toBe(cellsOf(squishy, 'working', 0))
  const reads = clock.reads
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await again.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells).toBe(cellsOf(squishy, 'working', 0))
  expect(clock.reads).toBe(reads)
})

// The kit can't reload the mod, so its module's variables (which squishys
// sparkle, the animator) carry on here; this checks what follows from the
// agents' state
test('after a hot reload, which drops the timer ending a sparkle, the session start draws a sparkle still going again, and clears one that passed', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'shiny')
  stubSessionBeneath(on)
  const { clock } = stubClock(on, { refuseTimers: true })
  await $.agent.spawn(spawnOf('toolu_1'))
  const squishy = squishyOfAgent(stored, 'agent-1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picture = async () => (await ui.find({ type: 'Raster', key: 'picture-agent-1' }))?.props.cells

  clock.now = SPARKLE_MS / 2
  await $.session.start(SESSION_START)
  expect(await picture()).toBe(cellsOf(squishy, 'working', 0, 'full', true))

  clock.now = SPARKLE_MS
  await $.session.start(SESSION_START)
  expect(await picture()).toBe(cellsOf(squishy, 'working', 0))
  const reads = clock.reads
  await ui.unmount()
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(clock.reads).toBe(reads)
})

// The mod: rolls after /clear

const BARE = bareAccessory(KIT)
const [BODY] = KIT.bodies
const [FACE] = KIT.faces
const [PALETTE] = KIT.palettes
if (!BARE || !BODY || !FACE || !PALETTE) throw new Error('The kit needs a body, face, palette and bare accessory')
const SPECIES = { body: BODY.id, face: FACE.id }
const SHINY_KEY = assembledKey({ ...SPECIES, palette: PALETTE.id, accessory: BARE.id }, true)

test('after /clear, a fresh roll that comes up legendary is announced and sparkles, while a restored shiny stays silent', async ($, on) => {
  mock.clock(on)
  const restored = squishyOf(KIT, SHINY_KEY)
  if (restored === undefined) throw new Error('The kit makes that shiny')
  const stored = stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: [['agent-a', SHINY_KEY]] })
  stubSessionStart(on, 'legendary')
  stubAgentList(on, ['agent-a', 'agent-b'].map(id => ({ id, description: 'Find config parser', status: 'running' as const })))
  const toasts = stubToasts(on)

  await $.classic.SessionStart({ source: 'clear' })

  const fresh = squishyOfAgent(stored, 'agent-b')
  expect(toasts).toEqual([`👑 A legendary ${fresh.name} appeared!`])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster', key: 'picture-agent-b' }))?.props.cells).toBe(cellsOf(fresh, 'working', 0, 'full', true))
  expect((await ui.find({ type: 'Raster', key: 'picture-agent-a' }))?.props.cells).toBe(cellsOf(restored, 'working', 0))
  // Forced, the legendary isn't recorded; the restored shiny is, as any rebuilt squishy is
  const dex = squishydexFrom(stored.get(SQUISHYDEX_KEY))
  expect(Object.keys(dex.legendaries)).toEqual([])
  expect(dex.species[speciesKey(SPECIES)]?.variants).toContain(variantKey({ palette: PALETTE.id, accessory: BARE.id, shiny: true }))
})

// The mod: forced rolls and the Squishydex

test('a roll forced shiny or legendary still toasts, but is never recorded in the Squishydex; a roll forced plain is', async ($, on) => {
  mock.clock(on)
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on, 'legendary')
  const forced = forceRolls(on)
  const toasts = stubToasts(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  forced.roll = 'shiny'
  await $.agent.spawn(spawnOf('toolu_2'))
  forced.roll = 'plain'
  await $.agent.spawn(spawnOf('toolu_3'))

  expect(toasts).toHaveLength(2)
  const shiny = squishyOfAgent(stored, 'agent-2')
  const plain = squishyOfAgent(stored, 'agent-3')
  if (plain.kind !== 'assembled' || shiny.kind !== 'assembled') throw new Error('Forced plain and shiny rolls are assembled')
  const dex = squishydexFrom(stored.get(SQUISHYDEX_KEY))
  expect(Object.keys(dex.legendaries)).toEqual([])
  expect(dex.species[speciesKey(shiny)]?.variants ?? []).not.toContain(variantKey(shiny))
  expect(dex.species[speciesKey(plain)]?.variants).toContain(variantKey(plain))
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

// Whether a place, by its key (a species key or a legendary's squishy key), shows NEW
async function markedNew(ui: Awaited<ReturnType<typeof openSquishydex>>, placeKey: string): Promise<boolean> {
  return (await ui.find({ key: `squishydex-new-${placeKey}` })) !== undefined
}

// Agents that come back after a branch with these squishys, which the
// Squishydex meets then: forced rolls aren't recorded, so these tests meet
// shinies and legendaries the way a rebuild restores them. A branch rebuilds
// from the whole agent list; /clear would leave these ended agents out.
async function meetAfterClear($: Engine, on: On, keys: readonly string[], dex?: unknown) {
  mock.clock(on)
  const stored = stubStore(on, {
    ...PARTNERED,
    [REMEMBERED_KEY]: keys.map((key, index) => [`agent-${index + 1}`, key]),
    ...(dex !== undefined ? { [SQUISHYDEX_KEY]: dex } : {}),
  })
  stubSessionStart(on)
  stubAgentList(on, keys.map((_, index) => ({ id: `agent-${index + 1}`, description: 'Find config parser', status: 'completed' as const })))
  await $.classic.SessionStart({ source: 'fork' })
  return stored
}

test('a shiny met for the first time is NEW in the Squishydex until its card is viewed, and stays viewed', async ($, on) => {
  const stored = await meetAfterClear($, on, [SHINY_KEY])
  const place = speciesKey(SPECIES)
  const ui = await openSquishydex($)

  expect(await markedNew(ui, place)).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'NEW' })).toBeDefined()

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${place}` })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
  expect(await markedNew(ui, place)).toBe(false)
  expect(squishydexFrom(stored.get(SQUISHYDEX_KEY)).species[place]).not.toHaveProperty('isNew')
})

test('a legendary met for the first time is NEW until its card is viewed', async ($, on) => {
  await meetAfterClear($, on, [legendaryKey(LEGENDARY.id)])
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

  expect(await ui.find({ type: 'Raster', key: `squishydex-picture-${speciesKey(squishy)}` })).toBeDefined()
  expect(await markedNew(ui, speciesKey(squishy))).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'NEW' })).toBeUndefined()
})

test('a species viewed before is NEW again when it is first met shiny, and so is a legendary first met shiny', async ($, on) => {
  // Both met plain, and viewed, in an earlier session
  await meetAfterClear($, on, [SHINY_KEY, legendaryKey(LEGENDARY.id, true)], {
    species: { [speciesKey(SPECIES)]: { met: 0, variants: [variantKey({ palette: PALETTE.id, accessory: BARE.id, shiny: false })] } },
    legendaries: { [LEGENDARY.id]: { met: 0 } },
  })
  const ui = await openSquishydex($)

  expect(await markedNew(ui, speciesKey(SPECIES))).toBe(true)
  expect(await markedNew(ui, legendaryKey(LEGENDARY.id))).toBe(true)
})
