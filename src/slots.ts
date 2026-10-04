// The roster layout: how many slots fit the pane, which agents get them and
// which wait in the overflow; and the band's, which squishys it shows above
// the prompt. Pure: it takes plain data and never touches Claude Code, so the
// pane, the band and the tests share it.

import { PICTURE_SIZE } from './composer'
import { SLOT_GIVING_ORDER, isEnded } from './states'
import type { SquishyState } from './states'

/**
 * A squishy's picture in the roster, in cells: a pixel across each cell and
 * two down it (half blocks).
 */
export const PICTURE_COLUMNS = PICTURE_SIZE
export const PICTURE_ROWS = Math.ceil(PICTURE_SIZE / 2)
/** A slot's width: its squishy's picture. */
export const SLOT_COLUMNS = PICTURE_COLUMNS
/**
 * A slot's height: the picture, then its name, its description and a row
 * for the mark on the squishy of the agent open in the main view.
 */
export const SLOT_ROWS = PICTURE_ROWS + 3
/** The columns between slots side by side. */
export const SLOT_COLUMN_GAP = 2
/** The rows between rows of slots. */
export const SLOT_ROW_GAP = 1
/**
 * The footer: the overflow count and Settings. Docked, where columns are
 * plenty, it takes a row under the slots, FOOTER_ROW_GAP rows below them;
 * inline, where rows are scarce, FOOTER_COLUMNS beside them,
 * FOOTER_COLUMN_GAP columns away. Its buttons sit FOOTER_BUTTON_GAP apart.
 */
export const FOOTER_ROWS = 1
export const FOOTER_ROW_GAP = 1
export const FOOTER_COLUMNS = 10
export const FOOTER_COLUMN_GAP = 2
export const FOOTER_BUTTON_GAP = 2

/** A mini squishy's picture in the band, in cells: half a picture across, two pixels down a cell. */
const MINI_COLUMNS = Math.floor(PICTURE_COLUMNS / 2)
const MINI_ROWS = Math.ceil(MINI_COLUMNS / 2)
/** The most of a squishy's Name the band shows. */
export const BAND_NAME_COLUMNS = 10
/** A squishy's place in the band, with its mini picture over its Name. */
export const BAND_PICTURE_COLUMNS = Math.max(MINI_COLUMNS, BAND_NAME_COLUMNS)
/** The rows the band needs for its mini pictures; in fewer it shows the Names alone. */
export const BAND_PICTURE_ROWS = MINI_ROWS + 1
/** The columns between the band's squishys, the overflow count and the hint. */
export const BAND_GAP = 1

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
 * agent without a slot takes a free one, else an ended squishy's (in
 * SLOT_GIVING_ORDER), and otherwise waits in the overflow: a running
 * squishy is never displaced. Free slots left over go to ended agents, but
 * never to a second picture of a squishy already showing. When the pane
 * shrinks, ended squishys give up their slots first, in the same order,
 * and running ones only once no ended one is left. `agents` is in the
 * order they were first seen.
 */
export function layoutRoster<A extends RosterAgent>({
  agents,
  slotCap,
  slotted = [],
  ...size
}: RosterSize & { agents: readonly A[]; slotCap: number; slotted?: readonly string[] }): RosterLayout<A> {
  const count = slotCount(size, slotCap)
  const byId = new Map(agents.map(agent => [agent.id, agent]))
  const holding: A[] = [...new Set(slotted)].flatMap(id => byId.get(id) ?? [])
  while (holding.length > count) holding.splice(slotGivenUp(holding, 'last') ?? holding.length - 1, 1)

  const slots: A[] = [...holding]
  const newcomers: A[] = []
  const free = () => count - holding.length - newcomers.length
  for (const agent of agents.filter(each => !holding.includes(each) && !isEnded(each.state))) {
    if (free() > 0) {
      newcomers.push(agent)
      continue
    }
    const taken = slotGivenUp(slots, 'first')
    if (taken !== undefined) slots[taken] = agent
  }
  const showing = () => new Set([...slots, ...newcomers].map(agent => agent.squishy.key))
  for (const agent of agents.filter(each => !holding.includes(each) && isEnded(each.state))) {
    if (free() > 0 && !showing().has(agent.squishy.key)) newcomers.push(agent)
  }
  // Newcomers to free slots take them in the order they were first seen
  slots.push(...agents.filter(agent => newcomers.includes(agent)))

  return { slots, overflow: agents.filter(agent => !slots.includes(agent)), columns: slotsAcross(size, slotCap) }
}

