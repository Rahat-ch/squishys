import { expect, test } from 'claude-code/testing'

import { PANE, readFrom, spawnOf } from './fixtures'

// The glyph of every cell in a Raster's packed `cells`
function glyphsOf(cells: unknown): string[] {
  const bytes = atob(String(cells))
  const glyphs: string[] = []
  for (let at = 0; at < bytes.length; at += 12) {
    let codePoint = 0
    for (let byte = 3; byte >= 0; byte -= 1) codePoint = codePoint * 256 + bytes.charCodeAt(at + byte)
    glyphs.push(String.fromCodePoint(codePoint))
  }
  return glyphs
}

test('spawning an agent adds a roster entry with a 16x16 half-block squishy and a named button', async ($, on) => {
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-1' }))

  await $.agent.spawn(spawnOf('toolu_1'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const sprite = await ui.find({ type: 'Raster' })
  // 16 pixels across, and 16 down packed two to a cell
  expect(sprite?.props).toMatchObject({ columns: 16, rows: 8 })
  const glyphs = glyphsOf(sprite?.props.cells)
  expect(glyphs).toHaveLength(16 * 8)
  expect(glyphs.every(glyph => ['▀', '▄', ' '].includes(glyph))).toBe(true)
  expect(glyphs).toContain('▀')
  expect(await ui.find({ type: 'Button', text: 'Squishy 1' })).toBeDefined()
})

test('each agent gets its own roster entry', async ($, on) => {
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `agent-${++spawned}` }))

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
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-1' }))
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
