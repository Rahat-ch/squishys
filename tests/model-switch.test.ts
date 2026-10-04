import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, drain, spawnOf, stepOf, stubSpawns, stubStore } from './fixtures'

// Stands in for Claude Code sending each model request, keeping the model
// each one reached Claude Code with, by the loop it was made in
function sentModels(on: On): { agentId: string | undefined; model: string }[] {
  const sent: { agentId: string | undefined; model: string }[] = []
  on('turn.step', async function* ($, e) {
    sent.push({ agentId: e.agentId, model: e.model })
    yield { kind: 'text', index: 0, text: 'Looking' } as const
    return { turnId: e.turnId, index: e.index, answer: 'Looking', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return sent
}

// Spawns agent-1 and agent-2 with the store as `settings` left it, and opens
// agent-1's focus view
async function focusOnAgent($: Engine, on: On, settings?: Record<string, unknown>) {
  const stored = stubStore(on, settings === undefined ? {} : { settings })
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return { ui, stored }
}

const SWITCH_ON = { slotCap: 9, liveModelSwitch: true }

test('the live model switch is off by default, labeled experimental, and the focus view has no model picker', async ($, on) => {
  const { ui } = await focusOnAgent($, on)
  expect(await ui.find({ type: 'Select', key: 'model-switch' })).toBeUndefined()

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  const setting = await ui.find({ type: 'Select', key: 'liveModelSwitch' })
  expect(setting?.props.value).toBe('off')
  expect(String(setting?.props.label)).toMatch(/^Experimental/)
})

test('turning the live model switch on is saved, and gives the focus view a model picker', async ($, on) => {
  const { ui, stored } = await focusOnAgent($, on)
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })

  await $.ui.select({ plugin: 'squishys', key: 'liveModelSwitch', value: 'on' })
  expect(stored.get('settings')).toEqual(SWITCH_ON)

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  const picker = await ui.find({ type: 'Select', key: 'model-switch' })
  expect((picker?.props.options as { value: string }[]).map(option => option.value)).toEqual(['as-started', 'haiku', 'sonnet', 'opus', 'fable'])
  expect(picker?.props.value).toBe('as-started')
})

test('a model picked in the focus view is used by that agent’s next requests alone, and shown as switched', async ($, on) => {
  const sent = sentModels(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await $.ui.select({ plugin: 'squishys', key: 'model-switch', value: 'sonnet' })
  await drain($.turn.step(stepOf('agent-1')))
  await drain($.turn.step(stepOf('agent-2')))
  await drain($.turn.step({ ...stepOf('agent-1'), agentId: undefined, turnId: 'turn-main' }))
  await drain($.turn.step({ ...stepOf('agent-1'), index: 1 }))

  expect(sent).toEqual([
    { agentId: 'agent-1', model: 'sonnet' },
    { agentId: 'agent-2', model: 'claude-opus-5-5' },
    { agentId: undefined, model: 'claude-opus-5-5' },
    { agentId: 'agent-1', model: 'sonnet' },
  ])
  expect(await ui.find({ type: 'Text', text: 'sonnet (switched)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeUndefined()
  expect((await ui.find({ type: 'Select', key: 'model-switch' }))?.props.value).toBe('sonnet')
})

test('picking "as started" undoes the switch', async ($, on) => {
  const sent = sentModels(on)
  const { ui } = await focusOnAgent($, on, SWITCH_ON)

  await $.ui.select({ plugin: 'squishys', key: 'model-switch', value: 'haiku' })
  await $.ui.select({ plugin: 'squishys', key: 'model-switch', value: 'as-started' })
  await drain($.turn.step(stepOf('agent-1')))

  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})

test('turning the live model switch off undoes every switch and takes the picker away', async ($, on) => {
  const sent = sentModels(on)
  const { ui, stored } = await focusOnAgent($, on, SWITCH_ON)
  await $.ui.select({ plugin: 'squishys', key: 'model-switch', value: 'opus' })

  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  await $.ui.select({ plugin: 'squishys', key: 'liveModelSwitch', value: 'off' })
  await drain($.turn.step(stepOf('agent-1')))

  expect(stored.get('settings')).toEqual({ slotCap: 9 })
  expect(sent).toEqual([{ agentId: 'agent-1', model: 'claude-opus-5-5' }])
  await $.ui.press({ plugin: 'squishys', key: 'back' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await ui.find({ type: 'Select', key: 'model-switch' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
})
