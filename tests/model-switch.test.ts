// The next run's model and effort: the focus view's model control (m) and
// effort control (e) pick, for one agent, what its next run uses (AGENTS.md,
// "The next run's model and effort").

import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { relayPrompt } from '../src/focus'
import { cycleLabel } from '../src/keys'
import { NEXT_RUN_NOTE_ENDED, NEXT_RUN_NOTE_RUNNING, NO_EFFORT_TAKEN, NO_OTHER_MODEL, familyOf, modelIds, offeredModels } from '../src/model-switch'
import { fromUser } from '../src/resumes'
import { PANE, PARTNERED, appendRow, drain, finishOf, forceRolls, promptRowOf, spawnOf, stepOf, stubSessionStart, stubStore } from './fixtures'

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

// Full model ids as Claude Code names them: what the mod learns each
// model's id from (it never names one itself)
const OPUS = 'claude-opus-5-5'
const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-5-20250929'

// The orchestrator's request on opus, with the session's effort
const ORCHESTRATOR_STEP = { ...stepOf('agent-1'), agentId: undefined, turnId: 'turn-orchestrator', effort: 'high' } as const

// A request of agent-2's run, on haiku, which takes no effort
const AGENT_TWO_STEP = { ...stepOf('agent-2'), model: HAIKU } as const

// A request of agent-1's run number `run` (1 is the run it was spawned
// for), on the model it started on, opus, with the session's effort
const runStep = (run: number, index = 0) => ({ ...stepOf('agent-1'), turnId: `turn-agent-1-${run}`, index, effort: 'high' }) as const

// Claude Code's main model is opus, and each spawn starts on the next of
// `models`: agent-1 on opus, agent-2 on haiku, agent-3 on sonnet
function stubModels(on: On, models: readonly string[] = [OPUS, HAIKU, SONNET]): void {
  on('session.model', () => ({ value: OPUS }))
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1
    return { model: models[spawned - 1] ?? OPUS, agentId: `agent-${spawned}` }
  })
  forceRolls(on)
}

// Spawns an agent for each of `models` and opens agent-1's focus view
async function focusOnAgent($: Engine, on: On, models?: readonly string[]) {
  stubStore(on, PARTNERED)
  stubModels(on, models)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  for (let at = 1; at <= (models ?? [OPUS, HAIKU, SONNET]).length; at += 1) await $.agent.spawn(spawnOf(`toolu_${at}`))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return ui
}

// The session's requests so far: the orchestrator's on opus (with an
// effort), agent-2's on haiku (none) and agent-3's on sonnet (an effort),
// so the mod knows which models take one; then agent-1's focus view is
// drawn again, as the user sees it before pressing
async function modelsUsed($: Engine): Promise<void> {
  await drain($.turn.step(ORCHESTRATOR_STEP))
  await drain($.turn.step(AGENT_TWO_STEP))
  await drain($.turn.step({ ...stepOf('agent-3'), model: SONNET, effort: 'high' }))
  await drawAgain($)
}

// agent-1's run ends: its squishy is Asleep
async function finishRun($: Engine, run = 1): Promise<void> {
  await $.turn.complete({ ...finishOf('agent-1'), turnId: `turn-agent-1-${run}` })
}

const MODEL_CONTROL = 'model-switch-agent-1'
const EFFORT_CONTROL = 'effort-switch-agent-1'

async function press($: Engine, key: string, times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) await $.ui.press({ plugin: 'squishys', key })
}

async function labelOf(ui: Mounted<'terminal', 'Pane'>, key: string): Promise<string | undefined> {
  const label = (await ui.find({ type: 'Button', key }))?.props.label
  return label === undefined ? undefined : String(label)
}

const modelLabel = (now: string, next: string) => cycleLabel('next run', now, next)
const effortLabel = (now: string, next: string) => cycleLabel('next run effort', now, next)

// Draws agent-1's focus view again, as the user going back and picking it does
async function drawAgain($: Engine): Promise<void> {
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
}

// The user typing a redirect into the focus view and pressing Enter
async function typeRedirect($: Engine, text: string): Promise<void> {
  await $.ui.input({ plugin: 'squishys', key: 'redirect', text, kind: 'change' })
  await $.ui.input({ plugin: 'squishys', key: 'redirect', text })
}

