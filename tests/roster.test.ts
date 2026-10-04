import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

import { PANE, glyphsOf, readFrom, spawnOf, stubSpawns } from './fixtures'

test('a spawned agent’s squishy shows as a 16x16 half-block picture, its name, and the agent’s description underneath', async ($, on) => {
  mock.store(on)
  stubSpawns(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const slot = await ui.find({ key: 'slot-agent-1' })
  const [picture, name, description] = (slot?.children ?? []) as FoundElement[]
  // 16 pixels across, and 16 down packed two to a cell
  expect(picture).toMatchObject({ type: 'Raster', props: { columns: 16, rows: 8 } })
  const glyphs = glyphsOf(picture?.props.cells)
  expect(glyphs).toHaveLength(16 * 8)
  expect(glyphs.every(glyph => ['▀', '▄', ' '].includes(glyph))).toBe(true)
  expect(glyphs).toContain('▀')
  expect(name).toMatchObject({ type: 'Button', props: { label: expect.stringMatching(/^[A-Z]/) } })
  expect(description).toMatchObject({ type: 'Text', children: ['Find config parser'] })
})

test('each agent gets its own roster entry, under its own description', async ($, on) => {
  mock.store(on)
  stubSpawns(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn({ ...spawnOf('toolu_2'), description: 'Fork the plan', fork: true, subagentType: 'fork' })
  await $.agent.spawn({ ...spawnOf('toolu_3'), description: 'Run the tests', background: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(3)
  const names = (await ui.findAll({ type: 'Button' })).filter(button => button.key !== 'settings')
  expect(names).toHaveLength(3)
  for (const description of ['Find config parser', 'Fork the plan', 'Run the tests']) {
    expect(await ui.find({ type: 'Text', text: description })).toBeDefined()
  }
})

test('no two agents in the roster share a squishy', async ($, on) => {
  mock.store(on)
  stubSpawns(on)

  // Rolled at random, twenty from the placeholder kit would all but
  // certainly repeat one if the live squishys weren't left out
  for (let n = 1; n <= 20; n += 1) await $.agent.spawn(spawnOf(`toolu_${n}`))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const pictures = (await ui.findAll({ type: 'Raster' })).map(picture => picture.props.cells)
  expect(pictures).toHaveLength(20)
  expect(new Set(pictures).size).toBe(20)
})

test('an agent first seen through a tool call gets one squishy too', async ($, on) => {
  // An in-process teammate that no agent.spawn announced
  on('agent.list', () => ({
    value: [{ id: 'teammate-1', description: 'Review the docs', type: 'teammate', status: 'running' }],
  }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call(readFrom('teammate-1', 'README.md'))
  await $.tool.call(readFrom('teammate-1', 'CONTEXT.md'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(1)
  expect(await ui.find({ type: 'Button', key: 'squishy-teammate-1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Review the docs' })).toBeDefined()
})

test('a spawned agent keeps its one squishy as it calls tools', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  on('agent.list', () => ({
    value: [{ id: 'agent-1', description: 'Find config parser', type: 'general-purpose', status: 'running' }],
  }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.tool.call(readFrom('agent-1', 'README.md'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(1)
})

test('a tool call from a loop the agent list does not name gets no squishy', async ($, on) => {
  // Workflow agents and Claude Code's own forks carry ids the list leaves out
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call(readFrom('workflow-1', 'README.md'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('an id the agent list does not name is looked up only once', async ($, on) => {
  let lookups = 0
  on('agent.list', () => {
    lookups += 1
    return { value: [] }
  })
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call(readFrom('workflow-1', 'README.md'))
  await $.tool.call(readFrom('workflow-1', 'CONTEXT.md'))

  expect(lookups).toBe(1)
})
