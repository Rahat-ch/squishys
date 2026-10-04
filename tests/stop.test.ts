import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { STOP_CONFIRM_MS, STOP_WAIT_MS } from '../src/stop'
import { PANE, finishOf, readFrom, spawnOf, stepOf, stubAgentList, stubSpawns } from './fixtures'
import { watch } from './pictures'

// Spawns agent-1 and opens its focus view, on a mock clock. Reads back the
// squishy's Name, and the state its roster slot shows (back in the roster).
async function focusOnAgent($: Engine, on: On, clock: MockClock = mock.clock(on)) {
  mock.store(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const slot = await watch(ui, 'agent-1')
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return { ui, clock, name: slot.squishy.name, slotState: slot.state }
}

// Stands in for Claude Code's TaskStop. As it `stops` the agent it names,
// the agent list then says so; it can also answer that it stopped the agent
// and leave it running, fail, or be refused by a deny rule. With `wait`, it
// answers once that resolves. Reads back each call's input.
function stubTaskStop(
  on: On,
  statuses: Map<string, AgentStatus>,
  how: 'stops' | 'leavesItRunning' | 'fails' | 'isRefused' = 'stops',
  wait?: () => Promise<void>,
): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = []
  on('tool.call', { tool: 'TaskStop' }, async ($, e) => {
    calls.push({ ...e })
    await wait?.()
    const named = String(e.task_id)
    if (how === 'isRefused') return { deny: 'Permission to use TaskStop has been denied.' }
    if (how === 'fails') return { isError: true, result: `No task found with ID: ${named}`, text: `No task found with ID: ${named}` }
    if (how === 'stops') statuses.set(named, 'killed')
    return { result: { message: `Successfully stopped task: ${named}`, task_id: named, task_type: 'local_agent' } }
  })
  return calls
}

// Stands in for Claude Code answering tool calls and model requests, and
// ending turns. Reads back how many model requests reached the model.
function stubLoop(on: On): () => number {
  let requests = 0
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.step', async function* ($, e) {
    requests += 1
    yield { kind: 'text', index: 0, text: 'Looking' } as const
    return { turnId: e.turnId, index: e.index, answer: 'Looking', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return () => requests
}

// The agent's next model request: drained, as Claude Code reads it, and its result
async function stepAgent($: Engine, agentId: string) {
  const response = $.turn.step(stepOf(agentId))
  for (;;) {
    const piece = await response.next()
    if (piece.done === true) return piece.value
  }
}

const pressStop = ($: Engine) => $.ui.press({ plugin: 'squishys', key: 'stop' })

test('one press of s arms Stop and asks for a second; the second within 3 seconds calls TaskStop with the agent’s id', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const calls = stubTaskStop(on, statuses)
  const { ui, clock, name } = await focusOnAgent($, on)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('s')

  await pressStop($)
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeDefined()
  expect(calls).toEqual([])

  await clock.advance(STOP_CONFIRM_MS - 1)
  await pressStop($)

  expect(calls).toEqual([expect.objectContaining({ tool: 'TaskStop', task_id: 'agent-1' })])
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeUndefined()
})

test('with no second press within 3 seconds, Stop disarms, and the next press only arms it again', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const calls = stubTaskStop(on, statuses)
  const { ui, clock, name } = await focusOnAgent($, on)

  await pressStop($)
  await clock.advance(STOP_CONFIRM_MS)
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeUndefined()

  await pressStop($)
  expect(calls).toEqual([])
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeDefined()
})

test('Stop disarms when the focus view goes back to the roster or on to another agent', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([
    ['agent-1', 'running'],
    ['agent-2', 'running'],
  ])
  stubAgentList(on, statuses)
  const calls = stubTaskStop(on, statuses)
  const { ui, name } = await focusOnAgent($, on)
  await $.agent.spawn(spawnOf('toolu_2'))
  const leaveFor = async (agentId: string) => {
    await $.ui.press({ plugin: 'squishys', key: 'back' })
    await $.ui.press({ plugin: 'squishys', key: `squishy-${agentId}` })
  }

  await pressStop($)
  await leaveFor('agent-1')
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeUndefined()
  await pressStop($)
  await leaveFor('agent-2')
  await pressStop($)
  await leaveFor('agent-1')
  await pressStop($)

  expect(calls).toEqual([])
})