test('model ids: an id is of the model a whole segment of it names, before one it only holds', () => {
  expect(familyOf('claude-opus-5-5[1m]')).toBe('opus')
  expect(familyOf('claude-sonnet-4-5-haikuish')).toBe('sonnet')
  expect(familyOf('claude-haikuish')).toBe('haiku')
  expect(familyOf('gpt-5')).toBeUndefined()
})

test('model ids: a pick is sent as the agent’s own id for its model, else the main model’s, else another agent’s, never a request’s alone', () => {
  const longOpus = 'claude-opus-5-5[1m]'
  // An agent started on the 1M-context opus keeps it; the main model's opus is the other's
  expect(modelIds({ own: longOpus, main: OPUS, others: [HAIKU] })).toEqual({ opus: longOpus, haiku: HAIKU })
  expect(modelIds({ own: HAIKU, main: OPUS, others: [longOpus, SONNET] })).toEqual({ opus: OPUS, haiku: HAIKU, sonnet: SONNET })
  // Of two other agents on one model, the latest
  expect(modelIds({ others: [SONNET, 'claude-sonnet-4-6'] })).toEqual({ sonnet: 'claude-sonnet-4-6' })
  // A fallback's id, seen only on a request, is in no source
  expect(offeredModels({ own: HAIKU, main: OPUS, others: [] }, undefined)).toEqual(['opus'])
  // availableModels allows a model by its alias or its exact id
  expect(offeredModels({ own: OPUS, others: [HAIKU, SONNET] }, ['Haiku'])).toEqual(['haiku'])
  expect(offeredModels({ own: OPUS, others: [HAIKU, SONNET] }, [SONNET])).toEqual(['sonnet'])
})

test('with no setting, the focus view always has the model control, m, and the effort control, e, while the agent runs and once it is Asleep', async ($, on) => {
  stubClaudeSettings(on)
  const ui = await focusOnAgent($, on)

  expect(await ui.find({ type: 'Button', key: MODEL_CONTROL })).toMatchObject({ props: { hotkey: 'm' } })
  expect(await ui.find({ type: 'Button', key: EFFORT_CONTROL })).toMatchObject({ props: { hotkey: 'e' } })

  await finishRun($)
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: MODEL_CONTROL })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: EFFORT_CONTROL })).toBeDefined()
})

test('the model control offers as started, then each other model the session runs on, by alias in model order', async ($, on) => {
  stubClaudeSettings(on)
  sentRequests(on)
  const ui = await focusOnAgent($, on)

  const labels = [await labelOf(ui, MODEL_CONTROL)]
  for (let at = 0; at < 3; at += 1) {
    await press($, MODEL_CONTROL)
    labels.push(await labelOf(ui, MODEL_CONTROL))
  }
  expect(labels).toEqual([modelLabel('as started', 'haiku'), modelLabel('haiku', 'sonnet'), modelLabel('sonnet', 'as started'), modelLabel('as started', 'haiku')])
})

test('with no other model in the session, the model control is held, and its press says why', async ($, on) => {
  stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const ui = await focusOnAgent($, on, [OPUS])

  expect(await ui.find({ type: 'Button', key: MODEL_CONTROL })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `held-${MODEL_CONTROL}` })).toMatchObject({
    props: { hotkey: 'm', dimColor: true, label: 'next run (nothing else yet)' },
  })
  await press($, `held-${MODEL_CONTROL}`)
  expect(toasts).toEqual([`Squishys: ${NO_OTHER_MODEL.reason}`])
})

