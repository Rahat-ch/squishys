// Inputs Claude Code would hand the mod, shared by the test files.

import type { AgentStatus, On, PaneOpenArgs } from 'claude-code'
import type { Mounted } from 'claude-code/testing'

import { KIT } from '../src/kit'
import { PANE_ID } from '../src/pane'
import { PARTNER_KEY } from '../src/partner'
import { FOOTER_COLUMN_GAP, FOOTER_COLUMNS, FOOTER_ROW_GAP, SLOT_COLUMN_GAP, SLOT_COLUMNS, SLOT_ROWS, SLOT_ROW_GAP, footerRows } from '../src/slots'
import type { RosterSize } from '../src/slots'
import { speciesSquishy } from '../src/roller'
import type { ForcedRoll } from '../src/roller'
import { SQUISHYDEX_KEY, squishydexFrom, withMet } from '../src/squishydex-record'

// What Claude Code passes to the pane's ui.render hook, apart from the surface
export const PANE = {
  plugin: 'squishys',
  component: 'Pane',
  requestId: PANE_ID,
  viewport: { columns: 160, rows: 40, isFullscreen: true },
  props: {
    title: 'Squishys',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Stands in for Claude Code's panes: which ids are open, whether each is
// placed and has the keyboard. It places an unasked open only on a wide
// terminal (`wide`, the default) and leaves it unplaced otherwise; an open
// the user asked for (from the hook of a command they typed, or a press) is
// placed at any width: the test sets `asking` around such an act. An open
// with `focus` gets the keyboard, as over an empty prompt; a test takes it
// back (the user's Esc or typing) or gives it (ctrl+x tab, a click) through
// `panes`. With `unplaced`, the pane starts open and unplaced, as an earlier
// open left it; with `refusal`, an open the user asked for is refused so.
// Reads back every open asked for.
export type PanesStub = {
  opens: PaneOpenArgs[]
  asking: boolean
  panes: Map<string, { isPlaced: boolean; isFocused: boolean }>
}
export function stubPanes(on: On, { wide = true, unplaced = false, refusal }: { wide?: boolean; unplaced?: boolean; refusal?: string } = {}): PanesStub {
  const stub: PanesStub = { opens: [], asking: false, panes: new Map(unplaced ? [[PANE_ID, { isPlaced: false, isFocused: false }]] : []) }
  on('ui.panes', () => ({
    value: [...stub.panes].map(([id, pane]) => ({ id, title: id, isShown: true, ...pane })),
  }))
  on('ui.open', ($, e) => {
    stub.opens.push(e)
    if (stub.asking && refusal !== undefined) return { deny: refusal }
    const was = stub.panes.get(e.id)
    const isPlaced = wide || stub.asking || was?.isPlaced === true
    stub.panes.set(e.id, { isPlaced, isFocused: (isPlaced && e.focus === true) || was?.isFocused === true })
    return { value: isPlaced ? { isPlaced } : { isPlaced, reason: 'An unasked pane needs 144 columns; the terminal has 100' } }
  })
  on('ui.close', ($, e) => {
    stub.panes.delete(e.id)
    return { value: undefined }
  })
  return stub
}

// The label of the pane control keyed `key` (its element key), as drawn
export async function controlLabel(ui: Mounted<'terminal', 'Pane'>, key: string): Promise<unknown> {
  return (await ui.find({ type: 'Button', key }))?.props.label
}

// A pane body with just room for `across` by `down` slots, plus `spare`
// columns and rows (negative for short of it): slots SLOT_COLUMN_GAP
// columns and SLOT_ROW_GAP rows apart, and the footer (+N, Settings,
// Squishydex) FOOTER_ROW_GAP under them docked, in the rows its buttons
// need at that width, or FOOTER_COLUMN_GAP beside them inline.
export function roomFor(placement: RosterSize['placement'], across: number, down: number, spare = { columns: 0, rows: 0 }): RosterSize {
  const slotColumns = across * SLOT_COLUMNS + (across - 1) * SLOT_COLUMN_GAP
  const bodyColumns = slotColumns + (placement === 'inline' ? FOOTER_COLUMN_GAP + FOOTER_COLUMNS : 0) + spare.columns
  const footerRowCount = placement === 'inline' ? 0 : FOOTER_ROW_GAP + footerRows(bodyColumns)
  return { placement, bodyColumns, bodyRows: down * SLOT_ROWS + (down - 1) * SLOT_ROW_GAP + footerRowCount + spare.rows }
}

// The pane's render input at another size: where Claude Code seated it, and
// the cells across and the rows down its body has
export function paneSized({ placement, bodyColumns, bodyRows }: RosterSize) {
  return { ...PANE, props: { ...PANE.props, placement, bodyColumns, scroll: { offset: 0, bodyRows } } }
}

// What a store holds once the user has picked a partner (the kit's first
// starter, in the first palette), with the partner in the Squishydex, as
// picking it leaves it: a test that starts a session without one gets the
// starter pick
const STARTER = KIT.starters[0] && speciesSquishy(KIT, KIT.starters[0], KIT.palettes[0]?.id)
export const PARTNERED: Readonly<Record<string, unknown>> = {
  [PARTNER_KEY]: { ...KIT.starters[0], palette: KIT.palettes[0]?.id },
  [SQUISHYDEX_KEY]: withMet(squishydexFrom(undefined), STARTER ? [STARTER] : [], 0),
}

// Forces what the mod's rolls come up as, through SQUISHYS_FORCE_ROLL
// (docs/adr/0002-forced-rolls-env-seam.md): the mod's randomness can't be
// seeded from a test, and a stray shiny would sparkle, toast and chime in
// a test about something else. stubSpawns and stubSessionStart force plain
// rolls unless a test asks for a Moment. A plugin hooks an event once, so
// the first call answers the variable and a later one that names a roll
// changes it; the test can change it too, through what this returns.
const forcedRolls = new WeakMap<On, { roll: ForcedRoll }>()
export function forceRolls(on: On, roll?: ForcedRoll): { roll: ForcedRoll } {
  const forced = forcedRolls.get(on)
  if (forced !== undefined) {
    if (roll !== undefined) forced.roll = roll
    return forced
  }
  const answer = { roll: roll ?? 'plain' }
  forcedRolls.set(on, answer)
  on('env.get', ($, e) => ({ value: e.name === 'SQUISHYS_FORCE_ROLL' ? answer.roll : undefined }))
  return answer
}

// Answers each agent.spawn as Claude Code would, with ids agent-1, agent-2…,
// and forces the rolls (forceRolls)
export function stubSpawns(on: On, roll?: ForcedRoll): void {
  forceRolls(on, roll)
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `agent-${++spawned}` }))
}

