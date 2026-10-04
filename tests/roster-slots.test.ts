// The roster's slots and its overflow, through the whole mod: how many
// slots the pane's size and the slot cap leave, which agents get them, and
// the "+N" count and list of the rest.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { FRAME_MS } from '../src/pane'
import { REMEMBERED_KEY } from '../src/rebuild'
import { SQUISHYS_COMMAND, finishOf, paneSized, roomFor, spawnOf, stubBlits, stubSpawns, stubStore, stubTurns } from './fixtures'
import { cellsOf, watch } from './pictures'

async function spawn($: Engine, count: number, from = 1): Promise<void> {
  for (let n = from; n < from + count; n += 1) await $.agent.spawn({ ...spawnOf(`toolu_${n}`), description: `Task ${n}` })
}

/** The agents the roster's slots show, by id, in slot order. */
async function slotted(ui: Mounted<'terminal', 'Pane'>): Promise<string[]> {
  return (await ui.findAll({ type: 'Raster' })).map(picture => String(picture.key).replace(/^picture-/, ''))
}

async function overflowCount(ui: Mounted<'terminal', 'Pane'>): Promise<string | undefined> {
  return (await ui.find({ type: 'Button', key: 'overflow' }))?.props.label as string | undefined
}

// A docked pane with room for two slots side by side, one row of them
const TWO_SLOTS = paneSized(roomFor('dock', 2, 1))

test('the slot count follows the pane’s size, docked and inline, and the rest show only as +N', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await spawn($, 5)

  const sizes = [
    [paneSized(roomFor('dock', 2, 2)), 4],
    [paneSized(roomFor('dock', 2, 2, { columns: -1, rows: 0 })), 2],
    [paneSized(roomFor('dock', 3, 2)), 5],
    [paneSized(roomFor('inline', 4, 1)), 4],
    [paneSized(roomFor('inline', 3, 1, { columns: 1, rows: 3 })), 3],
  ] as const
  for (const [pane, slots] of sizes) {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    expect(await ui.findAll({ type: 'Raster' })).toHaveLength(slots)
    expect(await overflowCount(ui)).toBe(slots < 5 ? `+${5 - slots}` : undefined)
    // An agent in the overflow has no name button or description of its own
    const description = await ui.find({ type: 'Text', text: 'Task 5' })
    if (slots < 5) expect(description).toBeUndefined()
    else expect(description).toBeDefined()
    await ui.unmount()
  }
})

test('the roster takes in a resize of the pane', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await spawn($, 5)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])

  await ui.redraw(paneSized(roomFor('dock', 3, 1)).props)

  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2', 'agent-3'])
  expect(await overflowCount(ui)).toBe('+2')
})

test('when the pane shrinks, ended squishys go to the overflow, Asleep before Squished, before any running one', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 4)
  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 2, 2)), surface: 'terminal' })
  await $.turn.complete(finishOf('agent-2', 'error'))
  await $.turn.complete(finishOf('agent-3'))

  await ui.redraw(paneSized(roomFor('dock', 3, 1)).props)
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2', 'agent-4'])

  await ui.redraw(TWO_SLOTS.props)
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-4'])

  // With no ended squishy left in a slot, a running one gives way
  await ui.redraw(paneSized(roomFor('dock', 1, 1)).props)
  expect(await slotted(ui)).toEqual(['agent-1'])
  expect(await overflowCount(ui)).toBe('+3')
})

test('the slot cap in settings limits the slots on a pane with room for more', async ($, on) => {
  stubStore(on, { settings: { slotCap: 2 } })
  stubSpawns(on)
  await spawn($, 4)

  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 3)), surface: 'terminal' })

  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])
  expect(await overflowCount(ui)).toBe('+2')
})

test('picking +N lists the overflow agents, and picking one opens its focus view like any squishy', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await spawn($, 4)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'overflow' }))?.props.hotkey).toBe('m')

  await ui.press({ key: 'overflow' })

  const listed = await Promise.all(['agent-3', 'agent-4'].map(async id => ui.find({ type: 'Button', key: `squishy-${id}` })))
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeDefined()
  expect(await ui.find({ key: 'overflow-agent-4' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Task 3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Task 4' })).toBeDefined()
  // Named as in their slots: by their squishy's Name
  for (const button of listed) expect(button?.props.label).toMatch(/^[A-Z]/)
  const name = String(listed[1]?.props.label)
  // The list shows in place of the slots, so it fits an inline pane too
  expect(await slotted(ui)).toEqual([])

  // Picking an agent from the list opens its focus view, as picking its
  // squishy in a slot does
  await ui.press({ key: 'squishy-agent-4' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Task 4' })).toBeDefined()

  // and the list has closed when the roster comes back
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'overflow-agent-4' })).toBeUndefined()
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])
})

test('picking +N again closes the list', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await spawn($, 3)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })

  await ui.press({ key: 'overflow' })
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeDefined()
  await ui.press({ key: 'overflow' })
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeUndefined()
})