test('a model picked for an Asleep agent is used, by its full id, by every request of its next run, and only that agent’s', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const ui = await focusOnAgent($, on)
  await modelsUsed($)
  await finishRun($)

  await press($, MODEL_CONTROL, 2)
  expect(await labelOf(ui, MODEL_CONTROL)).toBe(modelLabel('sonnet', 'as started'))
  expect(await ui.find({ type: 'Text', text: NEXT_RUN_NOTE_ENDED })).toBeDefined()

  sent.length = 0
  await drain($.turn.step(runStep(2)))
  await drain($.turn.step(AGENT_TWO_STEP))
  await drain($.turn.step(ORCHESTRATOR_STEP))
  await drain($.turn.step(runStep(2, 1)))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: SONNET, effort: 'high' },
    { agentId: 'agent-2', model: HAIKU },
    { agentId: undefined, model: OPUS, effort: 'high' },
    { agentId: 'agent-1', model: SONNET, effort: 'high' },
  ])
  expect(await ui.find({ type: 'Text', text: `${SONNET} (picked)` })).toBeDefined()
})

test('a pick made while the agent runs waits for its next run, says so, and lasts through the runs after it', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const ui = await focusOnAgent($, on)
  await modelsUsed($)
  await drain($.turn.step(runStep(1)))

  await press($, MODEL_CONTROL)
  expect(await ui.find({ type: 'Text', text: NEXT_RUN_NOTE_RUNNING })).toBeDefined()
  sent.length = 0
  await drain($.turn.step(runStep(1, 1)))
  await finishRun($)
  await drain($.turn.step(runStep(2)))
  await finishRun($, 2)
  await drain($.turn.step(runStep(3)))

  expect(sent.map(each => each.model)).toEqual([OPUS, HAIKU, HAIKU])
})

test('a pick made during a run on a picked model leaves that run on it', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  await focusOnAgent($, on)
  await modelsUsed($)
  await press($, MODEL_CONTROL)
  await drain($.turn.step(runStep(2)))

  await press($, MODEL_CONTROL)
  sent.length = 0
  await drain($.turn.step(runStep(2, 1)))
  await drain($.turn.step(runStep(3)))

  expect(sent.map(each => each.model)).toEqual([HAIKU, SONNET])
})

test('a run’s pick goes however the run ends, so a later run the mod doesn’t see never shows it', async ($, on) => {
  sentRequests(on)
  stubClaudeSettings(on)
  on('classic.SubagentStop', () => ({}))
  const ui = await focusOnAgent($, on)
  await modelsUsed($)
  await press($, MODEL_CONTROL)
  await drain($.turn.step(runStep(2)))
  expect(await ui.find({ type: 'Text', text: `${HAIKU} (picked)` })).toBeDefined()

  // Ended by its SubagentStop, no turn.complete; then a redirect's run, whose requests the mod never sees, wakes it
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '', agent_type: 'general-purpose' })
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  await appendRow($, promptRowOf('agent-1', fromUser('Look again')))

  expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: OPUS })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(picked\)/ })).toBeUndefined()
})

test('stepping back to as started lets its next run start on the model it started on', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const ui = await focusOnAgent($, on)
  await modelsUsed($)

  await press($, MODEL_CONTROL, 3)
  expect(await labelOf(ui, MODEL_CONTROL)).toBe(modelLabel('as started', 'haiku'))
  expect(await ui.find({ type: 'Text', text: NEXT_RUN_NOTE_RUNNING })).toBeUndefined()
  sent.length = 0
  await drain($.turn.step(runStep(2)))

  expect(sent).toEqual([{ agentId: 'agent-1', model: OPUS, effort: 'high' }])
})

test('with availableModels set, the model control offers only the models it names', async ($, on) => {
  stubClaudeSettings(on, { availableModels: ['Haiku', 'claude-sonnet-9'] })
  const ui = await focusOnAgent($, on)

  const labels = [await labelOf(ui, MODEL_CONTROL)]
  await press($, MODEL_CONTROL)
  labels.push(await labelOf(ui, MODEL_CONTROL))
  expect(labels).toEqual([modelLabel('as started', 'haiku'), modelLabel('haiku', 'as started')])
})

test('a press for a model availableModels stopped naming since the control was drawn is refused, saying why', async ($, on) => {
  const settings = stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const ui = await focusOnAgent($, on)
  expect(await labelOf(ui, MODEL_CONTROL)).toBe(modelLabel('as started', 'haiku'))

  settings.availableModels = ['sonnet']
  await press($, MODEL_CONTROL)
  expect(toasts).toEqual([expect.stringContaining('haiku not picked')])
  expect(toasts[0]).toContain('availableModels')

  await drawAgain($)
  expect(await labelOf(ui, MODEL_CONTROL)).toBe(modelLabel('as started', 'sonnet'))
})