/**
 * The squishys a roll must not repeat: every running agent's, since it may
 * take a slot at any time, and every one on screen (`onScreen`: the agents
 * in the roster's slots and any other the pane draws, as in the focus
 * view). An ended agent's squishy that is nowhere on screen goes back to
 * the pool. Before the pane first draws (`onScreen` undefined), every
 * agent's.
 */
export function liveSquishys<A extends RosterAgent>(agents: readonly A[], onScreen: readonly string[] | undefined): A['squishy'][] {
  return agents
    .filter(agent => onScreen === undefined || !isEnded(agent.state) || onScreen.includes(agent.id))
    .map(agent => agent.squishy)
}

/** The band's room: its body columns, the rows it may take and its hint's width. */
type BandSize = { bodyColumns: number; maxRows: number; hintColumns: number }

type BandLayout<A extends RosterAgent> = {
  /** The agents the band shows, in order. */
  shown: A[]
  /** The agents it has no room for, counted as "+N". */
  overflow: A[]
  /** Whether it shows mini pictures over the Names, or the Names alone. */
  pictured: boolean
  /** How wide each squishy's place is. */
  placeColumns: number
}

/**
 * Lays out the band: one row of squishys, then the overflow count and the
 * hint. Running squishys come first, then ended ones, those that give up
 * roster slots last (SLOT_GIVING_ORDER) first, each in the order first seen.
 * With BAND_PICTURE_ROWS it shows mini pictures, the count stacked over the
 * hint; with fewer, the Names alone, the count beside the hint. As many
 * squishys show as leave room for the count and the hint.
 */
export function layoutBand<A extends RosterAgent>({ agents, bodyColumns, maxRows, hintColumns }: BandSize & { agents: readonly A[] }): BandLayout<A> {
  const pictured = maxRows >= BAND_PICTURE_ROWS
  const placeColumns = pictured ? BAND_PICTURE_COLUMNS : BAND_NAME_COLUMNS
  const giving = (agent: A) => SLOT_GIVING_ORDER.indexOf(agent.state)
  const ended = agents.filter(agent => isEnded(agent.state)).sort((a, b) => giving(b) - giving(a))
  const ordered = [...agents.filter(agent => !isEnded(agent.state)), ...ended]
  const width = (across: number) => {
    const left = ordered.length - across
    const count = left > 0 ? `+${left}`.length : 0
    const side = pictured ? Math.max(hintColumns, count) : hintColumns + (count > 0 ? count + BAND_GAP : 0)
    return across * (placeColumns + BAND_GAP) + side
  }
  let across = ordered.length
  while (across > 0 && width(across) > bodyColumns) across -= 1
  return { shown: ordered.slice(0, across), overflow: ordered.slice(across), pictured, placeColumns }
}

/** How many slots fit across the pane, at most `slotCap`. */
function slotsAcross({ placement, bodyColumns }: RosterSize, slotCap: number): number {
  // Inline, the footer and the gap before it come off the columns
  const room = bodyColumns + SLOT_COLUMN_GAP - (placement === 'inline' ? FOOTER_COLUMNS + FOOTER_COLUMN_GAP : 0)
  return Math.max(0, Math.min(slotCap, Math.floor(room / (SLOT_COLUMNS + SLOT_COLUMN_GAP))))
}

/** How many slots fit the pane, at most `slotCap`. */
function slotCount(size: RosterSize, slotCap: number): number {
  // Docked, the footer row and the gap above it come off the rows
  const room = size.bodyRows + SLOT_ROW_GAP - (size.placement === 'dock' ? FOOTER_ROWS + FOOTER_ROW_GAP : 0)
  const down = Math.max(0, Math.floor(room / (SLOT_ROWS + SLOT_ROW_GAP)))
  return Math.min(slotCap, slotsAcross(size, slotCap) * down)
}

/**
 * The slot whose ended squishy gives it up next, by SLOT_GIVING_ORDER: the
 * `first` such slot or the `last`. Undefined when every squishy runs.
 */
function slotGivenUp(slots: readonly RosterAgent[], which: 'first' | 'last'): number | undefined {
  for (const state of SLOT_GIVING_ORDER) {
    const at = which === 'first' ? slots.findIndex(agent => agent.state === state) : slots.findLastIndex(agent => agent.state === state)
    if (at !== -1) return at
  }
  return undefined
}
