import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, spawnOf, stubSpawns, stubStore } from './fixtures'

// Button hotkeys can only be a digit or a lowercase letter, so the spec's
// `,` can't open settings: `o` (options) does, and `r` returns to the roster.
test('o opens settings in place of the roster, and r returns to the roster', async ($, on) => {
  stubStore(on)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'settings' }))?.props.hotkey).toBe('o')

  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  expect(await ui.find({ type: 'Text', text: 'Settings' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'back' }))?.props.hotkey).toBe('r')

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Settings' })).toBeUndefined()
})

test('settings start as "let Claude choose" and the most slots', async ($, on) => {
  stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect((await ui.find({ type: 'Select', key: 'model' }))?.props.value).toBe('let-claude-choose')
  expect((await ui.find({ type: 'Select', key: 'slotCap' }))?.props.value).toBe('9')
})

test('no setting’s label ends in a colon, since Claude Code draws one after it', async ($, on) => {
  stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  const labels = (await ui.findAll({ type: 'Select' })).map(select => String(select.props.label))
  expect(labels.length).toBeGreaterThan(0)
  for (const label of labels) expect(label).not.toMatch(/:\s*$/)
})

test('picked settings are saved to the store', async ($, on) => {
  const stored = stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.select({ plugin: 'squishys', key: 'model', value: 'haiku' })
  await $.ui.select({ plugin: 'squishys', key: 'slotCap', value: '4' })

  expect(stored.get('settings')).toEqual({ model: 'haiku', slotCap: 4 })
  expect((await ui.find({ type: 'Select', key: 'model' }))?.props.value).toBe('haiku')
  expect((await ui.find({ type: 'Select', key: 'slotCap' }))?.props.value).toBe('4')

  await $.ui.select({ plugin: 'squishys', key: 'model', value: 'let-claude-choose' })
  expect(stored.get('settings')).toEqual({ slotCap: 4 })
})

test('settings saved in an earlier session come back', async ($, on) => {
  stubStore(on, { settings: { model: 'fable', slotCap: 3 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect((await ui.find({ type: 'Select', key: 'model' }))?.props.value).toBe('fable')
  expect((await ui.find({ type: 'Select', key: 'slotCap' }))?.props.value).toBe('3')
})

test('a stored setting that is no longer valid falls back to its default', async ($, on) => {
  stubStore(on, { settings: { model: 'gpt-4', slotCap: 40 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect((await ui.find({ type: 'Select', key: 'model' }))?.props.value).toBe('let-claude-choose')
  expect((await ui.find({ type: 'Select', key: 'slotCap' }))?.props.value).toBe('9')
})

// Answers each agent.spawn as Claude Code would, keeping the model each one
// reached Claude Code with
function spawnedModels(on: On): (string | undefined)[] {
  const models: (string | undefined)[] = []
  on('agent.spawn', ($, e) => {
    models.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: `agent-${models.length}` }
  })
  return models
}

test('with "let Claude choose", spawns reach Claude Code untouched', async ($, on) => {
  stubStore(on)
  const models = spawnedModels(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn({ ...spawnOf('toolu_2'), model: 'opus' })

  expect(models).toEqual([undefined, 'opus'])
})

test('with a model set, every new agent starts on it, over Claude’s pick', async ($, on) => {
  stubStore(on, { settings: { model: 'haiku', slotCap: 9 } })
  const models = spawnedModels(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn({ ...spawnOf('toolu_2'), model: 'opus' })
  await $.agent.spawn({ ...spawnOf('toolu_3'), background: true })

  expect(models).toEqual(['haiku', 'haiku', 'haiku'])
})

test('forks keep inheriting the model they forked from', async ($, on) => {
  stubStore(on, { settings: { model: 'haiku', slotCap: 9 } })
  const models = spawnedModels(on)

  await $.agent.spawn({ ...spawnOf('toolu_1'), fork: true, subagentType: 'fork' })

  expect(models).toEqual([undefined])
})

test('a store that cannot be read leaves spawns untouched and still assigns squishys', async ($, on) => {
  on('store.get', () => ({ deny: 'store unavailable' }))
  const models = spawnedModels(on)

  await $.agent.spawn(spawnOf('toolu_1'))

  expect(models).toEqual([undefined])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
})

test('a model picked in settings applies to the next spawn', async ($, on) => {
  stubStore(on)
  const models = spawnedModels(on)
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.select({ plugin: 'squishys', key: 'model', value: 'sonnet' })
  await $.agent.spawn(spawnOf('toolu_1'))

  expect(models).toEqual(['sonnet'])
})
