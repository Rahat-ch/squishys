import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { compose } from '../src/composer'
import { KIT } from '../src/kit'
import { FRAME_MS } from '../src/pane'
import { halfBlocks } from '../src/raster'
import { PANE, finishOf, readFrom, spawnOf, stepOf, stubBlits, stubSpawns, stubTurns } from './fixtures'
import { cellsOf, spawnAndWatch } from './pictures'

test('pressing a squishy’s button opens its focus view, and r returns to the roster', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn({ ...spawnOf('toolu_2'), description: 'Run the tests' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const name = (await ui.find({ key: 'squishy-agent-2' }))?.props.label

  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-2' })

  expect(await ui.find({ key: 'slot-agent-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: String(name) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'back' }))?.props.hotkey).toBe('r')

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  expect(await ui.find({ key: 'slot-agent-1' })).toBeDefined()
  expect(await ui.find({ key: 'focus' })).toBeUndefined()
})

test('each squishy in the roster answers to its digit, in slot order', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ key: 'squishy-agent-1' }))?.props.hotkey).toBe('1')
  expect((await ui.find({ key: 'squishy-agent-2' }))?.props.hotkey).toBe('2')
})

test('the focus view shows the squishy at 2×, its state and the model its spawn started it on', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const { ui, squishy } = await spawnAndWatch($)
  const inRoster = await ui.find({ type: 'Raster', key: 'picture-agent-1' })

  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  // Twice the roster picture's size each way, from the composer's own 2×
  const picture = await ui.find({ type: 'Raster', key: 'focus-picture-agent-1' })
  expect(picture?.props).toMatchObject(halfBlocks(compose(KIT, squishy, { state: 'working', frame: 0, size: 'double' })))
  expect(picture?.props.columns).toBe(2 * Number(inRoster?.props.columns))
  expect(picture?.props.rows).toBe(2 * Number(inRoster?.props.rows))
  expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('the 2× squishy in the focus view moves like the roster’s, repainted by blits', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  const blits = stubBlits(on)
  const { squishy } = await spawnAndWatch($)
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  await clock.advance(FRAME_MS * 4)

  expect(blits).toEqual([
    { key: 'focus-picture-agent-1', cells: cellsOf(squishy, 'working', 2, 'double') },
    { key: 'focus-picture-agent-1', cells: cellsOf(squishy, 'working', 0, 'double') },
  ])
})

// Spawns agent-1 and opens its focus view, with every tool call answered
async function focusOnAgent($: Engine, on: On) {
  mock.store(on)
  stubSpawns(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return ui
}

// A Bash command the agent with this id runs, as readFrom in fixtures.ts
function bashFrom(agentId: string, command: string) {
  return { tool: 'Bash', command, agentId } as const
}

test('the agent’s tool calls appear in its feed as they happen: the tool and what it was called on', async ($, on) => {
  const ui = await focusOnAgent($, on)
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeUndefined()

  await $.tool.call(readFrom('agent-1', 'src/config.ts'))
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/config.ts' })).toBeDefined()

  await $.tool.call(bashFrom('agent-1', 'npm test -- --grep config'))
  const feed = await ui.find({ key: 'activity' })
  expect(feed?.text).toBe('Readsrc/config.tsBashnpm test -- --grep config')
})

test('a feed shows only its own agent’s tool calls, never another’s or the orchestrator’s', async ($, on) => {
  const ui = await focusOnAgent($, on)
  await $.agent.spawn(spawnOf('toolu_2'))

  await $.tool.call(readFrom('agent-2', 'README.md'))
  await $.tool.call({ tool: 'Read', file_path: 'CONTEXT.md' })

  expect(await ui.find({ type: 'Text', text: 'README.md' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'CONTEXT.md' })).toBeUndefined()
})

test('a feed keeps the latest 50 tool calls', async ($, on) => {
  const ui = await focusOnAgent($, on)

  for (let n = 1; n <= 52; n += 1) await $.tool.call(readFrom('agent-1', `file-${n}.ts`))

  expect(await ui.find({ type: 'Text', text: 'file-2.ts' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'file-3.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'file-52.ts' })).toBeDefined()
})

// The kit waits out a stream left open before each act, so this test acts
// as little as it can while the response streams
test('the feed shows Thinking… while the agent’s response streams', async ($, on) => {
  stubTurns(on)
  const ui = await focusOnAgent($, on)

  const response = $.turn.step(stepOf('agent-1'))
  await response.next()
  expect(await ui.find({ type: 'Text', text: 'Thinking…' })).toBeDefined()
  for await (const _ of response);

  expect(await ui.find({ type: 'Text', text: 'Thinking…' })).toBeUndefined()
})

test('an Asleep agent’s focus view still shows its activity, and its final answer as markdown', async ($, on) => {
  stubTurns(on)
  const ui = await focusOnAgent($, on)
  await $.tool.call(readFrom('agent-1', 'src/config.ts'))

  await $.turn.complete(finishOf('agent-1'))

  expect(await ui.find({ type: 'Text', text: 'Asleep' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/config.ts' })).toBeDefined()
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Found it in src/config.ts')
})

test('a final answer too long to draw is cut short, and says so', async ($, on) => {
  stubTurns(on)
  const ui = await focusOnAgent($, on)

  await $.turn.complete({ ...finishOf('agent-1'), answer: 'word '.repeat(3000) })

  const text = String((await ui.find({ type: 'Markdown' }))?.props.text)
  expect(text.length).toBeLessThanOrEqual(10000)
  expect(text.startsWith('word word')).toBe(true)
  expect(text.endsWith('(cut short)')).toBe(true)
})

test('the squishy of the agent open in the main view is marked in the roster', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: 'agent-2' } }, surface: 'terminal' })

  expect(await ui.find({ key: 'in-view-agent-2' })).toBeDefined()
  expect(await ui.find({ key: 'in-view-agent-1' })).toBeUndefined()
})

test('with the orchestrator in the main view, no squishy is marked', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'in-view-agent-1' })).toBeUndefined()
})
