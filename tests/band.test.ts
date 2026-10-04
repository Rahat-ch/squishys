import { expect, mock, test } from 'claude-code/testing'
import type { On, PaneOpenArgs } from 'claude-code'

import { OPEN_HINT } from '../src/band'
import { KIT } from '../src/kit'
import { FRAME_MS, PANE_ID, pictureKey } from '../src/pane'
import { PARTNER_BUTTON, PARTNER_PICTURE } from '../src/partner'
import { REMEMBERED_KEY, rememberedFrom } from '../src/rebuild'
import { squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { BAND_GAP, BAND_NAME_COLUMNS, BAND_PICTURE_COLUMNS, BAND_PICTURE_ROWS, nameCut } from '../src/slots'
import { PANE, PARTNERED, SQUISHYS_COMMAND, readFrom, spawnOf, stubBlits, stubSpawns, stubStore } from './fixtures'
import { cellsOf } from './pictures'

// The band's render input, as Claude Code passes it, with room for `across`
// squishys side by side, then the overflow count (when `overflow` agents
// don't show) and the hint, BAND_GAP apart. Pictured, it has the rows for
// mini pictures, the count over the hint; otherwise one row too few, the
// count beside the hint.
function bandSized(across: number, { pictured = true, overflow = 0, hasSurvey = false } = {}) {
  const count = overflow > 0 ? `+${overflow}`.length : 0
  const side = pictured ? Math.max(OPEN_HINT.length, count) : OPEN_HINT.length + (count > 0 ? count + BAND_GAP : 0)
  const bodyColumns = across * ((pictured ? BAND_PICTURE_COLUMNS : BAND_NAME_COLUMNS) + BAND_GAP) + side
  const maxRows = pictured ? BAND_PICTURE_ROWS : BAND_PICTURE_ROWS - 1
  return {
    plugin: 'squishys',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    surface: 'terminal',
    props: { hasSurvey, isWorking: true, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
  } as const
}

// Stands for whatever Claude Code itself draws above the prompt (a survey,
// or nothing), beneath the mod
const BENEATH = 'drawn by Claude Code'
function stubBandBeneath(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: [BENEATH] }))
}

// Stands in for Claude Code's panes, placing an unasked open only on a wide
// terminal (`wide`) and leaving it unplaced otherwise. Claude Code places an
// open the user asked for (from the hook of a command they typed, or a
// press) at any width: the test sets `asking` around such an act. With
// `unplaced`, the pane starts open and unplaced, as an earlier open left it;
// with `refusal`, an open the user asked for is refused so. Reads back every
// open asked for.
function stubPanes(
  on: On,
  { wide, unplaced = false, refusal }: { wide: boolean; unplaced?: boolean; refusal?: string },
): { opens: PaneOpenArgs[]; asking: boolean } {
  const stub = { opens: [] as PaneOpenArgs[], asking: false }
  const open = new Map<string, boolean>(unplaced ? [[PANE_ID, false]] : [])
  on('ui.panes', () => ({
    value: [...open].map(([id, isPlaced]) => ({ id, title: id, isShown: true, isFocused: false, isPlaced })),
  }))
  on('ui.open', ($, e) => {
    stub.opens.push(e)
    if (stub.asking && refusal !== undefined) return { deny: refusal }
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

test('an agent first seen through its tool call, as an in-process teammate, opens the pane too', async ($, on) => {
  mock.store(on)
  const { opens } = stubPanes(on, { wide: true })
  on('agent.list', () => ({
    value: [{ id: 'teammate-1', description: 'Review the docs', type: 'teammate', status: 'running' }],
  }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call(readFrom('teammate-1', 'README.md'))
  await $.tool.call(readFrom('teammate-1', 'CONTEXT.md'))

  expect(opens.map(open => open.id)).toEqual([PANE_ID])
})

test('a first agent finds the pane open already and leaves it be', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const { opens } = stubPanes(on, { wide: false, unplaced: true })

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(opens).toEqual([])
})

test('while the opened pane is unplaced, the band shows a mini squishy for each agent and the open hint', async ($, on) => {
  const stored = stubStore(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const band = await $.ui.mount(bandSized(2))

  for (const agentId of ['agent-1', 'agent-2']) {
    const squishy = squishyOfAgent(stored, agentId)
    expect((await band.find({ type: 'Button', key: `squishy-${agentId}` }))?.props.label).toBe(squishy.name)
    expect((await band.find({ type: 'Raster', key: pictureKey(agentId, 'mini') }))?.props.cells).toBe(cellsOf(squishy, 'working', 0, 'mini'))
  }
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()
})

test('the band shows the agents alone, never the partner', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount(bandSized(2))

  expect((await band.findAll({ type: 'Raster' })).map(picture => picture.key)).toEqual([pictureKey('agent-1', 'mini')])
  expect(await band.find({ key: PARTNER_BUTTON })).toBeUndefined()
  expect(await band.find({ key: PARTNER_PICTURE })).toBeUndefined()
})

test('while the pane is placed, the band leaves the space to Claude Code', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubBandBeneath(on)
  stubPanes(on, { wide: true })

  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount(bandSized(1))

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
  const band = await $.ui.mount(bandSized(1, { hasSurvey: true }))

  expect(await band.find({ type: 'Text', text: BENEATH })).toBeDefined()
  expect(await band.find({ type: 'Button' })).toBeUndefined()
})

test('squishys the band has no room for show as its overflow count', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  for (const id of ['toolu_1', 'toolu_2', 'toolu_3']) await $.agent.spawn(spawnOf(id))
  const band = await $.ui.mount(bandSized(1, { overflow: 2 }))

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
  const band = await $.ui.mount(bandSized(1, { pictured: false }))

  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect(await band.find({ type: 'Button', key: 'squishy-agent-1' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()
})

test('in a row of Names just too tight for one beside the overflow count and the hint, the band shows the count alone', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })
  for (const id of ['toolu_1', 'toolu_2', 'toolu_3']) await $.agent.spawn(spawnOf(id))
  const room = bandSized(1, { pictured: false, overflow: 2 })

  const band = await $.ui.mount(room)
  expect(await band.findAll({ type: 'Button' })).toHaveLength(1)
  expect(await band.find({ type: 'Text', text: '+2' })).toBeDefined()

  await band.redraw({ ...room.props, bodyColumns: room.props.bodyColumns - 1 })
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: '+3' })).toBeDefined()
})

