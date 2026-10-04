import { expect, mock, test } from 'claude-code/testing'
import type { AgentStatus } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { PANE, drain, finishOf, readFrom, spawnOf, stepOf, stubAgentList, stubSpawns, stubTurns } from './fixtures'
import { spawnAndWatch, watch } from './pictures'

test('a spawned agent’s squishy is Working', async ($, on) => {
  mock.store(on)
  stubSpawns(on)

  const { state } = await spawnAndWatch($)

  expect(await state()).toBe('working')
})

// The kit waits out a stream left open before each act, so this test reads
// the first piece itself and acts as little as it can while the stream is open
test('while its agent streams a model response, a squishy is Thinking, and Working again once the response ends', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const { state } = await spawnAndWatch($)

  const response = $.turn.step(stepOf('agent-1'))
  await response.next()
  expect(await state()).toBe('thinking')

  await drain(response)
  expect(await state()).toBe('working')
})

test('an agent that ends while its response streams stays ended once the stream closes', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const { state } = await spawnAndWatch($)

  const response = $.turn.step(stepOf('agent-1'))
  await response.next()
  statuses.set('agent-1', 'failed')
  await clock.advance(AGENT_CHECK_MS)
  await drain(response)

  expect(await state()).toBe('squished')
})

test('when its agent finishes, a squishy falls Asleep', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const { state } = await spawnAndWatch($)

  await $.turn.complete(finishOf('agent-1'))

  expect(await state()).toBe('asleep')
})

for (const [reason, how] of [['error', 'ends on an error'], ['aborted', 'is interrupted']] as const) {
  test(`when its agent’s run ${how}, a squishy is Squished`, async ($, on) => {
    mock.store(on)
    stubSpawns(on)
    stubTurns(on)
    const { state } = await spawnAndWatch($)

    await $.turn.complete(finishOf('agent-1', reason))

    expect(await state()).toBe('squished')
  })
}

// SubagentStop, as Claude Code raises it when agent-1 stops
const SUBAGENT_STOP = { stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '', agent_type: 'general-purpose' }

const ENDINGS = [
  ['completed', 'finished', 'asleep'],
  ['failed', 'failed', 'squished'],
  ['killed', 'was stopped', 'squished'],
] as const

for (const [status, how, expected] of ENDINGS) {
  test(`when its agent stops and the agent list says it ${how}, a squishy is ${expected === 'asleep' ? 'Asleep' : 'Squished'}`, async ($, on) => {
    mock.store(on)
    stubSpawns(on)
    stubAgentList(on, new Map([['agent-1', status]]))
    on('classic.SubagentStop', () => ({}))
    const { state } = await spawnAndWatch($)

    await $.classic.SubagentStop(SUBAGENT_STOP)

    expect(await state()).toBe(expected)
  })
}

for (const [status, how] of [['failed', 'failed'], ['killed', 'was stopped']] as const) {
  test(`an agent that ${how} is caught by checking the agent list, with no stop event`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    stubSpawns(on)
    const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
    stubAgentList(on, statuses)
    const { state } = await spawnAndWatch($)

    await clock.advance(AGENT_CHECK_MS)
    expect(await state()).toBe('working')

    statuses.set('agent-1', status)
    await clock.advance(AGENT_CHECK_MS)
    expect(await state()).toBe('squished')
  })
}

test('after a hot reload, which keeps the agents but drops the timers, the agent list is checked again', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  // A clock of the test's own. It refuses each timer's period, which ends
  // the timer, until told to hold the next one for the test to let pass.
  let holding = false
  let pass = () => {}
  on('clock.every', () => {
    if (!holding) return { deny: 'no clock' }
    holding = false
    return new Promise(resolve => (pass = () => resolve({ value: undefined })))
  })
  // The timers the spawn started end at once, as a reload drops them
  const { state } = await spawnAndWatch($)

  holding = true
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  statuses.set('agent-1', 'failed')
  pass()

  expect(await state()).toBe('squished')
})

test('a tool call from an agent that had ended, resumed by a message, wakes its squishy to Working', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  on('tool.call', () => ({ result: 'ok' }))
  const { state } = await spawnAndWatch($)
  await $.turn.complete(finishOf('agent-1'))

  await $.tool.call(readFrom('agent-1', 'README.md'))

  expect(await state()).toBe('working')
})

test('an Asleep squishy stays in the roster, so no new agent gets it', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Rolled at random, sixteen from the placeholder kit would very likely
  // repeat one if Asleep squishys went back to the pool
  const spawnAndRead = async (from: number, to: number) => {
    const squishys = []
    for (let n = from; n <= to; n += 1) {
      await $.agent.spawn(spawnOf(`toolu_${n}`))
      squishys.push((await watch(ui, `agent-${n}`)).squishy)
    }
    return squishys
  }
  const first = await spawnAndRead(1, 8)
  for (let n = 1; n <= 8; n += 1) await $.turn.complete(finishOf(`agent-${n}`))

  const second = await spawnAndRead(9, 16)

  expect(new Set([...first, ...second].map(squishy => JSON.stringify(squishy))).size).toBe(16)
})

test('the orchestrator’s own turns leave every squishy as it was', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const { state } = await spawnAndWatch($)

  const { agentId: _, ...orchestratorStep } = stepOf('agent-1')
  await drain($.turn.step(orchestratorStep))
  const { agentId: __, ...orchestratorFinish } = finishOf('agent-1')
  await $.turn.complete(orchestratorFinish)

  expect(await state()).toBe('working')
})
