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

// Each setting is a key that steps it to its next choice, its label saying
// what it's on and what the next press picks
const label = async (ui: { find: (query: { type: 'Button'; key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, key: string) =>
  (await ui.find({ type: 'Button', key }))?.props.label

test('settings start as "let Claude choose" and the most slots', async ($, on) => {
  stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await label(ui, 'model')).toBe('Model for new agents  Let Claude choose ▸ haiku')
  expect(await label(ui, 'slotCap')).toBe('Roster slots, at most  9 ▸ 1')
})

test('every setting answers to a key of its own, and r returns to the roster', async ($, on) => {
  stubStore(on)
  on('fs.exists', () => ({ value: true }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  const keys = Object.fromEntries((await ui.findAll({ type: 'Button' })).map(button => [String(button.props.key), button.props.hotkey]))
  expect(keys).toEqual({ model: 'm', slotCap: 's', liveModelSwitch: 'l', chime: 'c', back: 'r' })
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
})

test('each press steps a setting to its next choice, wrapping around, and is saved to the store', async ($, on) => {
  const stored = stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.press({ plugin: 'squishys', key: 'model' })
  for (let press = 0; press < 4; press += 1) await $.ui.press({ plugin: 'squishys', key: 'slotCap' })

  expect(stored.get('settings')).toEqual({ model: 'haiku', slotCap: 4 })
  expect(await label(ui, 'model')).toBe('Model for new agents  haiku ▸ sonnet')
  expect(await label(ui, 'slotCap')).toBe('Roster slots, at most  4 ▸ 5')

  // haiku, then sonnet, opus and fable, then back to letting Claude choose
  for (let press = 0; press < 4; press += 1) await $.ui.press({ plugin: 'squishys', key: 'model' })
  expect(stored.get('settings')).toEqual({ slotCap: 4 })
  expect(await label(ui, 'model')).toBe('Model for new agents  Let Claude choose ▸ haiku')
})

test('settings saved in an earlier session come back', async ($, on) => {
  stubStore(on, { settings: { model: 'fable', slotCap: 3 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await label(ui, 'model')).toBe('Model for new agents  fable ▸ Let Claude choose')
  expect(await label(ui, 'slotCap')).toBe('Roster slots, at most  3 ▸ 4')
})

test('a stored setting that is no longer valid falls back to its default', async ($, on) => {
  stubStore(on, { settings: { model: 'gpt-4', slotCap: 40 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await label(ui, 'model')).toBe('Model for new agents  Let Claude choose ▸ haiku')
  expect(await label(ui, 'slotCap')).toBe('Roster slots, at most  9 ▸ 1')
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

  await $.ui.press({ plugin: 'squishys', key: 'model' })
  await $.ui.press({ plugin: 'squishys', key: 'model' })
  await $.agent.spawn(spawnOf('toolu_1'))

  expect(models).toEqual(['sonnet'])
})
