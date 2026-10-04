import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentStatus, On, SessionSendResult } from 'claude-code'

import { PARTNER_BUTTON } from '../src/partner'
import { PANE, PARTNERED, finishOf, readFrom, spawnOf, stepOf, stubAgentList, stubSpawns, stubTurns } from './fixtures'

// The kit can't append to a running agent's conversation, so its redirects
// are refused here: AGENTS.md, "A redirect goes". Most tests redirect an
// Asleep agent, which is sent the message.

// What the agent reads: the user's words, said to be theirs
const FROM_USER = 'Message from your user, typed into the squishys focus view (not from another agent or the coordinator): '

// Stands in for Claude Code delivering each message a plugin sends, with
// the result the test gives
function stubSends(on: On, result: SessionSendResult = { isDelivered: true }): { to: string; text: string }[] {
  const sent: { to: string; text: string }[] = []
  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })
    return result
  })
  return sent
}

// Spawns agent-1 and agent-2 and opens agent-1's focus view, with every tool
// call and turn answered, and the store holding `stored`. Reads back
// agent-1's squishy's Name.
async function focusOnAgent($: Engine, on: On, stored: Readonly<Record<string, unknown>> = {}) {
  mock.store(on, stored)
  stubSpawns(on)
  stubTurns(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const name = String((await ui.find({ key: 'squishy-agent-1' }))?.props.label)
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return { ui, name }
}

// The user typing a message into the focus view's redirect input a key at a
// time, then pressing Enter
async function typeRedirect($: Engine, text: string): Promise<void> {
  for (let end = 1; end <= text.length; end += 1) {
    await $.ui.input({ plugin: 'squishys', key: 'redirect', text: text.slice(0, end), kind: 'change' })
  }
  await $.ui.input({ plugin: 'squishys', key: 'redirect', text })
}

const enter = (text: string) => ({ plugin: 'squishys', key: 'redirect', text })
const deliveryNote = /^(Sending…|Sent to |Not sent: )/

test('a running agent’s redirect that Claude Code refuses to append, for want of anything but a running loop, is never sent as a peer’s message', async ($, on) => {
  const sent = stubSends(on)
  const { ui } = await focusOnAgent($, on)

  await typeRedirect($, 'Look in src/settings.tsx instead')

  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Not sent: no implementation for session.append' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^You: / })).toBeUndefined()
})

test('a redirect to an Asleep agent is sent to it as its user’s, resumes it, and its squishy is Working again', async ($, on) => {
  const sent = stubSends(on)
  const { ui, name } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()

  await typeRedirect($, 'Now check the tests')

  expect(sent).toEqual([{ to: 'agent-1', text: `${FROM_USER}Now check the tests` }])
  expect(await ui.find({ type: 'Text', text: `Sent to ${name}. It had finished; the message resumed it.` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You: Now check the tests' })).toBeDefined()

  // Resumed from its transcript, the agent gets to work, and the delivery has had its say
  await $.tool.call(readFrom('agent-1', 'tests/config.test.ts'))
  expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'You: Now check the tests' })).toBeDefined()
})

test('a redirect that isn’t delivered says why, and adds nothing to the feed', async ($, on) => {
  stubSends(on, { isDelivered: false, reason: 'agent-1 is no longer running' })
  const { ui } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1', 'aborted'))

  await typeRedirect($, 'Try again')

  expect(await ui.find({ type: 'Text', text: 'Not sent: agent-1 is no longer running' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You: Try again' })).toBeUndefined()
})

test('going back to the roster clears what became of a redirect', async ($, on) => {
  stubSends(on)
  const { ui, name } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))
  await typeRedirect($, 'Stop after this file')
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeDefined()

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-2' })
  expect(await ui.find({ type: 'Text', text: `Sent to ${name}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'You: Stop after this file' })).toBeUndefined()

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'You: Stop after this file' })).toBeDefined()
})

test('going to the roster by the partner’s button clears what became of a redirect too', async ($, on) => {
  stubSends(on)
  const { ui } = await focusOnAgent($, on, PARTNERED)
  await $.turn.complete(finishOf('agent-1'))
  await typeRedirect($, 'Stop after this file')
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeDefined()

  await $.ui.press({ plugin: 'squishys', key: PARTNER_BUTTON })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
})

test('what became of a running agent’s redirect is cleared once the agent ends', async ($, on) => {
  stubSends(on)
  const { ui } = await focusOnAgent($, on)
  await typeRedirect($, 'Wrap up')
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeDefined()

  await $.turn.complete(finishOf('agent-1'))

  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
})

test('a redirect says it’s sending until it’s delivered, and another Enter meanwhile sends nothing', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('session.send', async ($, e) => {
    await clock.sleep(1000)
    sent.push(e.text)
    return { isDelivered: true }
  })
  const { ui, name } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))

  await $.ui.input({ ...enter('Check the logs'), kind: 'change' })
  const first = $.ui.input(enter('Check the logs'))
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Sending…' })).toBeDefined()
  await $.ui.input({ ...enter('And the config'), kind: 'change' })
  const second = $.ui.input(enter('And the config'))
  await clock.settle()

  await clock.advance(1000)
  await Promise.all([first, second])

  expect(sent).toEqual([`${FROM_USER}Check the logs`])
  expect(await ui.find({ type: 'Text', text: `Sent to ${name}. It had finished; the message resumed it.` })).toBeDefined()
})

test('a long redirect is sent whole, and its row in the feed is cut short', async ($, on) => {
  const sent = stubSends(on)
  const { ui } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))
  const long = 'word '.repeat(400).trim()

  await $.ui.input({ ...enter(long), kind: 'change' })
  await $.ui.input(enter(long))

  expect(sent.map(each => each.text)).toEqual([`${FROM_USER}${long}`])
  const row = String((await ui.find({ type: 'Text', text: /^You: / }))?.text)
  expect(row.startsWith('You: word word')).toBe(true)
  expect(row.endsWith('…')).toBe(true)
  expect(row.length).toBeLessThanOrEqual('You: '.length + 500)
})

test('an empty redirect sends nothing', async ($, on) => {
  const sent = stubSends(on)
  const { ui } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))

  await typeRedirect($, '   ')

  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
})

test('the letters of the focus view’s hotkeys, typed through the redirect input, are sent as the message and the view stays open', async ($, on) => {
  const sent = stubSends(on)
  const { ui } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))

  await typeRedirect($, 'r')

  expect(await ui.find({ key: 'focus' })).toBeDefined()
  expect(sent.map(each => each.text)).toEqual([`${FROM_USER}r`])
})

// With Stop: agent-1 running, TaskStop failing as the stop tests' fallback
// has it, and model requests counted. Spawns agent-1 and opens its focus view.
async function focusWithStop($: Engine, on: On) {
  mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  const statuses = new Map<string, AgentStatus>([['agent-1', 'running']])
  stubAgentList(on, statuses)
  const taskStops: unknown[] = []
  on('tool.call', { tool: 'TaskStop' }, ($, e) => {
    taskStops.push(e)
    return { isError: true, result: 'No task found with ID: agent-1', text: 'No task found with ID: agent-1' }
  })
  on('tool.call', () => ({ result: 'ok' }))
  let requests = 0
  on('turn.step', async function* ($, e) {
    requests += 1
    yield { kind: 'text', index: 0, text: 'Carrying on' } as const
    return { turnId: e.turnId, index: e.index, answer: 'Carrying on', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const name = String((await ui.find({ key: 'squishy-agent-1' }))?.props.label)
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return { ui, name, statuses, taskStops, requests: () => requests }
}

// The agent's next model request, drained as Claude Code reads it
async function stepAgent($: Engine, agentId: string): Promise<void> {
  const response = $.turn.step(stepOf(agentId))
  while ((await response.next()).done !== true);
}

// The kit can't press keys, so this types "stop" through the Input, where
// the Input-focus rule in AGENTS.md says every key goes, and checks Stop
// stays disarmed: one press of Stop afterwards only arms it.
test('typing “stop” into the redirect input doesn’t arm Stop', async ($, on) => {
  stubSends(on)
  const { ui, name, taskStops } = await focusWithStop($, on)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('s')

  await typeRedirect($, 'stop')

  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeUndefined()
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  expect(taskStops).toEqual([])
  expect(await ui.find({ type: 'Text', text: `press s again to stop ${name}` })).toBeDefined()
})

test('a redirect to an agent Squished by a fallback stop resumes it, and its next request reaches the model', async ($, on) => {
  const sent = stubSends(on)
  const { ui, name, statuses, requests } = await focusWithStop($, on)
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  await stepAgent($, 'agent-1')
  await $.turn.complete({ ...finishOf('agent-1'), answer: 'Stopped by the user.' })
  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(requests()).toBe(0)

  await typeRedirect($, 'Carry on after all')
  expect(sent).toEqual([{ to: 'agent-1', text: `${FROM_USER}Carry on after all` }])
  expect(await ui.find({ type: 'Text', text: `Sent to ${name}. It had finished; the message resumed it.` })).toBeDefined()

  // Resumed by the message, the agent asks the model again
  statuses.set('agent-1', 'running')
  await stepAgent($, 'agent-1')
  expect(requests()).toBe(1)
  expect(await $.tool.call(readFrom('agent-1', 'src/config.ts'))).toEqual({ result: 'ok' })
  expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
})