test('band Buttons carry no hotkeys, so a digit typed into an empty prompt types it', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const band = await $.ui.mount(bandSized(2))

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
  const band = await $.ui.mount(bandSized(2))

  panes.asking = true
  await band.press({ key: 'squishy-agent-2' })

  // Asked for by the click, so Claude Code places it at any width
  expect(panes.opens.map(open => open.id)).toEqual([PANE_ID, PANE_ID])
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'focus' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: squishyOfAgent(stored, 'agent-2').name })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
})

test('a pick from the band whose open is refused says why in a toast', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const toasts = stubToasts(on)
  const panes = stubPanes(on, { wide: false, refusal: 'no panes in this session' })
  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount(bandSized(1))

  panes.asking = true
  await band.press({ key: 'squishy-agent-1' })

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('no panes in this session')
  expect(await band.find({ type: 'Button', key: 'squishy-agent-1' })).toBeDefined()
})

test('/squishys opens the unplaced pane rather than closing it, and the band steps aside', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubBandBeneath(on)
  const panes = stubPanes(on, { wide: false })
  await $.agent.spawn(spawnOf('toolu_1'))
  const band = await $.ui.mount(bandSized(1))
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeDefined()

  panes.asking = true
  await $.command.run(SQUISHYS_COMMAND)

  expect(panes.opens.map(open => open.id)).toEqual([PANE_ID, PANE_ID])
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeUndefined()
})

test('a /squishys whose open is refused says why in a toast', async ($, on) => {
  const toasts = stubToasts(on)
  const panes = stubPanes(on, { wide: false, refusal: 'no panes in this session' })

  panes.asking = true
  await $.command.run(SQUISHYS_COMMAND)

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('no panes in this session')
})

test('a Working mini squishy in the band wiggles, repainted by blits to the band', async ($, on) => {
  const clock = mock.clock(on)
  const stored = stubStore(on)
  stubSpawns(on)
  stubPanes(on, { wide: false })
  const blits = stubBlits(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.ui.mount(bandSized(1))
  const squishy = squishyOfAgent(stored, 'agent-1')

  await clock.advance(FRAME_MS * 2)

  expect(blits).toEqual([{ key: pictureKey('agent-1', 'mini'), cells: cellsOf(squishy, 'working', 2, 'mini') }])
})

for (const roll of ['shiny', 'legendary'] as const) {
  test(`a ${roll}’s mini squishy in the band sparkles, repainted by blits to the band, under its Name cut to fit`, async ($, on) => {
    const clock = mock.clock(on)
    const stored = stubStore(on)
    stubSpawns(on, roll)
    stubPanes(on, { wide: false })
    const blits = stubBlits(on)
    await $.agent.spawn(spawnOf('toolu_1'))
    const band = await $.ui.mount(bandSized(1))
    const squishy = squishyOfAgent(stored, 'agent-1')

    expect((await band.find({ type: 'Raster', key: pictureKey('agent-1', 'mini') }))?.props.cells).toBe(cellsOf(squishy, 'working', 0, 'mini', true))
    expect((await band.find({ type: 'Button', key: 'squishy-agent-1' }))?.props.label).toBe(nameCut(squishy.name))
    await clock.advance(FRAME_MS)
    expect(blits).toEqual([{ key: pictureKey('agent-1', 'mini'), cells: cellsOf(squishy, 'working', 1, 'mini', true) }])
  })
}

test('with no agents, as after a /clear that found none, the band leaves the space to Claude Code though the pane is unplaced', async ($, on) => {
  stubBandBeneath(on)
  // The pane a spawn opened before the /clear, still unplaced
  stubPanes(on, { wide: false, unplaced: true })

  const band = await $.ui.mount(bandSized(1))
  expect(await band.find({ type: 'Text', text: BENEATH })).toBeDefined()
  expect(await band.find({ type: 'Text', text: OPEN_HINT })).toBeUndefined()
})
