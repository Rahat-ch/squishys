import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Model } from '../types'
import { cycleLabel } from '../src/keys'
import { LIVE_MODEL_SWITCH_LABEL } from '../src/settings'
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
const MODEL_CONTROL = 'model-switch-agent-1'

// Presses the focus view's model control `times` times
async function pressModelControl($: Engine, times = 1): Promise<void> {
  for (let press = 0; press < times; press += 1) await $.ui.press({ plugin: 'squishys', key: MODEL_CONTROL })
}

// The model control, as drawn
async function modelControl(ui: Mounted<'terminal', 'Pane'>) {
  return (await ui.find({ type: 'Button', key: MODEL_CONTROL }))?.props
}

// The model control's label: on `now` (as started, or a model), then picking `next`
const stepLabel = (now: Model | undefined, next: Model | undefined, isAllowed = true) =>
  cycleLabel('model', now === undefined ? 'as started' : isAllowed ? now : `${now} (not allowed)`, next ?? 'as started')
// Draws agent-1's focus view again, as the user going back and picking it does
async function drawAgain($: Engine): Promise<void> {
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
}

const ORCHESTRATOR_STEP = { ...stepOf('agent-1'), agentId: undefined, turnId: 'turn-orchestrator' }

test('the live model switch is off by default, labeled experimental, and the focus view has no model control', async ($, on) => {
  const { ui } = await focusOnAgent($, on)
  expect(await modelControl(ui)).toBeUndefined()

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  const setting = await ui.find({ type: 'Button', key: 'liveModelSwitch' })
  expect(setting?.props.label).toBe(cycleLabel(LIVE_MODEL_SWITCH_LABEL, 'Off', 'On'))
  expect(LIVE_MODEL_SWITCH_LABEL).toMatch(/^Experimental/)
})

test('turning the live model switch on is saved, and gives the focus view a model control, m', async ($, on) => {
  stubClaudeSettings(on)
  const { ui, stored } = await focusOnAgent($, on)
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.press({ plugin: 'squishys', key: 'liveModelSwitch' })
  expect(stored.get('settings')).toEqual(SWITCH_ON)

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await modelControl(ui)).toMatchObject({ hotkey: 'm', label: stepLabel(undefined, 'haiku') })
})

test('the model control steps through as started, haiku, sonnet, opus and fable, then back to as started', async ($, on) => {
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  const labels = [String((await modelControl(ui))?.label)]
  for (let press = 0; press < 5; press += 1) {
    await pressModelControl($)
    labels.push(String((await modelControl(ui))?.label))
  }

  expect(labels).toEqual([
    stepLabel(undefined, 'haiku'),
    stepLabel('haiku', 'sonnet'),
    stepLabel('sonnet', 'opus'),
    stepLabel('opus', 'fable'),
    stepLabel('fable', undefined),
    stepLabel(undefined, 'haiku'),
  ])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('a picked model is used by that agent’s next requests alone, without the old effort, and shown as switching, then switched', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await pressModelControl($, 2)
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
  expect((await modelControl(ui))?.label).toBe(stepLabel('sonnet', 'opus'))
})

test('stepping back to "as started" undoes the switch', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await pressModelControl($, 5)
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('turning the live model switch off undoes every switch and takes the model control away', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui, stored } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelControl($, 3)

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  await $.ui.press({ plugin: 'squishys', key: 'liveModelSwitch' })
  await drain($.turn.step(stepOf('agent-1')))

  expect(stored.get('settings')).toEqual({ slotCap: 9 })
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await modelControl(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('with availableModels set, the model control steps only through the aliases it names', async ($, on) => {
  stubClaudeSettings(on, { availableModels: ['opus', 'Haiku', 'claude-sonnet-4-5'] })
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  const labels = [String((await modelControl(ui))?.label)]
  for (let press = 0; press < 3; press += 1) {
    await pressModelControl($)
    labels.push(String((await modelControl(ui))?.label))
  }
  expect(labels).toEqual([stepLabel(undefined, 'haiku'), stepLabel('haiku', 'opus'), stepLabel('opus', undefined), stepLabel(undefined, 'haiku')])
})

test('with availableModels naming no alias, there is no model control, and the focus view says why', async ($, on) => {
  stubClaudeSettings(on, { availableModels: ['claude-sonnet-4-5'] })
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  expect(await modelControl(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /availableModels/ })).toBeDefined()
})

test('a press for a model availableModels stopped naming since the control was drawn is refused, saying why, and the next press steps on', async ($, on) => {
  const sent = sentRequests(on)
  const settings = stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  expect((await modelControl(ui))?.label).toBe(stepLabel(undefined, 'haiku'))

  settings.availableModels = ['opus']
  await pressModelControl($)
  expect(toasts).toEqual([expect.stringContaining('not switched to haiku')])
  expect(toasts[0]).toContain('availableModels')
  await drain($.turn.step(stepOf('agent-1')))
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])

  // Drawn again, the control offers what the allowlist names now
  await drawAgain($)
  expect((await modelControl(ui))?.label).toBe(stepLabel(undefined, 'opus'))
  await pressModelControl($)
  await drain($.turn.step({ ...stepOf('agent-1'), index: 1 }))
  expect(sent).toEqual([
    { agentId: 'agent-1', model: 'claude-opus-5-5' },
    { agentId: 'agent-1', model: 'opus' },
  ])
})