test('a stopped agent’s squishy is Squished, its feed says it was stopped by you, and Stop goes', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses)
  const { ui, slotState } = await focusOnAgent($, on)

  await pressStop($)
  await pressStop($)

  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Stopped by you' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'stop' })).toBeUndefined()
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  expect(await slotState()).toBe('squished')
})

// Claude Code may end the stopped run as interrupted before TaskStop answers, or after
for (const when of ['before', 'after'] as const) {
  test(`a run TaskStop interrupted reads Stopped by you, not also Interrupted, when the run ends ${when} TaskStop answers`, async ($, on) => {
    const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
    stubAgentList(on, statuses)
    stubTaskStop(on, statuses, 'stops', when === 'before' ? () => $.turn.complete(finishOf('agent-1', 'aborted')).then(() => {}) : undefined)
    stubLoop(on)
    const { ui } = await focusOnAgent($, on)

    await pressStop($)
    await pressStop($)
    if (when === 'after') await $.turn.complete(finishOf('agent-1', 'aborted'))

    expect((await ui.find({ key: 'activity' }))?.text).toBe('Stopped by you')
  })
}

test('the squishy of an agent the orchestrator stops with TaskStop is Squished too', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses)
  mock.store(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const { state } = await watch(ui, 'agent-1')

  await $.tool.call({ tool: 'TaskStop', task_id: 'agent-1' })

  expect(await state()).toBe('squished')
})

test('when TaskStop fails, the agent’s tool calls are refused and its next model request ends it without the model', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses, 'fails')
  const requests = stubLoop(on)
  const { ui, name, slotState } = await focusOnAgent($, on)

  await pressStop($)
  await pressStop($)
  const note = String((await ui.find({ key: 'stop-note' }))?.text)
  expect(note).toContain(`Stopping ${name} at its next step`)
  expect(note).toContain('No task found with ID: agent-1')

  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ deny: 'Stopped by the user' })
  expect(await stepAgent($, 'agent-1')).toMatchObject({ toolUses: [], stopReason: 'end_turn' })
  expect(requests()).toBe(0)
  await $.turn.complete({ ...finishOf('agent-1'), answer: 'Stopped by the user.' })

  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Stopped by you' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/config.ts' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ key: 'stop-note' })).toBeUndefined()
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  expect(await slotState()).toBe('squished')
})

test('when a deny rule refuses TaskStop, the focus view says so, and the agent stops at its next step', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses, 'isRefused')
  const requests = stubLoop(on)
  const { ui } = await focusOnAgent($, on)

  await pressStop($)
  await pressStop($)

  expect(String((await ui.find({ key: 'stop-note' }))?.text)).toContain('Permission to use TaskStop has been denied.')
  await stepAgent($, 'agent-1')
  expect(requests()).toBe(0)
})

test('when TaskStop answers but the agent keeps running, the agent stops at its next step', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses, 'leavesItRunning')
  const requests = stubLoop(on)
  await focusOnAgent($, on)

  await pressStop($)
  await pressStop($)

  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ deny: 'Stopped by the user' })
  await stepAgent($, 'agent-1')
  expect(requests()).toBe(0)
})

test('when TaskStop doesn’t answer in time, the agent stops at its next step', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const clock = mock.clock(on)
  stubTaskStop(on, statuses, 'stops', () => clock.sleep(STOP_WAIT_MS * 10))
  const requests = stubLoop(on)
  const { ui, name } = await focusOnAgent($, on, clock)

  await pressStop($)
  const stopping = pressStop($)
  await clock.settle()
  expect(String((await ui.find({ key: 'stop-note' }))?.text)).toContain(`Stopping ${name}`)
  expect(await ui.find({ type: 'Button', key: 'stop' })).toBeUndefined()
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ result: 'ok' })

  await clock.advance(STOP_WAIT_MS)
  await stopping
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ deny: 'Stopped by the user' })
  await stepAgent($, 'agent-1')
  expect(requests()).toBe(0)
})

