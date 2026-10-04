// Every control in the pane answers to a key of its own (AGENTS.md, "Keys"):
// each Button has a hotkey no other control in its mode has, and no mode
// draws a Select. The band has none by design, and is left out.

import { expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { KIT } from '../src/kit'
import { bareAccessory } from '../src/roller'
import { agentShareKey } from '../src/share'
import { SQUISHYDEX_KEY, speciesKey, variantKey } from '../src/squishydex-record'
import { PANE, PARTNERED, finishOf, paneSized, roomFor, spawnOf, stubSpawns, stubStore } from './fixtures'

// Each Button's hotkey, by its key; fails on a Button without one, two on one key, or a Select
async function hotkeysOf(ui: Mounted<'terminal', 'Pane'>): Promise<Record<string, string>> {
  const buttons = await ui.findAll({ type: 'Button' })
  const keys = Object.fromEntries(buttons.map(button => [String(button.key), String(button.props.hotkey)]))
  for (const button of buttons) expect([button.key, button.props.hotkey]).toEqual([button.key, expect.stringMatching(/^[0-9a-z]$/)])
  expect(new Set(Object.values(keys)).size).toBe(buttons.length)
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  return keys
}

test('the roster: digits pick the squishys, m the overflow, o settings and d the Squishydex; the overflow list picks by digit too', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 2 } })
  stubSpawns(on)
  for (const id of ['toolu_1', 'toolu_2', 'toolu_3']) await $.agent.spawn(spawnOf(id))
  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 4, 1)), surface: 'terminal' })

  expect(await hotkeysOf(ui)).toEqual({ partner: '1', 'squishy-agent-1': '2', 'squishy-agent-2': '3', overflow: 'm', settings: 'o', squishydex: 'd' })
  await $.ui.press({ plugin: 'squishys', key: 'overflow' })
  expect(await hotkeysOf(ui)).toEqual({ 'squishy-agent-3': '1', overflow: 'm', settings: 'o', squishydex: 'd' })
})

test('the focus view: r back, s Stop, m the model, i Redirect, 1 the partner, and x Share once it’s Asleep', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 9, liveModelSwitch: true } })
  on('settings.read', () => ({ value: {} }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  expect(await hotkeysOf(ui)).toEqual({ back: 'r', stop: 's', partner: '1', 'model-switch-agent-1': 'm', 'focus-redirect': 'i' })
  // The redirect Input is reached by its key
  expect(await ui.find({ type: 'Input', key: 'redirect' })).toBeDefined()

  await $.turn.complete(finishOf('agent-1'))
  expect(await hotkeysOf(ui)).toEqual({ back: 'r', partner: '1', [agentShareKey('agent-1')]: 'x', 'focus-redirect': 'i' })
})

test('the Squishydex: digits pick the places met, then n, p and r; a card has m, c, x, b and r', async ($, on) => {
  const [species] = KIT.starters
  const [first, second] = KIT.palettes
  const bare = bareAccessory(KIT)?.id ?? ''
  if (species === undefined || first === undefined || second === undefined) throw new Error('The kit needs a starter and two palettes')
  const variants = [first, second].map(palette => variantKey({ palette: palette.id, accessory: bare, shiny: false }))
  stubStore(on, { [SQUISHYDEX_KEY]: { species: { [speciesKey(species)]: { met: 0, variants } }, legendaries: {} } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })

  const pages = await hotkeysOf(ui)
  expect(pages[`squishydex-pick-${speciesKey(species)}`]).toBe('1')
  expect(pages['squishydex-roster']).toBe('r')

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${speciesKey(species)}` })
  const card = await hotkeysOf(ui)
  expect(card).toMatchObject({ 'squishydex-partner': 'm', 'squishydex-palette': 'c', 'squishydex-back': 'b', 'squishydex-roster': 'r' })
  expect(Object.values(card)).toContain('x')
})
