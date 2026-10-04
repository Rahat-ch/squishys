// The roster layout, tested directly: plain data in (the pane's size, the
// slot cap, the agents and the slots the roster showed last), the agents in
// slots and the overflow out.

import { expect, test } from 'claude-code/testing'

import { PICTURE_SIZE, compose } from '../src/composer'
import { KIT } from '../src/kit'
import { halfBlocks } from '../src/raster'
import { SHINY_MARK, roll } from '../src/roller'
import { seeded } from '../src/seeded'
import { MAX_SLOTS } from '../src/settings'
import {
  BAND_GAP,
  BAND_NAME_COLUMNS,
  nameCut,
  textColumns,
  BAND_PICTURE_COLUMNS,
  BAND_PICTURE_ROWS,
  FOOTER_COLUMN_GAP,
  FOOTER_ROW_COLUMNS,
  LABEL_SLOT_ROWS,
  MINI_SLOT_COLUMNS,
  MINI_SLOT_GAP,
  MINI_SLOT_ROWS,
  PICTURE_COLUMNS,
  PICTURE_ROWS,
  SLOT_COLUMN_GAP,
  SLOT_COLUMNS,
  SLOT_LINES,
  SLOT_MIN_COLUMNS,
  SLOT_ROWS,
  buttonColumns,
  layoutBand,
  layoutRoster,
  liveSquishys,
  slotLabel,
} from '../src/slots'
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
    [roomFor('dock', 1, 1, short(1, 0)), 0],
  ]
  for (const [size, slots] of sizes) {
    const layout = layoutRoster({ ...size, slotCap: MAX_SLOTS, agents: agents(12) })
    expect({ size, slots: layout.slots.length }).toEqual({ size, slots })
  }
})

// Inline, rows are scarce, and Claude Code may give the pane fewer than a
// full slot needs (seen at 3 for #55): the slots there shrink before they
// go, so a squishy always shows
test('an inline pane too short for a full slot gets mini slots, the mini picture beside its Name, description and mark', () => {
  const wide = roomFor('inline', 6, 1).bodyColumns
  for (const bodyRows of [MINI_SLOT_ROWS, SLOT_ROWS - 1]) {
    const layout = layoutRoster({ placement: 'inline', bodyColumns: wide, bodyRows, slotCap: MAX_SLOTS, agents: agents(2), partner: PARTNER })

    expect({ bodyRows, slotSize: layout.slotSize }).toEqual({ bodyRows, slotSize: 'mini' })
    expect(layout.partnerSlot).toBe(true)
    expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
    expect(layout.overflow).toEqual([])
  }
})

test('mini slots go as many across as fit beside the footer, and past the slot cap agents overflow', () => {
  const across = 3
  const bodyColumns = roomFor('inline', 1, 1).bodyColumns - SLOT_COLUMNS + across * MINI_SLOT_COLUMNS + (across - 1) * SLOT_COLUMN_GAP
  // The cap leaves labels no more room than minis, so the minis stay
  const layout = layoutRoster({ placement: 'inline', bodyColumns, bodyRows: MINI_SLOT_ROWS, slotCap: across - 1, agents: agents(4), partner: PARTNER })

  expect(layout.slotSize).toBe('mini')

  expect(layout.columns).toBe(across)
  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-3', 'agent-4'])
})

test('an inline pane too short even for a mini slot shows the Names alone, and only one with no row at all shows none', () => {
  const wide = roomFor('inline', 6, 1).bodyColumns
  const named = layoutRoster({ placement: 'inline', bodyColumns: wide, bodyRows: MINI_SLOT_ROWS - 1, slotCap: MAX_SLOTS, agents: agents(1), partner: PARTNER })
  expect(named.slotSize).toBe('label')
  expect(named.partnerSlot).toBe(true)
  expect(ids(named.slots)).toEqual(['agent-1'])

  const none = layoutRoster({ placement: 'inline', bodyColumns: wide, bodyRows: 0, slotCap: MAX_SLOTS, agents: agents(1), partner: PARTNER })
  expect(none.slots).toEqual([])
  expect(ids(none.overflow)).toEqual(['agent-1'])
})

test('a pane with room for a full slot keeps full slots; docked, slots never shrink', () => {
  expect(layoutRoster({ ...roomFor('inline', 6, 1), slotCap: MAX_SLOTS, agents: agents(2), partner: PARTNER }).slotSize).toBe('full')
  const shortDock = { ...roomFor('dock', 3, 1), bodyRows: MINI_SLOT_ROWS }
  const docked = layoutRoster({ ...shortDock, slotCap: MAX_SLOTS, agents: agents(2), partner: PARTNER })
  expect(docked.slotSize).toBe('full')
  expect(docked.slots).toEqual([])
})

