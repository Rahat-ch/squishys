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
/** The longest Name the kit spells (tests/kit.test.ts holds it to this). */
export const NAME_COLUMNS = 13
/**
 * A slot's width: its squishy's picture, centered, or its Name as its
 * button draws it, `9: ` hotkey and all, whichever is wider.
 */
export const SLOT_COLUMNS = Math.max(PICTURE_COLUMNS, buttonColumns('x'.repeat(NAME_COLUMNS), '9'))
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
 * The columns a Button takes as drawn: its label, after the `x: ` its
 * hotkey draws before it.
 */
export function buttonColumns(label: string, hotkey?: string): number {
  return label.length + (hotkey === undefined ? 0 : hotkey.length + 2)
}

/**
 * Lays items of these widths out in lines `columns` wide, `gap` apart, as
 * many to a line as fit, in order: the indexes on each line. An item wider
 * than a line has a line of its own.
 */
export function linedUp(widths: readonly number[], columns: number, gap: number): number[][] {
  const lines: number[][] = []
  let used = 0
  widths.forEach((width, index) => {
    const line = lines[lines.length - 1]
    if (line !== undefined && used + gap + width <= columns) {
      line.push(index)
      used += gap + width
    } else {
      lines.push([index])
      used = width
    }
  })
  return lines
}

/** The roster footer's buttons. The overflow count's label is `+N`. */
export const OVERFLOW_HOTKEY = 'm'
export const SETTINGS_BUTTON = { label: 'Settings', hotkey: 'o' } as const
export const SQUISHYDEX_BUTTON = { label: 'Squishydex', hotkey: 'd' } as const
/** The widest overflow count the footer makes room for. */
const WIDEST_OVERFLOW = '+99'
/** Each footer button's columns, the overflow count at its widest. */
const FOOTER_WIDTHS = [
  buttonColumns(WIDEST_OVERFLOW, OVERFLOW_HOTKEY),
  buttonColumns(SETTINGS_BUTTON.label, SETTINGS_BUTTON.hotkey),
  buttonColumns(SQUISHYDEX_BUTTON.label, SQUISHYDEX_BUTTON.hotkey),
]

/**
 * The footer: the overflow count, Settings and the Squishydex. Docked, where
 * columns are plenty, it goes under the slots, FOOTER_ROW_GAP rows below
 * them, in as many rows as its buttons need at that width (`footerRows`),
 * FOOTER_BUTTON_GAP apart; inline, where rows are scarce, a column
 * FOOTER_COLUMNS wide beside them, FOOTER_COLUMN_GAP columns away, a button
 * to a row.
 */
export const FOOTER_ROW_GAP = 1
export const FOOTER_COLUMNS = Math.max(...FOOTER_WIDTHS)
export const FOOTER_COLUMN_GAP = 2
export const FOOTER_BUTTON_GAP = 2

/** The rows the docked footer takes in a pane this wide: its buttons lined up, budgeted with every one there. */
export function footerRows(bodyColumns: number): number {
  return linedUp(FOOTER_WIDTHS, bodyColumns, FOOTER_BUTTON_GAP).length
}

/** A mini squishy's picture in the band, in cells: half a picture across, two pixels down a cell. */
const MINI_COLUMNS = Math.floor(PICTURE_COLUMNS / 2)
const MINI_ROWS = Math.ceil(MINI_COLUMNS / 2)
/** The most of a squishy's Name the band shows. */
export const BAND_NAME_COLUMNS = 10
/**
 * The columns text takes in a terminal: an emoji (a shiny's ✨ among them)
 * takes two, any other character one.
 */
export function textColumns(text: string): number {
  return [...text].reduce((columns, character) => columns + (isWide(character) ? 2 : 1), 0)
}

function isWide(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return (code >= 0x2600 && code <= 0x27bf) || code >= 0x1f000
}

/** A Name cut to BAND_NAME_COLUMNS columns, ending in … when it's longer. */
export function nameCut(name: string): string {
  if (textColumns(name) <= BAND_NAME_COLUMNS) return name
  let cut = ''
  for (const character of name) {
    if (textColumns(cut + character) > BAND_NAME_COLUMNS - 1) break
    cut += character
  }
  return `${cut}…`
}

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
  /** Whether the partner has the first slot: it does whenever a slot fits. */
  partnerSlot: boolean
  /** The agents in slots, in slot order, after the partner's. */
  slots: A[]
  /** The agents with no slot, in the order they were first seen. */
  overflow: A[]
  /** How many slots go across a row. */
  columns: number
}

/**
 * Lays out the roster. The partner (its squishy), when there is one, is
 * pinned in the first slot, beyond the slot cap, which counts the agents'
 * slots; the agents share the rest. Agents keep the slots they had in `slotted` (the ids
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
  partner,
  ...size
}: RosterSize & { agents: readonly A[]; slotCap: number; slotted?: readonly string[]; partner?: A['squishy'] }): RosterLayout<A> {
  // The partner's slot comes on top of the cap
  const cap = partner !== undefined ? slotCap + 1 : slotCap
  const total = slotCount(size, cap)
  const partnerSlot = partner !== undefined && total > 0
  // The slots the agents share
  const count = partnerSlot ? total - 1 : total
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
  const showing = () => new Set([...(partnerSlot ? [partner.key] : []), ...[...slots, ...newcomers].map(agent => agent.squishy.key)])
  for (const agent of agents.filter(each => !holding.includes(each) && isEnded(each.state))) {
    if (free() > 0 && !showing().has(agent.squishy.key)) newcomers.push(agent)
  }
  // Newcomers to free slots take them in the order they were first seen
  slots.push(...agents.filter(agent => newcomers.includes(agent)))

  return { partnerSlot, slots, overflow: agents.filter(agent => !slots.includes(agent)), columns: slotsAcross(size, cap) }
}

/**
 * The squishys a roll must not repeat: every running agent's, since it may
 * take a slot at any time, and every one on screen (`onScreen`: the agents
 * in the roster's slots and any other the pane draws, as in the focus
 * view). An ended agent's squishy that is nowhere on screen goes back to
 * the pool. Before the pane first draws (`onScreen` undefined), every
 * agent's. And the partner's, which is never an agent's.
 */
export function liveSquishys<A extends RosterAgent>(
  agents: readonly A[],
  onScreen: readonly string[] | undefined,
  partner?: A['squishy'],
): A['squishy'][] {
  return [
    ...agents.filter(agent => onScreen === undefined || !isEnded(agent.state) || onScreen.includes(agent.id)).map(agent => agent.squishy),
    ...(partner !== undefined ? [partner] : []),
  ]
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
  return Math.min(slotCap, slotsThatFit(bodyColumns - (placement === 'inline' ? FOOTER_COLUMNS + FOOTER_COLUMN_GAP : 0)))
}

/** How many slots fit side by side in this many columns, with no cap. */
export function slotsThatFit(columns: number): number {
  return Math.max(0, Math.floor((columns + SLOT_COLUMN_GAP) / (SLOT_COLUMNS + SLOT_COLUMN_GAP)))
}

/** How many slots fit the pane, at most `slotCap`. */
function slotCount(size: RosterSize, slotCap: number): number {
  // Docked, the footer's rows and the gap above them come off the rows
  const room = size.bodyRows + SLOT_ROW_GAP - (size.placement === 'dock' ? footerRows(size.bodyColumns) + FOOTER_ROW_GAP : 0)
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
