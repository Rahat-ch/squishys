import { expect, mock, test } from 'claude-code/testing'

import { readFrom, stepOf, stubAgentList, stubSpawns, stubTurns } from './fixtures'
import { spawnAndWatch } from './pictures'

// Reads a stream to its end, as Claude Code does a model response
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream);
}

// PermissionRequest, as Claude Code raises it before asking the user about a
// Bash call. `agent_id` is there only when it fires from inside an agent.
function permissionRequestFrom(agentId?: string) {
  return {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    ...(agentId === undefined ? {} : { agent_id: agentId, agent_type: 'general-purpose' }),
  }
}

// The base of each classic event agent-1 raises after its prompt
const FROM_AGENT = { agent_id: 'agent-1', agent_type: 'general-purpose' } as const
const AFTER_BASH = { ...FROM_AGENT, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'toolu_bash' } as const

test('a permission request from inside an agent puts its squishy in Needs you, with a “!” bubble', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({}))
  const { state } = await spawnAndWatch($)

  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  expect(await state()).toBe('needsYou')
})

test('a permission request a settings hook answers asks the user nothing, so the squishy stays Working', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
  const { state } = await spawnAndWatch($)

  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  expect(await state()).toBe('working')
})

test('a permission request from the orchestrator marks no squishy', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({}))
  const { state } = await spawnAndWatch($)

  await $.classic.PermissionRequest(permissionRequestFrom())

  expect(await state()).toBe('working')
})

test('the result of the tool call that asked clears Needs you, back to Working', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({}))
  // The prompt comes up and is answered while the tool call is under way
  let whileAsking: string | undefined
  let watched: Awaited<ReturnType<typeof spawnAndWatch>> | undefined
  on('tool.call', async () => {
    await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))
    whileAsking = await watched?.state()
    return { result: 'ok' }
  })
  watched = await spawnAndWatch($)

  await $.tool.call(readFrom('agent-1', 'README.md'))

  expect(whileAsking).toBe('needsYou')
  expect(await watched.state()).toBe('working')
})

test('the agent’s next model request clears Needs you', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  on('classic.PermissionRequest', () => ({}))
  const { state } = await spawnAndWatch($)
  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  await drain($.turn.step(stepOf('agent-1')))

  expect(await state()).toBe('working')
})

test('PostToolUse from the agent clears Needs you, back to Working', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  const { state } = await spawnAndWatch($)
  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  await $.classic.PostToolUse({ ...AFTER_BASH, tool_response: 'ok' })

  expect(await state()).toBe('working')
})

test('a denied permission clears Needs you, back to Working', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  const { state } = await spawnAndWatch($)
  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  await $.classic.PermissionDenied({ ...AFTER_BASH, reason: 'The user said no' })

  expect(await state()).toBe('working')
})

test('an agent that stops while it Needs you is Asleep or Squished, as it ended', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  stubAgentList(on, new Map([['agent-1', 'killed']]))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SubagentStop', () => ({}))
  const { state } = await spawnAndWatch($)
  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  await $.classic.SubagentStop({ ...FROM_AGENT, stop_hook_active: false, agent_transcript_path: '' })

  expect(await state()).toBe('squished')
})

test('a sign of life from another agent leaves a squishy in Needs you', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  const { state } = await spawnAndWatch($)
  await $.classic.PermissionRequest(permissionRequestFrom('agent-1'))

  await $.classic.PostToolUse({ ...AFTER_BASH, agent_id: 'agent-2', tool_response: 'ok' })

  expect(await state()).toBe('needsYou')
})