test('inline, a full slot row that only the partner fits gives way to smaller slots that show an agent too', () => {
  const narrow = roomFor('inline', 1, 1)
  const layout = layoutRoster({ ...narrow, slotCap: MAX_SLOTS, agents: agents(2), partner: PARTNER })

  // A slot across, and as many label rows down as a full slot's rows hold
  expect(layout.slotSize).toBe('label')
  expect(layout.columns).toBe(1)
  expect(layout.partnerSlot).toBe(true)
  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
})

test('a short inline pane shrinks its slots to the size that leaves the least overflow, the larger picture on a tie', () => {
  const wide = roomFor('inline', 6, 1).bodyColumns
  // Minis there go four across in one row: the partner and three agents
  const many = layoutRoster({ placement: 'inline', bodyColumns: wide, bodyRows: MINI_SLOT_ROWS, slotCap: MAX_SLOTS, agents: agents(5), partner: PARTNER })
  expect(many.slotSize).toBe('label')
  expect(ids(many.slots)).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'])
  expect(many.overflow).toEqual([])

  // Labels would show every one of three too, so the minis stay
  const few = layoutRoster({ placement: 'inline', bodyColumns: wide, bodyRows: MINI_SLOT_ROWS, slotCap: MAX_SLOTS, agents: agents(3), partner: PARTNER })
  expect(few.slotSize).toBe('mini')
  expect(few.overflow).toEqual([])
})

