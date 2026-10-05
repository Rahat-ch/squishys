import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { AgentStatus, On, SessionSendResult } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { focusHint } from '../src/focus'
import { OPEN_PANE_ASKED, PANE_ID } from '../src/pane'
import { PARTNER_BUTTON } from '../src/partner'
import { PANE, PARTNERED, appendRow, bashFrom, finishOf, nameOfAgent, promptRowOf, readFrom, spawnOf, stepOf, stubAgentList, stubPanes, stubSessionStart, stubSpawns, stubStore, stubTurns, toolUseRowOf } from './fixtures'

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
  const store = stubStore(on, { ...stored })
  stubSpawns(on)
  stubTurns(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Whole, as the focus view's notes say it: the slot's Button may cut it
  const name = nameOfAgent(store, 'agent-1')
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

// In a session, the run the mod's own send resumes raises its turn.step,
// tool.call and SubagentStop under the mod's origin, so the mod's hooks on
// them never run (the recursion skip, seen in a session for #60). The rows
// Claude Code appends to the agent's conversation and its turn.complete
// still reach the mod, so these tests resume an agent with those alone.
test('a redirect to an Asleep agent is sent to it as its user’s and resumes it: its squishy is Working once the message reaches it, its tool calls show in the feed, and it’s Asleep with its answer once the run completes', async ($, on) => {
  const sent = stubSends(on)
  const { ui, name } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()

  await typeRedirect($, 'Now check the tests')

  expect(sent).toEqual([{ to: 'agent-1', text: `${FROM_USER}Now check the tests` }])
  expect(await ui.find({ type: 'Text', text: 'You: Now check the tests' })).toBeDefined()

  // Resumed from its transcript, the agent reads the message and gets to work
  await appendRow($, promptRowOf('agent-1', `The coordinator sent a message while you were working:\n${FROM_USER}Now check the tests`))
  expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `Sent to ${name}. It had finished; the message resumed it.` })).toBeDefined()
  await appendRow($, toolUseRowOf('agent-1', 'Bash', { command: 'npm test', description: 'Run the tests' }))
  expect(await ui.find({ type: 'Text', text: 'npm test' })).toBeDefined()

  await $.turn.complete({ ...finishOf('agent-1'), answer: 'All 12 tests pass' })
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  expect((await ui.findAll({ type: 'Markdown' })).map(answer => answer.props.text)).toEqual(['All 12 tests pass'])
  expect(await ui.find({ type: 'Text', text: deliveryNote })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'You: Now check the tests' })).toBeDefined()
})

test('a resumed agent that hands its report back through SubagentHandback shows the report as its answer', async ($, on) => {
  stubSends(on)
  const { ui } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))
  await typeRedirect($, 'Write one haiku about dumplings')
  await appendRow($, promptRowOf('agent-1', `${FROM_USER}Write one haiku about dumplings`))

  await appendRow($, toolUseRowOf('agent-1', 'SubagentHandback', { message: 'Pleated moons of dough' }))
  await $.turn.complete({ ...finishOf('agent-1'), answer: '' })

  expect((await ui.findAll({ type: 'Markdown' })).map(answer => answer.props.text)).toEqual(['Pleated moons of dough'])
  expect(await ui.find({ type: 'Text', text: 'SubagentHandback' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
})

test('the rows of a run no redirect resumed add nothing to its feed: its tool calls reach the mod themselves', async ($, on) => {
  stubSends(on)
  const { ui } = await focusOnAgent($, on)

  await $.tool.call(bashFrom('agent-1', 'npm test'))
  await appendRow($, toolUseRowOf('agent-1', 'Bash', { command: 'npm test' }))

  expect(await ui.findAll({ type: 'Text', text: 'npm test' })).toHaveLength(1)
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
  const stored = stubStore(on)
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
  const name = nameOfAgent(stored, 'agent-1')
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
  // The note stays through the run the message resumed
  expect(await ui.find({ type: 'Text', text: `Sent to ${name}. It had finished; the message resumed it.` })).toBeDefined()
})

test('rows that land in a stopped agent’s conversation with no redirect behind them leave its squishy Squished and Stop’s marks on it', async ($, on) => {
  stubSends(on)
  const { ui } = await focusWithStop($, on)
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  await stepAgent($, 'agent-1')
  await $.turn.complete({ ...finishOf('agent-1'), answer: 'Stopped by the user.' })
  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()

  await appendRow($, promptRowOf('agent-1', '[Request interrupted by user]'))
  await appendRow($, toolUseRowOf('agent-1', 'Read', { file_path: 'src/config.ts' }))

  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/config.ts' })).toBeUndefined()
  // Still remembered as stopped by the user: a late end of the run that answered keeps it Squished
  await $.turn.complete(finishOf('agent-1'))
  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
})

// A resumed run whose turn.complete never comes, and what else says it
// ended. The agent list shows it completed by then.
const ENDS_WITHOUT_COMPLETE: Record<string, ($: Engine, clock: ReturnType<typeof mock.clock>, ui: Mounted<'terminal', 'Pane'>) => Promise<void>> = {
  'the agent list check finds it ended': async ($, clock, ui) => {
    await clock.advance(AGENT_CHECK_MS)
    expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  },
  'its SubagentStop comes': async ($, clock, ui) => {
    await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '', agent_type: 'general-purpose' })
    expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  },
  '/clear rebuilds the session': async $ => {
    await $.classic.SessionStart({ source: 'clear' })
  },
}

