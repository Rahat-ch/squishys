// Every control in the pane answers to a hotkey of its own (AGENTS.md, "Keys"):
// each Button has a hotkey no other control in its mode has, and no mode
// draws a Select. The band has none by design, and is left out.

import { expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { KIT, everySpecies } from '../src/kit'
import { bareAccessory, legendaryKey } from '../src/roller'
import { agentShareKey } from '../src/share'
import { LABEL_SLOT_ROWS, MINI_SLOT_ROWS } from '../src/slots'
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

test('the roster’s mini and label slots, in a short inline pane, keep the digits, the footer its letters', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  for (const id of ['toolu_1', 'toolu_2']) await $.agent.spawn(spawnOf(id))
  const bodyColumns = roomFor('inline', 6, 1).bodyColumns
  const expected = { partner: '1', 'squishy-agent-1': '2', 'squishy-agent-2': '3', settings: 'o', squishydex: 'd' }

  for (const bodyRows of [MINI_SLOT_ROWS, LABEL_SLOT_ROWS]) {
    const ui = await $.ui.mount({ ...paneSized({ placement: 'inline', bodyColumns, bodyRows }), surface: 'terminal' })
    expect({ bodyRows, hotkeys: await hotkeysOf(ui) }).toEqual({ bodyRows, hotkeys: expected })
    await ui.unmount()
  }
})

test('the focus view: r back, s Stop, m the model, e the effort, i Redirect, 1 the partner, and x Share once it’s Asleep', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 9, liveModelSwitch: true } })
  on('settings.read', () => ({ value: {} }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  expect(await hotkeysOf(ui)).toEqual({ back: 'r', stop: 's', partner: '1', 'model-switch-agent-1': 'm', 'effort-switch-agent-1': 'e', 'focus-redirect': 'i' })
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

// The hotkeys of the picks a mode drew, in drawing order
async function pickHotkeys(ui: Mounted<'terminal', 'Pane'>, keyed: RegExp): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).filter(button => keyed.test(String(button.key))).map(button => String(button.props.hotkey))
}

// The digits, then the letters `taken` leaves free, as many as `count`
const digitsThenLetters = (count: number, taken: string) => [...'123456789abcdefghijklmnopqrstuvwxyz'].filter(key => !taken.includes(key)).slice(0, count)

test('past nine picks, the roster and its overflow list go on to the letters their footer leaves free', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  for (let n = 1; n <= 11; n += 1) await $.agent.spawn(spawnOf(`toolu_${n}`))

  // The partner and nine agents, the most slots there are
  const roster = await $.ui.mount({ ...paneSized(roomFor('dock', 5, 2)), surface: 'terminal' })
  await hotkeysOf(roster)
  expect(await pickHotkeys(roster, /^(partner|squishy-)/)).toEqual(digitsThenLetters(10, 'mod'))
  await roster.unmount()

  // With room for one slot, the list that opens from the count holds the rest
  const narrow = await $.ui.mount({ ...paneSized(roomFor('dock', 1, 1)), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'overflow' })
  await hotkeysOf(narrow)
  const listed = await pickHotkeys(narrow, /^squishy-/)
  expect(listed.length).toBeGreaterThan(9)
  expect(listed).toEqual(digitsThenLetters(listed.length, 'mod'))
})

test('past nine places met on a page, the Squishydex goes on to the letters its pages leave free', async ($, on) => {
  const species = everySpecies(KIT).slice(0, 12)
  const variant = variantKey({ palette: KIT.palettes[0]?.id ?? '', accessory: bareAccessory(KIT)?.id ?? '', shiny: false })
  stubStore(on, { [SQUISHYDEX_KEY]: { species: Object.fromEntries(species.map(each => [speciesKey(each), { met: 0, variants: [variant] }])), legendaries: {} } })
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 200, bodyRows: 60 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })

  await hotkeysOf(ui)
  expect(await pickHotkeys(ui, /^squishydex-pick-/)).toEqual(digitsThenLetters(12, 'npr'))
})

test('the starter pick: 1 to 3 pick a starter', async ($, on) => {
  stubStore(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await hotkeysOf(ui)).toEqual(Object.fromEntries(KIT.starters.map((_, index) => [`starter-${index + 1}`, String(index + 1)])))
})

test('a legendary’s card: b back to the pages and r the roster', async ($, on) => {
  const [legendary] = KIT.legendaries
  if (legendary === undefined) throw new Error('The kit needs a legendary')
  stubStore(on, { [SQUISHYDEX_KEY]: { species: {}, legendaries: { [legendary.id]: { met: 0 } } } })
  // Room for every place on one page, the legendaries last
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${legendaryKey(legendary.id)}` })

  expect(await hotkeysOf(ui)).toEqual({ 'squishydex-back': 'b', 'squishydex-roster': 'r' })
})