// A mock of the mod's store, kept between sessions, that the test can read
// back. It starts with `entries`, as a store an earlier session left.
export function stubStore(on: On, entries: Record<string, unknown> = {}): Map<string, unknown> {
  const stored = new Map(Object.entries(entries))
  on('store.get', ($, e) => ({ value: stored.get(e.key) }))
  on('store.set', ($, e) => {
    // A store holds JSON, so it hands back a copy, not the object it was given
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return stored
}

// The glyph of every cell in a Raster's packed `cells`
export function glyphsOf(cells: unknown): string[] {
  const bytes = atob(String(cells))
  const glyphs: string[] = []
  for (let at = 0; at < bytes.length; at += 12) {
    let codePoint = 0
    for (let byte = 3; byte >= 0; byte -= 1) codePoint = codePoint * 256 + bytes.charCodeAt(at + byte)
    glyphs.push(String.fromCodePoint(codePoint))
  }
  return glyphs
}

// The full agent.spawn input, as the Agent tool hands it to the hooks
export function spawnOf(toolUseId: string) {
  return {
    tool_use_id: toolUseId,
    prompt: 'Find where the config is parsed',
    description: 'Find config parser',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as const
}

// A Read the agent with this id makes from inside its own loop. The kit's
// `$.tool.call` arguments don't list `agentId` (a plugin's own call never
// sets it), but the engine carries it to the hooks as a subagent's call does.
export function readFrom(agentId: string, filePath: string) {
  return { tool: 'Read', file_path: filePath, agentId } as const
}

// A Bash command the agent with this id runs from inside its own loop, as readFrom
export function bashFrom(agentId: string, command: string) {
  return { tool: 'Bash', command, agentId } as const
}

// One model request inside the agent's loop, as the engine raises turn.step
export function stepOf(agentId: string) {
  return { turnId: `turn-${agentId}`, index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId } as const
}

// The end of the agent's run, as the engine raises turn.complete
export function finishOf(agentId: string, reason: 'answer' | 'error' | 'aborted' = 'answer') {
  const answer = 'Found it in src/config.ts'
  return { answer, durationMs: 4000, isAborted: reason === 'aborted', turnId: `turn-${agentId}`, agentId, reason } as const
}

// Reads a stream to its end, as Claude Code does a model response
export async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream);
}

// PermissionRequest, as Claude Code raises it before asking the user about a
// Bash call. `agent_id` is there only when it fires from inside an agent.
export function permissionRequestFrom(agentId?: string) {
  return {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    ...(agentId === undefined ? {} : { agent_id: agentId, agent_type: 'general-purpose' }),
  }
}

// Stands in for Claude Code streaming each model response (a piece of text,
// then the stop) and ending each turn
export function stubTurns(on: On): void {
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'Looking' } as const
    return { turnId: e.turnId, index: e.index, answer: 'Looking', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
}

// One agent as `$.agent.list()` names it, less its type
export type ListedAgent = { id: string; description: string; status: AgentStatus }

// Stands in for `$.agent.list()`: each agent's status, as the test sets it
// (a Map the test may change), or these agents with their own descriptions.
// Reads back how many times the list was asked for.
export function stubAgentList(on: On, agents: Map<string, AgentStatus> | readonly ListedAgent[]): () => number {
  let lookups = 0
  on('agent.list', () => {
    lookups += 1
    const listed = agents instanceof Map ? [...agents].map(([id, status]) => ({ id, description: 'Find config parser', status })) : agents
    return { value: listed.map(agent => ({ ...agent, type: 'general-purpose' })) }
  })
  return () => lookups
}

// What Claude Code answers classic.SessionStart with, beneath the mod, and
// forces the rebuild's fresh rolls (forceRolls)
export function stubSessionStart(on: On, roll?: ForcedRoll): void {
  forceRolls(on, roll)
  on('classic.SessionStart', () => ({}))
}

// Stands in for the terminal taking each `$.ui.blit`, keeping each one's
// Raster key and cells. It refuses those to the keys in `refused`, as for a
// Raster no longer mounted, and keeps nothing of them.
export function stubBlits(on: On, refused: readonly string[] = []): { key: string; cells: string }[] {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', ($, e) => {
    if (refused.includes(e.key)) return { value: { deny: `${e.key} is not mounted` } }
    if ('cells' in e) blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  return blits
}

// The user typing /squishys at the prompt of a fullscreen terminal
export const SQUISHYS_COMMAND = {
  command: 'squishys',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

// The user typing /squishydex at the prompt of a fullscreen terminal
export const SQUISHYDEX_COMMAND = {
  command: 'squishydex',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

// The hover styles of the element keyed `key` in a mounted drawing, as drawn.
// `find` leaves an element's hover out (it lies beside its props), so this
// walks the tree `drawn()` returns.
export async function hoverOf(ui: { drawn: () => Promise<unknown> }, key: string): Promise<unknown> {
  type Drawn = { props?: { key?: unknown }; hover?: unknown; children?: unknown[] }
  const search = (node: unknown): Drawn | undefined => {
    if (typeof node !== 'object' || node === null) return undefined
    const element = node as Drawn
    if (element.props?.key === key) return element
    for (const child of element.children ?? []) {
      const found = search(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  const found = search(await ui.drawn())
  if (found === undefined) throw new Error(`Nothing drawn is keyed ${key}`)
  return found.hover
}
