import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentStatus } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { PANE, finishOf, readFrom, spawnOf, stepOf, stubAgentList, stubSpawns, stubTurns } from './fixtures'
import { everySquishy, squishyIn, stateIn } from './pictures'

// Spawns agent-1 and opens the roster. `state()` reads which state its
// squishy shows right now.
async function spawnAndWatch($: Engine) {
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picture = async () => (await ui.find({ key: 'picture-agent-1' }))?.props.cells
  const squishy = squishyIn(await picture())
  return { state: async () => stateIn(await picture(), squishy) }
}

// Reads a stream to its end, as Claude Code does a model response
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream);
}

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

for (const [status, expected] of [['completed', 'asleep'], ['failed', 'squished'], ['killed', 'squished']] as const) {
  test(`when its agent stops as ${status}, a squishy is ${expected === 'asleep' ? 'Asleep' : 'Squished'}`, async ($, on) => {
    mock.store(on)
    stubSpawns(on)
    stubAgentList(on, new Map([['agent-1', status]]))
    on('classic.SubagentStop', () => ({}))
    const { state } = await spawnAndWatch($)

    await $.classic.SubagentStop(SUBAGENT_STOP)

    expect(await state()).toBe(expected)
  })
}

for (const status of ['failed', 'killed'] as const) {
  test(`an agent that ${status === 'failed' ? 'failed' : 'was stopped'} is caught by checking the agent list, with no stop event`, async ($, on) => {
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

test('a finished agent’s squishy goes back to the pool: a new agent can get it while no running agent has it', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  // Spawning one agent per squishy the kit makes leaves none free, so a
  // squishy freed by a finished agent is the only one the next roll can give
  const everyOne = everySquishy().length
  for (let n = 1; n <= everyOne; n += 1) await $.agent.spawn(spawnOf(`toolu_${n}`))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const squishyOf = async (agentId: string) => squishyIn((await ui.find({ key: `picture-${agentId}` }))?.props.cells)
  const freed = await squishyOf('agent-1')

  await $.turn.complete(finishOf('agent-1'))
  await $.agent.spawn(spawnOf('toolu_next'))

  expect(await squishyOf(`agent-${everyOne + 1}`)).toEqual(freed)
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
