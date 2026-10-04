// The roster layout: how many slots fit the pane, which agents get them and
// which wait in the overflow. Pure: it takes plain data and never touches
// Claude Code, so the pane and the tests share it.
//
// The partner (pinned first) comes later and will take the first slot.

import { isEnded } from './states'
import type { SquishyState } from './states'

/**
 * A squishy's picture in the roster, in cells: a pixel across each cell and
 * two down it (half blocks).
 */
export const PICTURE_COLUMNS = 16
export const PICTURE_ROWS = 8
/** A slot's width: its squishy's picture. */
export const SLOT_COLUMNS = PICTURE_COLUMNS
/**
 * A slot's height: the picture, then its name, its description and a row
 * for the mark on the squishy of the agent open in the main view.
 */
export const SLOT_ROWS = PICTURE_ROWS + 3
/** The rows the docked footer takes under the slots: its own and the gap above it. */
export const FOOTER_ROWS = 2
/** The columns between slots side by side. */
export const SLOT_COLUMN_GAP = 2
/** The rows between rows of slots. */
export const SLOT_ROW_GAP = 1
/**
 * The columns the footer (the overflow count and Settings) takes beside the
 * slots in an inline pane, where rows are scarce. Docked, where columns are,
 * it takes a row under them, a row apart.
 */
export const FOOTER_COLUMNS = 10

/** Where the pane sits and how big its body is, as its render props say. */
export type RosterSize = {
  placement: 'dock' | 'inline'
  bodyColumns: number
  bodyRows: number
}

/** What the layout needs to know of an agent. */
export type RosterAgent = {
  id: string
  state: SquishyState
  squishy: { key: string }
}

export type RosterLayout<A extends RosterAgent> = {
  /** The agents in slots, in slot order. */
  slots: A[]
  /** The agents with no slot, in the order they were first seen. */
  overflow: A[]
  /** How many slots go across a row. */
  columns: number
}

/**
 * Lays out the roster. Agents keep the slots they had in `slotted` (the ids
 * the roster last showed, in slot order), so squishys stay put. A running
 * agent without a slot takes a free one, else an Asleep squishy's, else a
 * Squished one's, and otherwise waits in the overflow: a running squishy is
 * never displaced. Free slots left over go to ended agents, but never to a
 * second picture of a squishy already showing. `agents` is in the order
 * they were first seen.
 */
export function layoutRoster<A extends RosterAgent>({
  agents,
  slotCap,
  slotted = [],
  ...size
}: RosterSize & { agents: readonly A[]; slotCap: number; slotted?: readonly string[] }): RosterLayout<A> {
  const { count, columns } = grid(size, slotCap)
  const byId = new Map(agents.map(agent => [agent.id, agent]))
  const kept: A[] = [...new Set(slotted)].flatMap(id => byId.get(id) ?? [])
  while (kept.length > count) kept.splice(leastNeeded(kept), 1)

  const slots: (A | undefined)[] = [...kept]
  const newcomers: A[] = []
  const free = () => count - kept.length - newcomers.length
  for (const agent of agents.filter(each => !kept.includes(each) && !isEnded(each.state))) {
    if (free() > 0) {
      newcomers.push(agent)
      continue
    }
    const taken = endedSlot(slots, 'asleep') ?? endedSlot(slots, 'squished')
    if (taken !== undefined) slots[taken] = agent
  }
  const showing = () => new Set([...slots, ...newcomers].flatMap(agent => (agent ? [agent.squishy.key] : [])))
  for (const agent of agents.filter(each => !kept.includes(each) && isEnded(each.state))) {
    if (free() > 0 && !showing().has(agent.squishy.key)) newcomers.push(agent)
  }
  // Newcomers to free slots take them in the order they were first seen
  slots.push(...agents.filter(agent => newcomers.includes(agent)))

  const shown = slots.filter((agent): agent is A => agent !== undefined)
  return { slots: shown, overflow: agents.filter(agent => !shown.includes(agent)), columns }
}

/**
 * The squishys a roll must not repeat: every running agent's, since it may
 * take a slot at any time, and every one in the roster's slots now. An
 * ended agent's squishy with no slot goes back to the pool. Before the
 * roster is first drawn (`slotted` undefined), every agent's.
 */
export function liveSquishys<A extends RosterAgent>(agents: readonly A[], slotted: readonly string[] | undefined): A['squishy'][] {
  return agents
    .filter(agent => slotted === undefined || !isEnded(agent.state) || slotted.includes(agent.id))
    .map(agent => agent.squishy)
}

/** How many slots fit, at most `slotCap`, and how many go across a row. */
function grid({ placement, bodyColumns, bodyRows }: RosterSize, slotCap: number): { count: number; columns: number } {
  const step = SLOT_COLUMNS + SLOT_COLUMN_GAP
  // Inline, the footer and the gap before it come off the columns
  const across = Math.floor((bodyColumns + SLOT_COLUMN_GAP - (placement === 'inline' ? FOOTER_COLUMNS + SLOT_COLUMN_GAP : 0)) / step)
  // Docked, the footer row and the gap above it come off the rows
  const rows = Math.floor((bodyRows + SLOT_ROW_GAP - (placement === 'dock' ? FOOTER_ROWS : 0)) / (SLOT_ROWS + SLOT_ROW_GAP))
  const count = Math.max(0, Math.min(slotCap, across * rows))
  return { count, columns: Math.min(Math.max(0, across), Math.max(0, slotCap)) }
}

/** The slot whose squishy is in `state` (an ended one) that goes first. */
function endedSlot(slots: readonly (RosterAgent | undefined)[], state: 'asleep' | 'squished'): number | undefined {
  const at = slots.findIndex(agent => agent?.state === state)
  return at === -1 ? undefined : at
}

/** The slot to give up when the pane shrinks: the last Asleep, else the last Squished, else the last. */
function leastNeeded(slots: readonly RosterAgent[]): number {
  for (const state of ['asleep', 'squished'] as const) {
    const at = slots.findLastIndex(agent => agent.state === state)
    if (at !== -1) return at
  }
  return slots.length - 1
}
