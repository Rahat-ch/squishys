// Inputs Claude Code would hand the mod, shared by the test files.

import type { AgentStatus, On } from 'claude-code'

import { PANE_ID } from '../src/pane'

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

// Answers each agent.spawn as Claude Code would, with ids agent-1, agent-2…
export function stubSpawns(on: On): void {
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

// One model request inside the agent's loop, as the engine raises turn.step
export function stepOf(agentId: string) {
  return { turnId: `turn-${agentId}`, index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId } as const
}

// The end of the agent's run, as the engine raises turn.complete
export function finishOf(agentId: string, reason: 'answer' | 'error' | 'aborted' = 'answer') {
  const answer = 'Found it in src/config.ts'
  return { answer, durationMs: 4000, isAborted: reason === 'aborted', turnId: `turn-${agentId}`, agentId, reason } as const
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

// Stands in for `$.agent.list()`: each agent's status, as the test sets it
export function stubAgentList(on: On, statuses: Map<string, AgentStatus>): void {
  on('agent.list', () => ({
    value: [...statuses].map(([id, status]) => ({ id, description: 'Find config parser', type: 'general-purpose', status })),
  }))
}

// Stands in for the terminal taking each `$.ui.blit`, keeping each one's
// Raster key and cells
export function stubBlits(on: On): { key: string; cells: string }[] {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', ($, e) => {
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
