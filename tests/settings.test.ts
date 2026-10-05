import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cycleLabel } from '../src/keys'
import { MODEL_DEFAULT_LABEL, SLOT_CAP_LABEL } from '../src/settings'
import { PANE, controlLabel, spawnOf, stubSpawns, stubStore } from './fixtures'

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

// Each setting is a control whose hotkey steps it to its next choice, its
// label saying what it's on and what the next press picks
const label = controlLabel
const model = (now: string, next: string) => cycleLabel(MODEL_DEFAULT_LABEL, now, next)
const slots = (now: number, next: number) => cycleLabel(SLOT_CAP_LABEL, String(now), String(next))

test('settings start as "let Claude choose" and the most slots', async ($, on) => {
  stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await label(ui, 'model')).toBe(model('Let Claude choose', 'haiku'))
  expect(await label(ui, 'slotCap')).toBe(slots(9, 1))
})

test('every setting answers to a hotkey of its own, and r returns to the roster', async ($, on) => {
  stubStore(on)
  on('fs.exists', () => ({ value: true }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  const keys = Object.fromEntries((await ui.findAll({ type: 'Button' })).map(button => [String(button.props.key), button.props.hotkey]))
  expect(keys).toEqual({ model: 'm', slotCap: 's', chime: 'c', back: 'r' })
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
})

test('each press steps a setting to its next choice, wrapping around, and is saved to the store', async ($, on) => {
  const stored = stubStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.press({ plugin: 'squishys', key: 'model' })
  for (let press = 0; press < 4; press += 1) await $.ui.press({ plugin: 'squishys', key: 'slotCap' })

  expect(stored.get('settings')).toEqual({ model: 'haiku', slotCap: 4 })
  expect(await label(ui, 'model')).toBe(model('haiku', 'sonnet'))
  expect(await label(ui, 'slotCap')).toBe(slots(4, 5))

  // haiku, then sonnet, opus and fable, then back to letting Claude choose
  for (let press = 0; press < 4; press += 1) await $.ui.press({ plugin: 'squishys', key: 'model' })
  expect(stored.get('settings')).toEqual({ slotCap: 4 })
  expect(await label(ui, 'model')).toBe(model('Let Claude choose', 'haiku'))
})

test('settings saved in an earlier session come back', async ($, on) => {
  stubStore(on, { settings: { model: 'fable', slotCap: 3 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await label(ui, 'model')).toBe(model('fable', 'Let Claude choose'))
  expect(await label(ui, 'slotCap')).toBe(slots(3, 4))
})

test('a stored setting that is no longer valid falls back to its default', async ($, on) => {
  stubStore(on, { settings: { model: 'gpt-4', slotCap: 40 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await label(ui, 'model')).toBe(model('Let Claude choose', 'haiku'))
  expect(await label(ui, 'slotCap')).toBe(slots(9, 1))
})

test('the removed live model switch setting, saved by an earlier version, is dropped at the next save', async ($, on) => {
  const stored = stubStore(on, { settings: { slotCap: 9, liveModelSwitch: true } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  expect(await ui.find({ type: 'Button', key: 'liveModelSwitch' })).toBeUndefined()
  await $.ui.press({ plugin: 'squishys', key: 'slotCap' })
  expect(stored.get('settings')).toEqual({ slotCap: 1 })
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

test('two presses before the first is saved step a setting twice', async ($, on) => {
  // A store that answers a read with what it held then, a few turns of the
  // event loop later, so a second press can read before the first one writes
  const stored = new Map<string, unknown>()
  on('store.get', async ($, e) => {
    const value = stored.get(e.key)
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    return { value }
  })
  on('store.set', ($, e) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await Promise.all([$.ui.press({ plugin: 'squishys', key: 'slotCap' }), $.ui.press({ plugin: 'squishys', key: 'slotCap' })])
  await Promise.all([$.ui.press({ plugin: 'squishys', key: 'model' }), $.ui.press({ plugin: 'squishys', key: 'model' })])

  expect(await label(ui, 'slotCap')).toBe(slots(2, 3))
  expect(await label(ui, 'model')).toBe(model('sonnet', 'opus'))
  expect(stored.get('settings')).toEqual({ model: 'sonnet', slotCap: 2 })
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
