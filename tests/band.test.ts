import { expect, mock, test } from 'claude-code/testing'
import type { On, PaneOpenArgs } from 'claude-code'

import { BAND_GAP, BAND_PICTURE_ROWS, BAND_SLOT_COLUMNS, OPEN_HINT } from '../src/band'
import { KIT } from '../src/kit'
import { FRAME_MS, PANE_ID, pictureKey } from '../src/pane'
import { REMEMBERED_KEY, rememberedFrom } from '../src/rebuild'
import { squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { PANE, SQUISHYS_COMMAND, spawnOf, stubBlits, stubSpawns, stubStore } from './fixtures'
import { cellsOf } from './pictures'

// What Claude Code passes to the band's ui.render hook, apart from the
// surface: a band with rows and columns to spare
const BAND = {
  plugin: 'squishys',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 155,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

// The band's render input with room for `across` squishys side by side
// beside the hint, and `rows` rows
function bandSized(across: number, rows: number = BAND.props.maxRows) {
  const bodyColumns = across * (BAND_SLOT_COLUMNS + BAND_GAP) + OPEN_HINT.length
  return { ...BAND, props: { ...BAND.props, bodyColumns, maxRows: rows, scroll: { offset: 0, bodyRows: rows - 1 } } }
}

// Stands for whatever Claude Code itself draws above the prompt (a survey,
// or nothing), beneath the mod
const BENEATH = 'drawn by Claude Code'
function stubBandBeneath(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: [BENEATH] }))
}

// Stands in for Claude Code's panes, seating an unasked open only on a wide
// terminal (`wide`). Claude Code seats an open the user asked for (from the
// hook of a command they typed, or a press) at any width: the test sets
// `asking` around such an act. With `waiting`, the pane starts open and
// unplaced, as an earlier open left it. Reads back every open asked for.
function stubPanes(on: On, { wide, waiting = false }: { wide: boolean; waiting?: boolean }): { opens: PaneOpenArgs[]; asking: boolean } {
  const stub = { opens: [] as PaneOpenArgs[], asking: false }
  const open = new Map<string, boolean>(waiting ? [[PANE_ID, false]] : [])
  on('ui.panes', () => ({
    value: [...open].map(([id, isPlaced]) => ({ id, title: id, isShown: true, isFocused: false, isPlaced })),
  }))
  on('ui.open', ($, e) => {
    stub.opens.push(e)
    const isPlaced = wide || stub.asking || open.get(e.id) === true
    open.set(e.id, isPlaced)
    return { value: isPlaced ? { isPlaced } : { isPlaced, reason: 'An unasked pane needs 144 columns; the terminal has 100' } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  return stub
}

// The squishy an agent was given, as the store keeps it
function squishyOfAgent(stored: Map<string, unknown>, agentId: string): Squishy {
  const key = rememberedFrom(stored.get(REMEMBERED_KEY)).find(([id]) => id === agentId)?.[1]
  const squishy = key === undefined ? undefined : squishyOf(KIT, key)
  if (squishy === undefined) throw new Error(`${agentId} has no squishy in the store`)
  return squishy
}

test('the first spawn asks Claude Code to open the pane, unfocused, and later spawns leave it be', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const { opens } = stubPanes(on, { wide: true })

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))

  expect(opens).toHaveLength(1)
  expect(opens[0]?.id).toBe(PANE_ID)
  expect(opens[0]?.focus).toBeUndefined()
})

test('while the opened pane waits unplaced, the band shows a mini squishy for each agent and the open hint', async ($, on) => {
  const stored = stubStore(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  for (const agentId of ['agent-1', 'agent-2']) {
    const squishy = squishyOfAgent(stored, agentId)
    expect((await band.find({ type: 'Button', key: `squishy-${agentId}` }))?.props.label).toBe(squishy.name)
    expect((await band.find({ type: 'Raster', key: pictureKey(agentId, 'mini') }))?.props.cells).toBe(cellsOf(squishy, 'working', 0, 'mini'))
  }
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()
})

test('while the pane is placed, the band leaves the space to Claude Code', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubBandBeneath(on)
  stubPanes(on, { wide: true })

  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await band.find({ type: 'Text', text: BENEATH })).toBeDefined()
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
})

test('the band leaves the space to Claude Code while it shows a survey', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubBandBeneath(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })

  expect(await band.find({ type: 'Text', text: BENEATH })).toBeDefined()
  expect(await band.find({ type: 'Button' })).toBeUndefined()
})

test('squishys the band has no room for show as its overflow count', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  for (const id of ['toolu_1', 'toolu_2', 'toolu_3']) await $.agent.spawn(spawnOf(id))
  const band = await $.ui.mount({ ...bandSized(1), surface: 'terminal' })

  expect(await band.findAll({ type: 'Button' })).toHaveLength(1)
  expect(await band.find({ type: 'Button', key: 'squishy-agent-1' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '+2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()
})

test('in fewer rows than its minis need, the band shows the squishys’ Names alone', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount({ ...bandSized(2, BAND_PICTURE_ROWS - 1), surface: 'terminal' })

  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect(await band.find({ type: 'Button', key: 'squishy-agent-1' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()
})

test('band Buttons carry no hotkeys, so a digit typed into an empty prompt types it', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const buttons = await band.findAll({ type: 'Button' })
  expect(buttons).toHaveLength(2)
  for (const button of buttons) expect(button.props.hotkey).toBeUndefined()
})

test('clicking a mini squishy in the band opens the pane on its focus view, and the band steps aside', async ($, on) => {
  const stored = stubStore(on)
  stubSpawns(on)
  stubBandBeneath(on)
  const panes = stubPanes(on, { wide: false })
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn({ ...spawnOf('toolu_2'), description: 'Run the tests' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  panes.asking = true
  await band.press({ key: 'squishy-agent-2' })

  // Asked for by the click, so Claude Code seats it at any width
  expect(panes.opens.map(open => open.id)).toEqual([PANE_ID, PANE_ID])
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'focus' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: squishyOfAgent(stored, 'agent-2').name })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
})

test('/squishys opens the waiting pane rather than closing it, and the band steps aside', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubBandBeneath(on)
  const panes = stubPanes(on, { wide: false })
  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()

  panes.asking = true
  await $.command.run(SQUISHYS_COMMAND)

  expect(panes.opens.map(open => open.id)).toEqual([PANE_ID, PANE_ID])
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeUndefined()
})

test('a Working mini squishy in the band wiggles, repainted by blits to the band', async ($, on) => {
  const clock = mock.clock(on)
  const stored = stubStore(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })
  const blits = stubBlits(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.ui.mount({ ...BAND, surface: 'terminal' })
  const squishy = squishyOfAgent(stored, 'agent-1')

  await clock.advance(FRAME_MS * 2)

  expect(blits).toEqual([{ key: pictureKey('agent-1', 'mini'), cells: cellsOf(squishy, 'working', 2, 'mini') }])
})

test('with no agents, as after a /clear that found none, the band leaves the space to Claude Code though the pane waits', async ($, on) => {
  stubBandBeneath(on)
  // The pane a spawn opened before the /clear, still waiting unplaced
  stubPanes(on, { wide: false, waiting: true })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: BENEATH })).toBeDefined()
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeUndefined()
})
