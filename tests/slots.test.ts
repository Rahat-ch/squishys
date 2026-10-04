// The roster layout, tested directly: plain data in (the pane's size, the
// slot cap, the agents and the slots the roster showed last), the agents in
// slots and the overflow out.

import { expect, test } from 'claude-code/testing'

import { PICTURE_SIZE, compose } from '../src/composer'
import { KIT } from '../src/kit'
import { halfBlocks } from '../src/raster'
import { roll } from '../src/roller'
import { seeded } from '../src/seeded'
import { MAX_SLOTS } from '../src/settings'
import { PICTURE_COLUMNS, PICTURE_ROWS, SLOT_COLUMNS, SLOT_ROWS, layoutRoster, liveSquishys } from '../src/slots'
import type { RosterAgent, RosterSize } from '../src/slots'
import type { SquishyState } from '../src/states'
import { roomFor } from './fixtures'

function agent(id: string, state: SquishyState = 'working'): RosterAgent {
  return { id, state, squishy: { key: `squishy-of-${id}` } }
}

function agents(count: number, state: SquishyState = 'working'): RosterAgent[] {
  return Array.from({ length: count }, (_, index) => agent(`agent-${index + 1}`, state))
}

const ids = (list: readonly RosterAgent[]) => list.map(each => each.id)

// A docked pane two slots wide and one high
const TWO_SLOTS: RosterSize = roomFor('dock', 2, 1)

// Each slot is a squishy's picture with its name and description under it.
// Docked, the footer (+N and Settings) goes under the slots; inline, where
// rows are scarce, beside them. See roomFor in the fixtures.
test('the slot count is however many slots fit the pane, docked or inline', () => {
  const short = (columns: number, rows: number) => ({ columns: -columns, rows: -rows })
  const sizes: [RosterSize, number][] = [
    [roomFor('dock', 2, 2), 4],
    [roomFor('dock', 2, 2, { columns: 3, rows: 3 }), 4],
    [roomFor('dock', 2, 2, short(1, 0)), 2],
    [roomFor('dock', 2, 2, short(0, 1)), 2],
    [roomFor('dock', 3, 3), 9],
    [roomFor('inline', 6, 1), 6],
    [roomFor('inline', 3, 1), 3],
    [roomFor('inline', 3, 1, short(1, 0)), 2],
    [roomFor('inline', 6, 1, short(0, 1)), 0],
    [roomFor('dock', 1, 1, short(1, 0)), 0],
  ]
  for (const [size, slots] of sizes) {
    const layout = layoutRoster({ ...size, slotCap: MAX_SLOTS, agents: agents(12) })
    expect({ size, slots: layout.slots.length }).toEqual({ size, slots })
  }
})

test('the slot cap from settings limits the slots, however big the pane', () => {
  const big: RosterSize = roomFor('dock', 6, 6)

  expect(layoutRoster({ ...big, slotCap: MAX_SLOTS, agents: agents(12) }).slots).toHaveLength(MAX_SLOTS)
  expect(layoutRoster({ ...big, slotCap: 3, agents: agents(12) }).slots).toHaveLength(3)
})

test('it says how many slots go across a row', () => {
  expect(layoutRoster({ ...roomFor('dock', 2, 2), slotCap: MAX_SLOTS, agents: [] }).columns).toBe(2)
  expect(layoutRoster({ ...roomFor('inline', 6, 1), slotCap: MAX_SLOTS, agents: [] }).columns).toBe(6)
  expect(layoutRoster({ ...roomFor('inline', 6, 1), slotCap: 4, agents: [] }).columns).toBe(4)
})

test('agents beyond the slots are the overflow, in the order they were first seen', () => {
  const layout = layoutRoster({ ...TWO_SLOTS, slotCap: MAX_SLOTS, agents: agents(5) })

  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-3', 'agent-4', 'agent-5'])
})

test('first drawn, running agents take the slots before ended ones, shown in the order they were first seen', () => {
  const layout = layoutRoster({
    ...TWO_SLOTS,
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1', 'asleep'), agent('agent-2', 'working'), agent('agent-3', 'needsYou')],
  })

  expect(ids(layout.slots)).toEqual(['agent-2', 'agent-3'])
  expect(ids(layout.overflow)).toEqual(['agent-1'])
})

test('an ended agent keeps its slot while no running agent needs it', () => {
  const layout = layoutRoster({
    ...TWO_SLOTS,
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1', 'asleep'), agent('agent-2', 'squished')],
    slotted: ['agent-1', 'agent-2'],
  })

  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
  expect(layout.overflow).toEqual([])
})

test('a new agent takes an Asleep squishy’s slot, in its place, before a Squished one’s', () => {
  const layout = layoutRoster({
    ...TWO_SLOTS,
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1', 'squished'), agent('agent-2', 'asleep'), agent('agent-3')],
    slotted: ['agent-1', 'agent-2'],
  })

  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-3'])
  expect(ids(layout.overflow)).toEqual(['agent-2'])
})

