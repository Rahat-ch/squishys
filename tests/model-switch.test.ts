import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, PARTNERED, drain, finishOf, spawnOf, stepOf, stubSessionStart, stubSpawns, stubStore } from './fixtures'

type Sent = { agentId: string | undefined; model: string; effort?: unknown }

// Stands in for Claude Code sending each model request, keeping the model
// and effort each one reached Claude Code with, by the loop it was made in
function sentRequests(on: On): Sent[] {
  const sent: Sent[] = []
  on('turn.step', async function* ($, e) {
    sent.push({ agentId: e.agentId, model: e.model, ...(e.effort !== undefined ? { effort: e.effort } : {}) })
    yield { kind: 'text', index: 0, text: 'Looking' } as const
    return { turnId: e.turnId, index: e.index, answer: 'Looking', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return sent
}

// Stands in for Claude Code's merged settings, which the test can change
function stubClaudeSettings(on: On, settings: Record<string, unknown> = {}): Record<string, unknown> {
  on('settings.read', () => ({ value: { ...settings } }))
  return settings
}

// Keeps each toast's text
function stubToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

// Spawns agent-1 and agent-2 with the store as `settings` left it, and opens
// agent-1's focus view
async function focusOnAgent($: Engine, on: On, settings?: Record<string, unknown>) {
  const stored = stubStore(on, settings === undefined ? PARTNERED : { ...PARTNERED, settings })
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return { ui, stored }
}

const SWITCH_ON = { slotCap: 9, liveModelSwitch: true }
const MODEL_KEY = 'model-switch-agent-1'

// Presses the focus view's model key `times` times
async function pressModelKey($: Engine, times = 1): Promise<void> {
  for (let press = 0; press < times; press += 1) await $.ui.press({ plugin: 'squishys', key: MODEL_KEY })
}

// What the model key is on and picks next, from its label
async function modelKey(ui: { find: (query: { type: 'Button'; key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return (await ui.find({ type: 'Button', key: MODEL_KEY }))?.props
}
const ORCHESTRATOR_STEP = { ...stepOf('agent-1'), agentId: undefined, turnId: 'turn-orchestrator' }

test('the live model switch is off by default, labeled experimental, and the focus view has no model key', async ($, on) => {
  const { ui } = await focusOnAgent($, on)
  expect(await modelKey(ui)).toBeUndefined()

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  const setting = await ui.find({ type: 'Button', key: 'liveModelSwitch' })
  expect(String(setting?.props.label)).toMatch(/^Experimental: .*  Off ▸ On$/)
})

test('turning the live model switch on is saved, and gives the focus view a model key, m', async ($, on) => {
  stubClaudeSettings(on)
  const { ui, stored } = await focusOnAgent($, on)
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.press({ plugin: 'squishys', key: 'liveModelSwitch' })
  expect(stored.get('settings')).toEqual(SWITCH_ON)

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await modelKey(ui)).toMatchObject({ hotkey: 'm', label: 'model  as started ▸ haiku' })
})

test('the model key steps through as started, haiku, sonnet, opus and fable, then back to as started', async ($, on) => {
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  const labels = [String((await modelKey(ui))?.label)]
  for (let press = 0; press < 5; press += 1) {
    await pressModelKey($)
    labels.push(String((await modelKey(ui))?.label))
  }

  expect(labels).toEqual([
    'model  as started ▸ haiku',
    'model  haiku ▸ sonnet',
    'model  sonnet ▸ opus',
    'model  opus ▸ fable',
    'model  fable ▸ as started',
    'model  as started ▸ haiku',
  ])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('a picked model is used by that agent’s next requests alone, without the old effort, and shown as switching, then switched', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await pressModelKey($, 2)
  expect(await ui.find({ type: 'Text', text: 'switching to sonnet…' })).toBeDefined()

  await drain($.turn.step({ ...stepOf('agent-1'), effort: 'high' }))
  await drain($.turn.step({ ...stepOf('agent-2'), effort: 'high' }))
  await drain($.turn.step(ORCHESTRATOR_STEP))
  await drain($.turn.step({ ...stepOf('agent-1'), index: 1 }))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: 'sonnet' },
    { agentId: 'agent-2', model: 'claude-opus-5-5', effort: 'high' },
    { agentId: undefined, model: 'claude-opus-5-5' },
    { agentId: 'agent-1', model: 'sonnet' },
  ])
  expect(await ui.find({ type: 'Text', text: 'sonnet (switched)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeUndefined()
  expect((await modelKey(ui))?.label).toBe('model  sonnet ▸ opus')
})

test('stepping back to "as started" undoes the switch', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await pressModelKey($, 5)
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('turning the live model switch off undoes every switch and takes the model key away', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui, stored } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelKey($, 3)

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  await $.ui.press({ plugin: 'squishys', key: 'liveModelSwitch' })
  await drain($.turn.step(stepOf('agent-1')))

  expect(stored.get('settings')).toEqual({ slotCap: 9 })
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await modelKey(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('with availableModels set, the model key steps only through the aliases it names', async ($, on) => {
  stubClaudeSettings(on, { availableModels: ['opus', 'Haiku', 'claude-sonnet-4-5'] })
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  const labels = [String((await modelKey(ui))?.label)]
  for (let press = 0; press < 3; press += 1) {
    await pressModelKey($)
    labels.push(String((await modelKey(ui))?.label))
  }
  expect(labels).toEqual(['model  as started ▸ haiku', 'model  haiku ▸ opus', 'model  opus ▸ as started', 'model  as started ▸ haiku'])
})

test('with availableModels naming no alias, there is no model key, and the focus view says why', async ($, on) => {
  stubClaudeSettings(on, { availableModels: ['claude-sonnet-4-5'] })
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  expect(await modelKey(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /availableModels/ })).toBeDefined()
})

test('a press skips the models availableModels stopped naming since the focus view was drawn', async ($, on) => {
  const sent = sentRequests(on)
  const settings = stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  expect((await modelKey(ui))?.label).toBe('model  as started ▸ haiku')

  settings.availableModels = ['opus']
  await pressModelKey($)
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'opus' }])
  expect(toasts).toEqual([])
})

test('a press for an agent that has ended switches nothing, and the focus view has no model key', async ($, on) => {
  stubClaudeSettings(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await $.turn.complete(finishOf('agent-1'))
  await pressModelKey($)

  expect(toasts).toEqual([expect.stringContaining('not switched to haiku')])
  expect(await modelKey(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('a switch availableModels stops naming ends before the next request, saying why', async ($, on) => {
  const sent = sentRequests(on)
  const settings = stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelKey($, 2)

  settings.availableModels = ['opus']
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  expect(toasts).toEqual([expect.stringContaining('availableModels')])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('a store that can no longer be read stops the rewrite', async ($, on) => {
  let storeDown = false
  on('store.get', { key: 'settings' }, ($, e, next) => (storeDown ? { deny: 'store unavailable' } : next(e)))
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  stubToasts(on)
  await focusOnAgent($, on, SWITCH_ON)
  await pressModelKey($, 2)

  storeDown = true
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
})

test('an agent’s switch ends with its run, and an ended agent has no model key', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelKey($, 2)

  await $.turn.complete(finishOf('agent-1'))
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  expect(await modelKey(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()

  // Resumed by a message, it starts on the model the engine picks
  await drain($.turn.step(stepOf('agent-1')))
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
})

test('/clear ends every switch', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  stubSessionStart(on)
  await focusOnAgent($, on, SWITCH_ON)
  await pressModelKey($, 2)

  await $.classic.SessionStart({ source: 'clear' })
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
})