test('inline, in a pane shorter than the footer’s column of buttons, the footer is a row beside the slots and its width comes off theirs', () => {
  const across = 3
  const bodyColumns = FOOTER_ROW_COLUMNS + FOOTER_COLUMN_GAP + across * SLOT_COLUMNS + (across - 1) * SLOT_COLUMN_GAP
  for (const bodyRows of [LABEL_SLOT_ROWS, MINI_SLOT_ROWS - 1]) {
    const layout = layoutRoster({ placement: 'inline', bodyColumns, bodyRows, slotCap: MAX_SLOTS, agents: agents(4), partner: PARTNER })

    expect({ bodyRows, footer: layout.footer, slotSize: layout.slotSize, columns: layout.columns }).toEqual({ bodyRows, footer: 'row', slotSize: 'label', columns: across })
    expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
  }
  // With rows for a button each, the footer is a column again
  expect(layoutRoster({ placement: 'inline', bodyColumns, bodyRows: MINI_SLOT_ROWS, slotCap: MAX_SLOTS, agents: agents(4) }).footer).toBe('column')
  // Docked, its buttons are always lined up under the slots
  expect(layoutRoster({ ...roomFor('dock', 2, 1), slotCap: MAX_SLOTS, agents: agents(4) }).footer).toBe('row')
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

test('a slot is as wide as its picture, but at least SLOT_MIN_COLUMNS, and as tall as its half-block rows with three lines under it', () => {
  const picture = halfBlocks(compose(KIT, roll(KIT, { live: [], rng: seeded(1) }), { state: 'working', frame: 0 }))

  expect({ columns: PICTURE_COLUMNS, rows: PICTURE_ROWS }).toEqual({ columns: picture.columns, rows: picture.rows })
  expect(picture.columns).toBe(PICTURE_SIZE)
  expect(SLOT_COLUMNS).toBe(Math.max(picture.columns, SLOT_MIN_COLUMNS))
  // Its name, its description and the main view's mark
  expect(SLOT_ROWS).toBe(picture.rows + 3)
})

test('a mini slot is a mini picture, a gap, and a slot’s width for its lines, as tall as the taller of the two', () => {
  const mini = halfBlocks(compose(KIT, roll(KIT, { live: [], rng: seeded(1) }), { state: 'working', frame: 0, size: 'mini' }))

  expect(MINI_SLOT_COLUMNS).toBe(mini.columns + MINI_SLOT_GAP + SLOT_COLUMNS)
  // Its Name, its description and the main view's mark, beside the picture
  expect(MINI_SLOT_ROWS).toBe(Math.max(mini.rows, SLOT_LINES))
  // A label slot is its Name's Button alone
  expect(LABEL_SLOT_ROWS).toBe(1)
})

test('a slot’s Name is cut so its button, hotkey and all, fits the slot, and every Name and legendary’s fits once cut', () => {
  const fits = (label: string, hotkey?: string) => buttonColumns(label, hotkey) <= SLOT_COLUMNS
  const fullWidth = 'x'.repeat(SLOT_COLUMNS - buttonColumns('', '9'))

  // A Name that just fits stays whole; one a column longer is cut, ending in …
  expect(slotLabel(fullWidth, '9')).toBe(fullWidth)
  expect(slotLabel(`${fullWidth}y`, '9')).toBe(`${fullWidth.slice(1)}…`)
  // Without a hotkey there's room for more
  expect(slotLabel(`${fullWidth}y`)).toBe(`${fullWidth}y`)
  // The longest Names there are, shiny, with and without a hotkey
  const legendary = KIT.legendaries.map(each => `${SHINY_MARK}${each.name}`)
  for (const name of [...legendary, `${SHINY_MARK}${'x'.repeat(SLOT_COLUMNS)}`]) {
    expect(fits(slotLabel(name, '9'), '9')).toBe(true)
    expect(fits(slotLabel(name))).toBe(true)
  }
})

// The band: the room for `across` places side by side, then the overflow
// count (when `overflow` agents don't show) and the hint, BAND_GAP apart
function bandRoom(across: number, { pictured, overflow = 0 }: { pictured: boolean; overflow?: number }) {
  const place = pictured ? BAND_PICTURE_COLUMNS : BAND_NAME_COLUMNS
  const count = overflow > 0 ? `+${overflow}`.length : 0
  const side = pictured ? Math.max(HINT_COLUMNS, count) : HINT_COLUMNS + (count > 0 ? count + BAND_GAP : 0)
  return { bodyColumns: across * (place + BAND_GAP) + side, maxRows: pictured ? BAND_PICTURE_ROWS : BAND_PICTURE_ROWS - 1, hintColumns: HINT_COLUMNS }
}
const HINT_COLUMNS = 30

test('the band shows running squishys first, then Squished before Asleep, each in the order first seen', () => {
  const known = [agent('agent-1', 'asleep'), agent('agent-2', 'squished'), agent('agent-3'), agent('agent-4', 'asleep'), agent('agent-5', 'thinking')]

  const band = layoutBand({ agents: known, ...bandRoom(5, { pictured: true }) })

  expect(ids(band.shown)).toEqual(['agent-3', 'agent-5', 'agent-2', 'agent-1', 'agent-4'])
  expect(band.overflow).toEqual([])
})

test('agents the band has no room for are its overflow, ended ones first to go', () => {
  const known = [agent('agent-1', 'asleep'), agent('agent-2', 'squished'), agent('agent-3')]

  const band = layoutBand({ agents: known, ...bandRoom(2, { pictured: true, overflow: 1 }) })

  expect(ids(band.shown)).toEqual(['agent-3', 'agent-2'])
  expect(ids(band.overflow)).toEqual(['agent-1'])
})

test('the band shows mini pictures given the rows for them, and Names alone in fewer', () => {
  const room = bandRoom(1, { pictured: true })

  expect(layoutBand({ agents: [agent('agent-1')], ...room }).pictured).toBe(true)
  expect(layoutBand({ agents: [agent('agent-1')], ...room, maxRows: BAND_PICTURE_ROWS - 1 }).pictured).toBe(false)
})

test('in a row of Names, the overflow count and the hint take their room too, so the row never runs past the band', () => {
  const known = agents(3)

  expect(ids(layoutBand({ agents: known, ...bandRoom(1, { pictured: false, overflow: 2 }) }).shown)).toEqual(['agent-1'])
  const short = bandRoom(1, { pictured: false, overflow: 2 })
  const band = layoutBand({ agents: known, ...short, bodyColumns: short.bodyColumns - 1 })
  expect(band.shown).toEqual([])
  expect(band.overflow).toHaveLength(3)
})

test('two agents that share a squishy both show in the band', () => {
  const known = [agent('agent-1'), { ...agent('agent-2', 'asleep'), squishy: { key: 'squishy-of-agent-1' } }]

  expect(ids(layoutBand({ agents: known, ...bandRoom(2, { pictured: true }) }).shown)).toEqual(['agent-1', 'agent-2'])
})

test('a band place is as wide as a mini picture or a Name, and as tall as the mini’s half-block rows with its Name under it', () => {
  const mini = halfBlocks(compose(KIT, roll(KIT, { live: [], rng: seeded(1) }), { state: 'working', frame: 0, size: 'mini' }))

  expect(BAND_PICTURE_COLUMNS).toBe(Math.max(mini.columns, BAND_NAME_COLUMNS))
  expect(BAND_PICTURE_ROWS).toBe(mini.rows + 1)
})

// The partner stands for the orchestrator: pinned in the first slot, with
// the agents in the rest
const PARTNER = { key: 'squishy-of-partner' }

test('the partner takes the first slot, and the agents fill the rest and overflow past them', () => {
  const layout = layoutRoster({ ...roomFor('dock', 3, 1), slotCap: MAX_SLOTS, agents: agents(4), partner: PARTNER })

  expect(layout.partnerSlot).toBe(true)
  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2'])
  expect(ids(layout.overflow)).toEqual(['agent-3', 'agent-4'])
})

test('the partner’s slot comes on top of the slot cap, which counts the agents’ slots', () => {
  const layout = layoutRoster({ ...roomFor('dock', 6, 6), slotCap: 3, agents: agents(5), partner: PARTNER })

  expect(layout.partnerSlot).toBe(true)
  expect(ids(layout.slots)).toEqual(['agent-1', 'agent-2', 'agent-3'])
  expect(ids(layout.overflow)).toEqual(['agent-4', 'agent-5'])
  expect(layout.columns).toBe(4)
})

test('the partner still takes the first slot the pane has room for, cap or no cap', () => {
  const layout = layoutRoster({ ...roomFor('dock', 2, 1), slotCap: 3, agents: agents(3), partner: PARTNER })

  expect(ids(layout.slots)).toEqual(['agent-1'])
  expect(ids(layout.overflow)).toEqual(['agent-2', 'agent-3'])
})

test('with one slot, the partner keeps it and every agent waits in the overflow', () => {
  const layout = layoutRoster({ ...roomFor('dock', 1, 1), slotCap: MAX_SLOTS, agents: agents(2), partner: PARTNER, slotted: ['agent-1'] })

  expect(layout.partnerSlot).toBe(true)
  expect(layout.slots).toEqual([])
  expect(ids(layout.overflow)).toEqual(['agent-1', 'agent-2'])
})

test('with no room for a slot, the partner has none either', () => {
  const layout = layoutRoster({ ...roomFor('dock', 1, 1, { columns: -1, rows: 0 }), slotCap: MAX_SLOTS, agents: agents(1), partner: PARTNER })

  expect(layout.partnerSlot).toBe(false)
  expect(ids(layout.overflow)).toEqual(['agent-1'])
})

test('without a partner, no slot is pinned', () => {
  expect(layoutRoster({ ...TWO_SLOTS, slotCap: MAX_SLOTS, agents: agents(2) }).partnerSlot).toBe(false)
})

test('an ended agent showing the partner’s squishy gets no slot beside it', () => {
  const twin = { ...agent('agent-2', 'asleep'), squishy: PARTNER }
  const layout = layoutRoster({ ...roomFor('dock', 3, 1), slotCap: MAX_SLOTS, agents: [agent('agent-1', 'asleep'), twin], partner: PARTNER })

  expect(ids(layout.slots)).toEqual(['agent-1'])
  expect(ids(layout.overflow)).toEqual(['agent-2'])
})

test('the roll pool leaves out the partner’s squishy', () => {
  const live = liveSquishys([agent('agent-1')], ['agent-1'], PARTNER)

  expect(live.map(squishy => squishy.key)).toEqual(['squishy-of-agent-1', 'squishy-of-partner'])
})

test('a Name is cut to the band’s columns by what it takes on screen, a shiny’s ✨ two of them', () => {
  expect(nameCut('Mochibun')).toBe('Mochibun')
  expect(nameCut('Mochibunbao')).toBe('Mochibunb…')
  // ✨ takes two columns: "✨ Mochibu" fills all ten
  expect(nameCut('✨ Mochibu')).toBe('✨ Mochibu')
  expect(nameCut('✨ Mochibun')).toBe('✨ Mochib…')
  expect(textColumns(nameCut('✨ Mochibunbao'))).toBe(BAND_NAME_COLUMNS)
})

test('only emoji drawn as emoji and wide characters take two columns: ✓, ★ and the spinner’s ✶ take one', () => {
  expect(textColumns('✓★✶…')).toBe(4)
  expect(textColumns('✨⭐✅')).toBe(6)
  expect(textColumns('もち')).toBe(4)
  expect(textColumns('Squishing…')).toBe(10)
})