test('with no Asleep slot, a new agent takes a Squished squishy’s slot', () => {
  const layout = layoutRoster({
    ...TWO_SLOTS,
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1', 'squished'), agent('agent-2'), agent('agent-3')],
    slotted: ['agent-1', 'agent-2'],
  })

  expect(ids(layout.slots)).toEqual(['agent-3', 'agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-1'])
})

test('a running squishy is never displaced: a new agent with no ended slot to take waits in the overflow', () => {
  const layout = layoutRoster({
    ...TWO_SLOTS,
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1'), agent('agent-2', 'thinking'), agent('agent-3')],
    slotted: ['agent-1', 'agent-2'],
  })

  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-3'])
})

test('an agent that wakes in the overflow does not push out a running squishy seen after it', () => {
  // agent-1 finished and went to the overflow when agent-2 took its slot;
  // then a message resumed it
  const layout = layoutRoster({
    ...roomFor('dock', 1, 1),
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1'), agent('agent-2')],
    slotted: ['agent-2'],
  })

  expect(ids(layout.slots)).toEqual(['agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-1'])
})

test('a running agent in the overflow takes the slot of a squishy that fell Asleep', () => {
  const layout = layoutRoster({
    ...TWO_SLOTS,
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1', 'asleep'), agent('agent-2'), agent('agent-3')],
    slotted: ['agent-1', 'agent-2'],
  })

  expect(ids(layout.slots)).toEqual(['agent-3', 'agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-1'])
})

test('slots that open up go to ended agents in the overflow, unless one shows the same squishy as a slot', () => {
  const twin = { ...agent('agent-3', 'asleep'), squishy: { key: 'squishy-of-agent-1' } }
  const layout = layoutRoster({
    ...roomFor('dock', 3, 1),
    slotCap: MAX_SLOTS,
    agents: [agent('agent-1', 'asleep'), agent('agent-2', 'squished'), twin, agent('agent-4', 'asleep')],
    slotted: ['agent-1'],
  })

  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2', 'agent-4'])
  expect(ids(layout.overflow)).toEqual(['agent-3'])
})

test('when the pane shrinks, ended squishys leave their slots first, Asleep before Squished, then the last running ones', () => {
  const known = [agent('agent-1'), agent('agent-2', 'asleep'), agent('agent-3', 'squished'), agent('agent-4')]
  const slotted = ids(known)

  const two = layoutRoster({ ...TWO_SLOTS, slotCap: MAX_SLOTS, agents: known, slotted })
  expect(ids(two.slots)).toEqual(['agent-1', 'agent-4'])

  const three = layoutRoster({ ...roomFor('dock', 3, 1), slotCap: MAX_SLOTS, agents: known, slotted })
  expect(ids(three.slots)).toEqual(['agent-1', 'agent-3', 'agent-4'])

  const one = layoutRoster({ ...TWO_SLOTS, slotCap: 1, agents: known, slotted })
  expect(ids(one.slots)).toEqual(['agent-1'])
})

test('slots of agents no longer known are freed', () => {
  const layout = layoutRoster({ ...TWO_SLOTS, slotCap: MAX_SLOTS, agents: [agent('agent-2'), agent('agent-3')], slotted: ['agent-1', 'agent-2'] })

  expect(ids(layout.slots)).toEqual(['agent-2', 'agent-3'])
})

test('the roll pool leaves out every running agent’s squishy and every squishy on screen', () => {
  const known = [agent('agent-1', 'asleep'), agent('agent-2', 'squished'), agent('agent-3'), agent('agent-4', 'asleep'), agent('agent-5', 'squished')]

  // agent-4 in a slot, agent-5 in the focus view
  const live = liveSquishys(known, ['agent-3', 'agent-4', 'agent-5'])

  expect(live.map(squishy => squishy.key)).toEqual(['squishy-of-agent-3', 'squishy-of-agent-4', 'squishy-of-agent-5'])
})

test('before the roster is first drawn, every agent’s squishy is live', () => {
  const known = [agent('agent-1', 'asleep'), agent('agent-2')]

  expect(liveSquishys(known, undefined)).toHaveLength(2)
})

test('a slot is as wide as a composed squishy picture and as tall as its half-block rows, with three lines under it', () => {
  const picture = halfBlocks(compose(KIT, roll(KIT, { live: [], rng: seeded(1) }), { state: 'working', frame: 0 }))

  expect({ columns: PICTURE_COLUMNS, rows: PICTURE_ROWS }).toEqual({ columns: picture.columns, rows: picture.rows })
  expect(picture.columns).toBe(PICTURE_SIZE)
  expect(SLOT_COLUMNS).toBe(picture.columns)
  // Its name, its description and the main view's mark
  expect(SLOT_ROWS).toBe(picture.rows + 3)
})
