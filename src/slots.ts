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
/** The narrowest a slot is, so its Name has room even beside a small picture. */
export const SLOT_MIN_COLUMNS = 14
/**
 * A slot's width: its squishy's picture, centered, but at least
 * SLOT_MIN_COLUMNS. A Name too long for it is cut to fit (`slotLabel`); the
 * focus view and the Squishydex card show it whole.
 */
export const SLOT_COLUMNS = Math.max(PICTURE_COLUMNS, SLOT_MIN_COLUMNS)
/** A slot's lines: its Name, its description and a row for the mark on the squishy of the agent open in the main view. */
const SLOT_LINES = 3
/** A slot's height: the picture, then its lines. */
export const SLOT_ROWS = PICTURE_ROWS + SLOT_LINES
/** A mini squishy's picture, in cells: half a picture across, two pixels down a cell. */
const MINI_COLUMNS = Math.floor(PICTURE_COLUMNS / 2)
const MINI_ROWS = Math.ceil(MINI_COLUMNS / 2)
/**
 * A mini slot, for an inline pane too short for a full one: the mini
 * picture, then MINI_SLOT_GAP columns, then the slot's lines in a column
 * as wide as a slot, so its Name is cut the same (`slotLabel`).
 */
export const MINI_SLOT_GAP = 1
export const MINI_SLOT_COLUMNS = MINI_COLUMNS + MINI_SLOT_GAP + SLOT_COLUMNS
export const MINI_SLOT_ROWS = Math.max(MINI_ROWS, SLOT_LINES)
/**
 * How a roster slot is drawn: `full`, the picture over the slot's lines;
 * `mini`, the mini picture beside them; `name`, the Name alone, a row high.
 */
export type SlotSize = 'full' | 'mini' | 'name'
const SLOT_SIZES: Readonly<Record<SlotSize, { columns: number; rows: number }>> = {
  full: { columns: SLOT_COLUMNS, rows: SLOT_ROWS },
  mini: { columns: MINI_SLOT_COLUMNS, rows: MINI_SLOT_ROWS },
  name: { columns: SLOT_COLUMNS, rows: 1 },
}
/**
 * The slot sizes a pane tries, largest first. Inline, where Claude Code
 * gives the pane only the rows the layout spares (3 at times, seen for
 * #55), slots shrink before they go; docked, rows are plenty.
 */
const SLOT_SIZES_TRIED: Readonly<Record<RosterSize['placement'], readonly SlotSize[]>> = {
  dock: ['full'],
  inline: ['full', 'mini', 'name'],
}
/** The columns between slots side by side. */
export const SLOT_COLUMN_GAP = 2
/** The rows between rows of slots. */
export const SLOT_ROW_GAP = 1
/**
 * Where characters take two columns, as [first, last] code points: the
 * symbols below U+1F000 that are drawn as emoji by default (Unicode's
 * Emoji_Presentation), the East Asian wide and fullwidth blocks, and the
 * emoji and pictograph planes from U+1F000 on.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x3fffd],
]

/**
 * The columns a Button takes as drawn: its label (in terminal columns, see
 * textColumns), after the `x: ` its hotkey draws before it.
 */
export function buttonColumns(label: string, hotkey?: string): number {
  return textColumns(label) + (hotkey === undefined ? 0 : textColumns(hotkey) + 2)
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

/** The most of a squishy's Name the band shows. */
export const BAND_NAME_COLUMNS = 10
/**
 * The columns text takes in a terminal: an emoji drawn as one (a shiny's ✨
 * among them) or an East Asian wide character takes two, any other
 * character one (✓, ★, ✶ and the rest of the symbols drawn as text).
 */
export function textColumns(text: string): number {
  return [...text].reduce((columns, character) => columns + (isWide(character) ? 2 : 1), 0)
}

function isWide(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return WIDE.some(([first, last]) => code >= first && code <= last)
}

/**
 * A Name cut to `columns` terminal columns (BAND_NAME_COLUMNS unless given),
 * ending in … when it's longer.
 */
export function nameCut(name: string, columns: number = BAND_NAME_COLUMNS): string {
  if (textColumns(name) <= columns) return name
  let cut = ''
  for (const character of name) {
    if (textColumns(cut + character) > columns - 1) break
    cut += character
  }
  return `${cut}…`
}

/**
 * A roster slot's button label: its Name, cut so the button, `x: ` hotkey
 * and all, fits the slot's SLOT_COLUMNS.
 */
export function slotLabel(name: string, hotkey?: string): string {
  return nameCut(name, SLOT_COLUMNS - buttonColumns('', hotkey))
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
  /** How the slots are drawn. */
  slotSize: SlotSize
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
 * order they were first seen. Slots are drawn at the largest size that
 * shows the partner and an agent (SLOT_SIZES_TRIED), else at the smallest.
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
  // Enough slots for the partner and an agent, as far as there are both
  const wanted = Math.min(cap, Math.max(1, (partner !== undefined ? 1 : 0) + Math.min(1, agents.length)))
  const tried = SLOT_SIZES_TRIED[size.placement]
  const slotSize = tried.find(each => slotCount(size, cap, each) >= wanted) ?? tried[tried.length - 1] ?? 'full'
  const total = slotCount(size, cap, slotSize)
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

  return { partnerSlot, slots, overflow: agents.filter(agent => !slots.includes(agent)), columns: slotsAcross(size, cap, slotSize), slotSize }
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

/** How many slots of this size fit across the pane, at most `slotCap`. */
function slotsAcross({ placement, bodyColumns }: RosterSize, slotCap: number, slotSize: SlotSize): number {
  // Inline, the footer and the gap before it come off the columns
  const columns = bodyColumns - (placement === 'inline' ? FOOTER_COLUMNS + FOOTER_COLUMN_GAP : 0)
  return Math.min(slotCap, slotsThatFit(columns, SLOT_SIZES[slotSize].columns))
}

/** How many slots (full ones unless said) fit side by side in this many columns, with no cap. */
export function slotsThatFit(columns: number, slotColumns: number = SLOT_COLUMNS): number {
  return Math.max(0, Math.floor((columns + SLOT_COLUMN_GAP) / (slotColumns + SLOT_COLUMN_GAP)))
}

/** How many slots of this size fit the pane, at most `slotCap`. */
function slotCount(size: RosterSize, slotCap: number, slotSize: SlotSize): number {
  // Docked, the footer's rows and the gap above them come off the rows
  const room = size.bodyRows + SLOT_ROW_GAP - (size.placement === 'dock' ? footerRows(size.bodyColumns) + FOOTER_ROW_GAP : 0)
  const down = Math.max(0, Math.floor(room / (SLOT_SIZES[slotSize].rows + SLOT_ROW_GAP)))
  return Math.min(slotCap, slotsAcross(size, slotCap, slotSize) * down)
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
