import { expect, test } from 'claude-code/testing'

import { PANE, glyphsOf, readFrom, spawnOf, stubSpawns } from './fixtures'

test('spawning an agent adds a roster entry with a 16x16 half-block squishy and a named button', async ($, on) => {
  stubSpawns(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picture = await ui.find({ type: 'Raster' })
  // 16 pixels across, and 16 down packed two to a cell
  expect(picture?.props).toMatchObject({ columns: 16, rows: 8 })
  const glyphs = glyphsOf(picture?.props.cells)
  expect(glyphs).toHaveLength(16 * 8)
  expect(glyphs.every(glyph => ['▀', '▄', ' '].includes(glyph))).toBe(true)
  expect(glyphs).toContain('▀')
  expect(await ui.find({ type: 'Button', text: 'Squishy 1' })).toBeDefined()
})

test('each agent gets its own roster entry', async ($, on) => {
  stubSpawns(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn({ ...spawnOf('toolu_2'), fork: true, subagentType: 'fork' })
  await $.agent.spawn({ ...spawnOf('toolu_3'), background: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(3)
  const names = (await ui.findAll({ type: 'Button' })).map(button => button.text)
  expect(names).toEqual(['Squishy 1', 'Squishy 2', 'Squishy 3'])
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
  expect(await ui.find({ type: 'Button', text: 'Squishy 1' })).toBeDefined()
})

test('a spawned agent keeps its one squishy as it calls tools', async ($, on) => {
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