test('a picked model availableModels no longer names shows so, and its next run starts on the model it started on, saying why', async ($, on) => {
  const sent = sentRequests(on)
  const settings = stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const ui = await focusOnAgent($, on)
  await modelsUsed($)
  await press($, MODEL_CONTROL, 2)

  settings.availableModels = ['haiku']
  await drawAgain($)
  expect(await labelOf(ui, MODEL_CONTROL)).toBe(modelLabel('sonnet (not allowed)', 'as started'))

  sent.length = 0
  await drain($.turn.step(runStep(2)))
  expect(sent).toEqual([{ agentId: 'agent-1', model: OPUS, effort: 'high' }])
  expect(toasts).toEqual([expect.stringContaining('availableModels')])
  expect(await labelOf(ui, MODEL_CONTROL)).toBe(modelLabel('as started', 'haiku'))
})

test('/clear ends every pick', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  stubSessionStart(on)
  await focusOnAgent($, on)
  await modelsUsed($)
  await press($, MODEL_CONTROL, 2)
  await press($, EFFORT_CONTROL, 1)

  await $.classic.SessionStart({ source: 'clear' })
  sent.length = 0
  await drain($.turn.step(runStep(2)))

  expect(sent).toEqual([{ agentId: 'agent-1', model: OPUS, effort: 'high' }])
})

test('whether each model’s requests carry an effort is written only as something new is learned', async ($, on) => {
  const writes: unknown[] = []
  on('state.set', { plugin: 'squishys', key: 'seenModels' }, ($, e, next) => {
    writes.push(e.value)
    return next(e)
  })
  sentRequests(on)
  stubClaudeSettings(on)
  await focusOnAgent($, on)

  for (const step of [ORCHESTRATOR_STEP, ORCHESTRATOR_STEP, AGENT_TWO_STEP, AGENT_TWO_STEP]) await drain($.turn.step(step))

  expect(writes).toEqual([{ [OPUS]: true }, { [OPUS]: true, [HAIKU]: false }])
})

// Effort

test('the effort control steps through as started, low, medium, high, xhigh and max, then back to as started', async ($, on) => {
  stubClaudeSettings(on)
  const ui = await focusOnAgent($, on)

  const labels = [await labelOf(ui, EFFORT_CONTROL)]
  for (let at = 0; at < 6; at += 1) {
    await press($, EFFORT_CONTROL)
    labels.push(await labelOf(ui, EFFORT_CONTROL))
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

test('a picked effort is carried by every request of the agent’s next run alone, and the run going on keeps its own', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const ui = await focusOnAgent($, on)
  await drain($.turn.step(runStep(1)))

  await press($, EFFORT_CONTROL, 4)
  sent.length = 0
  await drain($.turn.step(runStep(1, 1)))
  await drain($.turn.step(runStep(2)))
  await drain($.turn.step({ ...AGENT_TWO_STEP, model: OPUS, effort: 'high' }))
  await drain($.turn.step(runStep(2, 1)))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: OPUS, effort: 'high' },
    { agentId: 'agent-1', model: OPUS, effort: 'xhigh' },
    { agentId: 'agent-2', model: OPUS, effort: 'high' },
    { agentId: 'agent-1', model: OPUS, effort: 'xhigh' },
  ])
  expect(await labelOf(ui, EFFORT_CONTROL)).toBe(effortLabel('xhigh', 'max'))
})

test('a picked model and effort go together, and a picked model that takes an effort keeps the request’s own when none is picked', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  await focusOnAgent($, on)
  await modelsUsed($)

  await press($, MODEL_CONTROL, 2)
  sent.length = 0
  await drain($.turn.step(runStep(2)))
  await press($, EFFORT_CONTROL, 1)
  await drain($.turn.step(runStep(3)))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: SONNET, effort: 'high' },
    { agentId: 'agent-1', model: SONNET, effort: 'low' },
  ])
})