for (const [ending, end] of Object.entries(ENDS_WITHOUT_COMPLETE)) {
  test(`a resumed run is over once ${ending}, though its turn.complete never came: a later run’s tool calls show once`, async ($, on) => {
    const clock = mock.clock(on)
    stubSends(on)
    stubSessionStart(on)
    on('classic.SubagentStop', () => ({}))
    const statuses = new Map<string, AgentStatus>([
      ['agent-1', 'completed'],
      ['agent-2', 'running'],
    ])
    stubAgentList(on, statuses)
    const { ui } = await focusOnAgent($, on, PARTNERED)
    await $.turn.complete(finishOf('agent-1'))
    await typeRedirect($, 'Now check the tests')
    statuses.set('agent-1', 'running')
    await appendRow($, promptRowOf('agent-1', `${FROM_USER}Now check the tests`))
    expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()

    statuses.set('agent-1', 'completed')
    await end($, clock, ui)

    // A later run the orchestrator resumes, whose tool calls reach the mod themselves
    await $.tool.call(bashFrom('agent-1', 'npm run lint'))
    await appendRow($, toolUseRowOf('agent-1', 'Bash', { command: 'npm run lint' }))
    expect(await ui.findAll({ type: 'Text', text: 'npm run lint' })).toHaveLength(1)
  })
}

test('going back to the roster from an agent still Asleep after a redirect ends its mark: a later run’s tool calls show once, and a row carrying the redirect still wakes it', async ($, on) => {
  stubSends(on)
  const { ui } = await focusOnAgent($, on)
  await $.turn.complete(finishOf('agent-1'))
  await typeRedirect($, 'Now check the tests')

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  await $.tool.call(bashFrom('agent-1', 'npm run lint'))
  await appendRow($, toolUseRowOf('agent-1', 'Bash', { command: 'npm run lint' }))
  expect(await ui.findAll({ type: 'Text', text: 'npm run lint' })).toHaveLength(1)

  await $.turn.complete(finishOf('agent-1'))
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  await appendRow($, promptRowOf('agent-1', `The coordinator sent a message while you were working:\n${FROM_USER}Now check the tests`))
  expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
})

// Stands in for Claude Code's focus ring in the pane, which the user moves
// (Tab, a click): every move lands. The kit has no implementation of a
// plugin's own $.ui.focus: no test hook or inline plugin sees it, and it
// always rejects. So a test sees that the redirect control made the call
// by its refusal's toast, and the move itself was checked in a session (#49).
function stubFocusRing(on: On): void {
  on('ui.focus', () => ({}))
}

// The user moving the pane's focus ring onto an element
const personFocuses = (element: string) => ({ component: 'Pane', requestId: 'squishys', element, origin: { kind: 'person' } }) as const

// The toast of a move into the Redirect box Claude Code refused, whatever the reason
const REDIRECT_REFUSED = /^Squishys: the Redirect box can’t take the keys: ./

test('the redirect control (i) asks for the keyboard and moves the focus into the Redirect box, saying so when it can’t; the box still sends with Enter', async ($, on) => {
  stubFocusRing(on)
  const panes = stubPanes(on)
  const sent = stubSends(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  const { ui } = await focusOnAgent($, on, PARTNERED)
  const control = await ui.find({ type: 'Button', key: 'focus-redirect' })
  expect(control?.props.hotkey).toBe('i')
  expect(control?.props.label).toBe('Redirect')

  // A click on it presses it without handing the pane the keyboard
  panes.panes.set(PANE_ID, { isPlaced: true, isFocused: false })
  const opens = panes.opens.length
  await $.ui.press({ plugin: 'squishys', key: 'focus-redirect' })
  expect(panes.opens.slice(opens)).toEqual([OPEN_PANE_ASKED])
  expect(toasts).toEqual([expect.stringMatching(REDIRECT_REFUSED)])

  await $.turn.complete(finishOf('agent-1'))
  await typeRedirect($, 'Keep going')
  expect(sent).toEqual([{ to: 'agent-1', text: `${FROM_USER}Keep going` }])
})

test('while the pane has the keyboard but not the Redirect box, the box says to press i, and stops once it has the focus', async ($, on) => {
  stubFocusRing(on)
  mock.store(on, PARTNERED)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const focused = { ...PANE, props: { ...PANE.props, isFocused: true }, surface: 'terminal' } as const
  let ui = await $.ui.mount(focused)
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  const placeholder = async () => (await ui.find({ type: 'Input', key: 'redirect' }))?.props.placeholder

  expect(await placeholder()).toBe('Press i to redirect')
  await $.ui.focus(personFocuses('redirect'))
  expect(await placeholder()).toBe('a message for this agent')
  await $.ui.focus(personFocuses('back'))
  expect(await placeholder()).toBe('Press i to redirect')

  // Esc hands the keys back to the prompt; given back to the pane, its ring starts on nothing
  await $.ui.focus(personFocuses('redirect'))
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await placeholder()).toBe('a message for this agent')
  expect(await ui.find({ type: 'Text', text: focusHint(true) })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(focused)
  expect(await placeholder()).toBe('Press i to redirect')
})