test('a switched model availableModels no longer names shows so, and the next press steps from it in model order', async ($, on) => {
  const settings = stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelControl($, 2)
  expect((await modelControl(ui))?.label).toBe(stepLabel('sonnet', 'opus'))

  settings.availableModels = ['haiku', 'fable']
  await drawAgain($)
  expect((await modelControl(ui))?.label).toBe(stepLabel('sonnet', 'fable', false))
  expect(String((await modelControl(ui))?.label)).toContain('sonnet (not allowed)')

  await pressModelControl($)
  expect(await ui.find({ type: 'Text', text: 'switching to fable…' })).toBeDefined()
  expect((await modelControl(ui))?.label).toBe(stepLabel('fable', undefined))
})

test('a press for an agent that has ended switches nothing, and the focus view has no model control', async ($, on) => {
  stubClaudeSettings(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await $.turn.complete(finishOf('agent-1'))
  await pressModelControl($)

  expect(toasts).toEqual([expect.stringContaining('not switched to haiku')])
  expect(await modelControl(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('a switch availableModels stops naming ends before the next request, saying why', async ($, on) => {
  const sent = sentRequests(on)
  const settings = stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelControl($, 2)

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
  await pressModelControl($, 2)

  storeDown = true
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
})

test('an agent’s switch ends with its run, and an ended agent has no model control', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressModelControl($, 2)

  await $.turn.complete(finishOf('agent-1'))
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  expect(await modelControl(ui)).toBeUndefined()
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
  await pressModelControl($, 2)

  await $.classic.SessionStart({ source: 'clear' })
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
})

// Effort: the focus view's effort control, behind the same setting

const EFFORT_CONTROL = 'effort-switch-agent-1'

// Presses the focus view's effort control `times` times
async function pressEffortControl($: Engine, times = 1): Promise<void> {
  for (let press = 0; press < times; press += 1) await $.ui.press({ plugin: 'squishys', key: EFFORT_CONTROL })
}

// The effort control, as drawn
async function effortControl(ui: Mounted<'terminal', 'Pane'>) {
  return (await ui.find({ type: 'Button', key: EFFORT_CONTROL }))?.props
}

const effortLabel = (now: string, next: string) => cycleLabel('effort', now, next)

test('the effort control, e, steps through as started, low, medium, high, xhigh and max, then back to as started', async ($, on) => {
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  expect(await effortControl(ui)).toMatchObject({ hotkey: 'e' })
  const labels = [String((await effortControl(ui))?.label)]
  for (let press = 0; press < 6; press += 1) {
    await pressEffortControl($)
    labels.push(String((await effortControl(ui))?.label))
  }

  expect(labels).toEqual([
    effortLabel('as started', 'low'),
    effortLabel('low', 'medium'),
    effortLabel('medium', 'high'),
    effortLabel('high', 'xhigh'),
    effortLabel('xhigh', 'max'),
    effortLabel('max', 'as started'),
    effortLabel('as started', 'low'),
  ])
})

test('a picked effort is carried by that agent’s next requests alone', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await pressEffortControl($, 4)
  await drain($.turn.step({ ...stepOf('agent-1'), effort: 'medium' }))
  await drain($.turn.step({ ...stepOf('agent-2'), effort: 'medium' }))
  await drain($.turn.step({ ...ORCHESTRATOR_STEP, effort: 'medium' }))
  await drain($.turn.step({ ...stepOf('agent-1'), index: 1, effort: 'medium' }))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'xhigh' },
    { agentId: 'agent-2', model: 'claude-opus-5-5', effort: 'medium' },
    { agentId: undefined, model: 'claude-opus-5-5', effort: 'medium' },
    { agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'xhigh' },
  ])
  expect((await effortControl(ui))?.label).toBe(effortLabel('xhigh', 'max'))
})