test('a list left open closes once the overflow empties, and never reopens unasked', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await spawn($, 3)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  await ui.press({ key: 'overflow' })
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeDefined()

  // The pane grows to fit every agent, then shrinks again
  await ui.redraw(paneSized(roomFor('dock', 3, 1)).props)
  expect(await overflowCount(ui)).toBeUndefined()
  await ui.redraw(TWO_SLOTS.props)

  // The list stays shut until it's asked for again, with one press
  expect(await overflowCount(ui)).toBe('+1')
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeUndefined()
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])
  await ui.press({ key: 'overflow' })
  expect(await ui.find({ key: 'overflow-agent-3' })).toBeDefined()
})

test('any other press in the pane shuts the overflow list', async ($, on) => {
  stubStore(on)
  stubSpawns(on)
  await spawn($, 3)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  await ui.press({ key: 'overflow' })

  await ui.press({ key: 'settings' })
  await ui.press({ key: 'back' })

  expect(await ui.find({ key: 'overflow-agent-3' })).toBeUndefined()
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])
})

test('with every agent in a slot, there is no +N', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await spawn($, 2)

  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })

  expect(await overflowCount(ui)).toBeUndefined()
})

test('a new agent takes an Asleep squishy’s slot, in its place, and the Asleep one moves to the overflow', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 2)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  await $.turn.complete(finishOf('agent-1'))
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])

  await spawn($, 1, 3)

  expect(await slotted(ui)).toEqual(['agent-3', 'agent-2'])
  await ui.press({ key: 'overflow' })
  expect(await ui.find({ key: 'overflow-agent-1' })).toBeDefined()
})

test('a new agent takes an Asleep squishy’s slot before a Squished one’s', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 2)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  await $.turn.complete(finishOf('agent-1', 'error'))
  await $.turn.complete(finishOf('agent-2'))

  await spawn($, 1, 3)

  expect(await slotted(ui)).toEqual(['agent-1', 'agent-3'])
})

test('Working squishys are never displaced: a new agent waits in the overflow until a slot’s squishy falls Asleep', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 2)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })

  await spawn($, 1, 3)
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2'])
  expect(await overflowCount(ui)).toBe('+1')

  await $.turn.complete(finishOf('agent-2'))
  expect(await slotted(ui)).toEqual(['agent-1', 'agent-3'])
})

test('an ended agent keeps its slot while no new agent needs it', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 2)
  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 1)), surface: 'terminal' })
  await $.turn.complete(finishOf('agent-1'))

  await spawn($, 1, 3)

  expect(await slotted(ui)).toEqual(['agent-1', 'agent-2', 'agent-3'])
})

test('only squishys in slots animate: no frame goes out for an agent in the overflow', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  const blits = stubBlits(on)
  await spawn($, 3)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  const { squishy } = await watch(ui, 'agent-1')

  await clock.advance(FRAME_MS * 2)

  expect(new Set(blits.map(blit => blit.key))).toEqual(new Set(['picture-agent-1', 'picture-agent-2']))
  expect(blits).toContainEqual({ key: 'picture-agent-1', cells: cellsOf(squishy, 'working', 2) })
})

test('no two running agents share a squishy, in a slot or in the overflow', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 5)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })

  // Each agent shows in a slot once those ahead of it fall Asleep
  const pictures = new Map<string, unknown>()
  for (let batch = 0; batch < 3; batch += 1) {
    for (const id of await slotted(ui)) {
      if (pictures.has(id)) continue
      pictures.set(id, (await ui.find({ key: `picture-${id}` }))?.props.cells)
      await $.turn.complete(finishOf(id))
    }
  }

  expect(pictures.size).toBe(5)
  expect(new Set(pictures.values()).size).toBe(5)
})

test('an ended agent open in the focus view keeps its squishy out of the pool, though its slot went to another', async ($, on) => {
  const stored = stubStore(on, { settings: { slotCap: 1 } })
  stubSpawns(on)
  stubTurns(on)
  await spawn($, 1)
  const ui = await $.ui.mount({ ...TWO_SLOTS, surface: 'terminal' })
  await $.turn.complete(finishOf('agent-1'))
  // agent-2 takes agent-1's slot, and agent-1 goes to the overflow
  await spawn($, 1, 2)
  await ui.press({ key: 'overflow' })
  await ui.press({ key: 'squishy-agent-1' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()

  await spawn($, 4, 3)

  // Each agent's squishy key, as the store keeps it
  const keys = new Map(stored.get(REMEMBERED_KEY) as [string, string][])
  const focused = keys.get('agent-1')
  expect(focused).toBeDefined()
  for (let n = 3; n <= 6; n += 1) expect(keys.get(`agent-${n}`)).not.toBe(focused)
})

test('/squishys asks for room for a row of slots, for when the pane opens inline', async ($, on) => {
  const opened: { id: string; rows?: number }[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push({ id: e.id, rows: e.rows })
    return { value: { isPlaced: true } }
  })

  await $.command.run(SQUISHYS_COMMAND)

  expect(opened).toEqual([{ id: 'squishys', rows: roomFor('inline', 1, 1).bodyRows }])
})