test('a next run on a model that takes no effort is sent none: the effort control is held, and its press says why', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const ui = await focusOnAgent($, on)
  await modelsUsed($)
  await press($, EFFORT_CONTROL, 2)

  await press($, MODEL_CONTROL)
  expect(await ui.find({ type: 'Button', key: EFFORT_CONTROL })).toBeUndefined()
  expect(await labelOf(ui, `held-${EFFORT_CONTROL}`)).toBe('next run effort (n/a)')
  await press($, `held-${EFFORT_CONTROL}`)
  expect(toasts).toEqual([`Squishys: ${NO_EFFORT_TAKEN.reason}`])

  sent.length = 0
  await drain($.turn.step(runStep(2)))
  expect(sent).toEqual([{ agentId: 'agent-1', model: HAIKU }])

  // Back on the model it started on, the picked effort applies again
  await press($, MODEL_CONTROL, 2)
  expect(await labelOf(ui, EFFORT_CONTROL)).toBe(effortLabel('medium', 'high'))
})

test('an agent whose own requests carry no effort is sent none, whatever effort is picked', async ($, on) => {
  const sent = sentRequests(on)
  stubClaudeSettings(on)
  await focusOnAgent($, on)
  await press($, EFFORT_CONTROL, 2)

  // The engine leaves the effort out for a model that takes none
  await drain($.turn.step({ ...stepOf('agent-1'), turnId: 'turn-agent-1-2' }))
  expect(sent).toEqual([{ agentId: 'agent-1', model: OPUS }])
})

// A redirect to an Asleep agent with a pick goes through Claude

// Stands in for Claude Code taking a plugin's prompt, keeping each; `drop` refuses them
function stubPrompts(on: On, drop?: string): { text: string; asUser?: true }[] {
  const prompts: { text: string; asUser?: true }[] = []
  on('prompt.submit', ($, e) => {
    prompts.push({ text: e.text, ...(e.origin.kind === 'plugin' && e.origin.asUser === true ? { asUser: true as const } : {}) })
    return drop === undefined ? { text: e.text, origin: e.origin } : { drop }
  })
  return prompts
}

// Stands in for Claude Code delivering each message a plugin sends
function stubSends(on: On): string[] {
  const sent: string[] = []
  on('session.send', ($, e) => {
    sent.push(e.to)
    return { isDelivered: true }
  })
  return sent
}

test('a redirect to an Asleep agent with a pick goes through Claude, word for word, as the user’s, so the pick applies', async ($, on) => {
  stubClaudeSettings(on)
  const toasts = stubToasts(on)
  const prompts = stubPrompts(on)
  const sends = stubSends(on)
  const ui = await focusOnAgent($, on)
  await finishRun($)
  await press($, MODEL_CONTROL)

  await typeRedirect($, 'Now check the tests')

  expect(sends).toEqual([])
  expect(prompts).toEqual([{ text: relayPrompt('agent-1', fromUser('Now check the tests')), asUser: true }])
  expect(prompts[0]?.text).toMatch(/^Use SendMessage to send this exact message to agent agent-1, then do nothing else:/)
  expect(toasts).toEqual(['Squishys: Sent via Claude so the new model applies.'])
  expect(await ui.find({ type: 'Text', text: /^Sent via Claude so the new model applies\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You: Now check the tests' })).toBeDefined()
})

test('a redirect to an Asleep agent with no pick is sent to it at once, as before', async ($, on) => {
  stubClaudeSettings(on)
  const prompts = stubPrompts(on)
  const sends = stubSends(on)
  await focusOnAgent($, on)
  await finishRun($)

  await typeRedirect($, 'Now check the tests')

  expect(prompts).toEqual([])
  expect(sends).toEqual(['agent-1'])
})

test('a redirect Claude Code refuses to take as a prompt is not sent, saying why', async ($, on) => {
  stubClaudeSettings(on)
  stubToasts(on)
  stubPrompts(on, 'blocked by a hook')
  const sends = stubSends(on)
  const ui = await focusOnAgent($, on)
  await finishRun($)
  await press($, EFFORT_CONTROL)

  await typeRedirect($, 'Now check the tests')

  expect(sends).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Not sent: blocked by a hook' })).toBeDefined()
})