test('a model without effort is sent none: the control says effort n/a, and a press sets nothing, saying why', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressEffortControl($)

  // The engine leaves the effort out for a model that takes none
  await drain($.turn.step(stepOf('agent-1')))
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  expect((await effortControl(ui))?.label).toBe('effort n/a')

  await pressEffortControl($)
  expect(toasts).toEqual([expect.stringContaining('takes none')])
  await drain($.turn.step({ ...stepOf('agent-1'), index: 1 }))
  expect(sent).toEqual([
    { agentId: 'agent-1', model: 'claude-opus-5-5' },
    { agentId: 'agent-1', model: 'claude-opus-5-5' },
  ])
})

test('an effort and a model switch compose: a switched model is sent no effort, and the effort comes back with the model it started on', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressEffortControl($, 5)

  await pressModelControl($, 2)
  expect((await effortControl(ui))?.label).toBe('effort n/a')
  await drain($.turn.step({ ...stepOf('agent-1'), effort: 'high' }))

  await pressModelControl($, 3)
  expect((await effortControl(ui))?.label).toBe(effortLabel('max', 'as started'))
  await drain($.turn.step({ ...stepOf('agent-1'), index: 1, effort: 'high' }))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: 'sonnet' },
    { agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'max' },
  ])
})

test('an effort switch ends with the agent’s run, and an ended agent has no effort control', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressEffortControl($, 2)

  await $.turn.complete(finishOf('agent-1'))
  expect(await effortControl(ui)).toBeUndefined()

  // Resumed by a message, it starts on the effort the engine picks
  await drain($.turn.step({ ...stepOf('agent-1'), effort: 'high' }))
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'high' }])
})

test('turning the live model switch off ends every effort switch and takes the effort control away', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)
  await pressEffortControl($, 2)

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  await $.ui.press({ plugin: 'squishys', key: 'liveModelSwitch' })
  await drain($.turn.step({ ...stepOf('agent-1'), effort: 'high' }))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'high' }])
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await effortControl(ui)).toBeUndefined()
})

for (const source of ['clear', 'resume'] as const) {
  test(`/${source} ends every effort switch`, async ($, on) => {
    const sent = sentRequests(on)
    stubClaudeSettings(on)
    stubSessionStart(on)
    await focusOnAgent($, on, SWITCH_ON)
    await pressEffortControl($, 2)

    await $.classic.SessionStart({ source })
    await drain($.turn.step({ ...stepOf('agent-1'), effort: 'high' }))

    expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'high' }])
  })
}

test('a store that can no longer be read stops the effort rewrite', async ($, on) => {
  let storeDown = false
  on('store.get', { key: 'settings' }, ($, e, next) => (storeDown ? { deny: 'store unavailable' } : next(e)))
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const toasts = stubToasts(on)
  await focusOnAgent($, on, SWITCH_ON)
  await pressEffortControl($, 2)

  storeDown = true
  await drain($.turn.step({ ...stepOf('agent-1'), effort: 'high' }))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5', effort: 'high' }])
  expect(toasts).toEqual([expect.stringContaining('back to the effort it started on')])
})