test('only the stopped agent is held back, and once its run has ended a message can resume it', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([
    ['agent-1', 'running'],
    ['agent-2', 'running'],
  ])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses, 'fails')
  const requests = stubLoop(on)
  await focusOnAgent($, on)
  await $.agent.spawn(spawnOf('toolu_2'))
  await pressStop($)
  await pressStop($)

  expect(await $.tool.call(readFrom('agent-2', 'README.md'))).toEqual({ result: 'ok' })
  await stepAgent($, 'agent-2')
  expect(requests()).toBe(1)

  await stepAgent($, 'agent-1')
  await $.turn.complete({ ...finishOf('agent-1'), answer: 'Stopped by the user.' })
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ result: 'ok' })
  await stepAgent($, 'agent-1')
  expect(requests()).toBe(2)
})

// Its loop ended normally, so the agent list says the agent completed
for (const order of [['turn.complete', 'SubagentStop'], ['SubagentStop', 'turn.complete']] as const) {
  test(`an agent held back until its next step: its squishy stays Squished through ${order.join(' then ')}`, async ($, on) => {
    const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
    stubAgentList(on, statuses)
    stubTaskStop(on, statuses, 'fails')
    stubLoop(on)
    on('classic.SubagentStop', () => ({}))
    const { slotState } = await focusOnAgent($, on)
    await pressStop($)
    await pressStop($)
    await stepAgent($, 'agent-1')
    statuses.set('agent-1', 'completed')

    for (const event of order) {
      if (event === 'turn.complete') await $.turn.complete({ ...finishOf('agent-1'), answer: 'Stopped by the user.' })
      else await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '', agent_type: 'general-purpose' })
    }

    await $.ui.press({ plugin: 'squishys', key: 'back' })
    expect(await slotState()).toBe('squished')
  })
}

test('an agent held back whose run ends without turn.complete is let go, so a resume reaches the model', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  stubTaskStop(on, statuses, 'fails')
  const requests = stubLoop(on)
  const { clock, slotState } = await focusOnAgent($, on)
  await pressStop($)
  await pressStop($)
  await stepAgent($, 'agent-1')

  // The run ended, and only the agent list says so
  statuses.set('agent-1', 'completed')
  await clock.advance(AGENT_CHECK_MS)
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  expect(await slotState()).toBe('squished')

  // A message resumes it
  statuses.set('agent-1', 'running')
  await stepAgent($, 'agent-1')
  expect(requests()).toBe(1)
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ result: 'ok' })
})

test('when TaskStop answers that it stopped the agent after the agent was held back, the agent is let go', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const clock = mock.clock(on)
  stubTaskStop(on, statuses, 'stops', () => clock.sleep(STOP_WAIT_MS * 2))
  stubLoop(on)
  const { ui } = await focusOnAgent($, on, clock)
  await pressStop($)
  const stopping = pressStop($)
  await clock.advance(STOP_WAIT_MS)
  await stopping
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ deny: 'Stopped by the user' })

  await clock.advance(STOP_WAIT_MS)

  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(await ui.find({ key: 'stop-note' })).toBeUndefined()
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ result: 'ok' })
})

test('an armed Stop whose timer a reload dropped still needs two presses within 3 seconds', async ($, on) => {
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const calls = stubTaskStop(on, statuses)
  // Stop's timer ends at once, as a reload drops it
  on('clock.after', { ms: STOP_CONFIRM_MS }, () => ({ deny: 'no clock' }))
  const { ui, clock, name } = await focusOnAgent($, on)

  await pressStop($)
  await clock.advance(STOP_CONFIRM_MS)
  await pressStop($)

  expect(calls).toEqual([])
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeDefined()
})

test('Stop names a teammate to TaskStop by its address, and its squishy is Squished', async ($, on) => {
  const teammate = { id: 'teammate-1', teammateId: 'reviewer@docs', name: 'reviewer', description: 'Review the docs', type: 'teammate' }
  let status: AgentStatus = 'running'
  on('agent.list', () => ({ value: [{ ...teammate, status }] }))
  const named: unknown[] = []
  on('tool.call', { tool: 'TaskStop' }, ($, e) => {
    named.push(e.task_id)
    if (e.task_id === teammate.teammateId) status = 'killed'
    return { result: { message: 'Successfully stopped task', task_id: String(e.task_id), task_type: 'in_process_teammate' } }
  })
  on('tool.call', () => ({ result: 'ok' }))
  mock.clock(on)
  mock.store(on)
  await $.tool.call(readFrom('teammate-1', 'README.md'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-teammate-1' })

  await pressStop($)
  await pressStop($)

  expect(named).toEqual(['reviewer@docs'])
  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Stopped by you' })).toBeDefined()
})
