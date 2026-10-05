// Every control in the pane answers to a hotkey of its own (AGENTS.md, "Keys"):
// each Button has a hotkey no other control in its mode has, and no mode
// draws a Select. Every hotkey a mode can show is held in every state of
// that mode: a control that doesn't apply is drawn held, dimmed, and its
// press toasts why, so its key never reaches the prompt. The band has none
// by design, and is left out.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'

import { KIT, everySpecies } from '../src/kit'
import { bareAccessory, legendaryKey } from '../src/roller'
import { agentShareKey } from '../src/share'
import { LABEL_SLOT_ROWS, MINI_SLOT_ROWS } from '../src/slots'
import { SQUISHYDEX_KEY, speciesKey, variantKey } from '../src/squishydex-record'
import { HELD_PREFIX } from '../src/held'
import { PARTNER_KEY } from '../src/partner'
import { PANE, PARTNERED, finishOf, paneSized, roomFor, spawnOf, stubAgentList, stubPanes, stubSpawns, stubStore } from './fixtures'

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
  // With no overflow, its count is held
  const expected = { partner: '1', 'squishy-agent-1': '2', 'squishy-agent-2': '3', 'held-overflow': 'm', settings: 'o', squishydex: 'd' }

  for (const bodyRows of [MINI_SLOT_ROWS, LABEL_SLOT_ROWS]) {
    const ui = await $.ui.mount({ ...paneSized({ placement: 'inline', bodyColumns, bodyRows }), surface: 'terminal' })
    expect({ bodyRows, hotkeys: await hotkeysOf(ui) }).toEqual({ bodyRows, hotkeys: expected })
    await ui.unmount()
  }
})

test('the focus view: r back, s Stop, m the model, e the effort, i Redirect, 1 the partner, and x Share, held until it’s Asleep', async ($, on) => {
  stubStore(on, { ...PARTNERED, settings: { slotCap: 9, liveModelSwitch: true } })
  on('settings.read', () => ({ value: {} }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  expect(await hotkeysOf(ui)).toEqual({
    back: 'r',
    stop: 's',
    partner: '1',
    [`held-${agentShareKey('agent-1')}`]: 'x',
    'model-switch-agent-1': 'm',
    'effort-switch-agent-1': 'e',
    'focus-redirect': 'i',
  })
  // The redirect Input is reached by its key
  expect(await ui.find({ type: 'Input', key: 'redirect' })).toBeDefined()

  await $.turn.complete(finishOf('agent-1'))
  expect(await hotkeysOf(ui)).toEqual({ back: 'r', 'held-stop': 's', partner: '1', [agentShareKey('agent-1')]: 'x', 'focus-redirect': 'i' })
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

// Keeps each toast's text
function stubToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

// The hotkeys a mode drew, whatever their controls are keyed, in order
async function heldHotkeys(ui: Mounted<'terminal', 'Pane'>): Promise<string[]> {
  return Object.values(await hotkeysOf(ui)).sort()
}

// Presses each held control the mode drew: it's dimmed, its press toasts
// why it doesn't apply, and nothing else changes
async function pressHeld($: Engine, ui: Mounted<'terminal', 'Pane'>, toasts: string[]): Promise<string[]> {
  const held = (await ui.findAll({ type: 'Button' })).filter(button => String(button.key).startsWith(HELD_PREFIX))
  const before = await hotkeysOf(ui)
  for (const button of held) {
    expect([button.key, button.props.dimColor]).toEqual([button.key, true])
    const toasted = toasts.length
    await $.ui.press({ plugin: 'squishys', key: String(button.key) })
    expect([button.key, toasts.slice(toasted)]).toEqual([button.key, [expect.stringMatching(/^Squishys: \S/)]])
    expect(await hotkeysOf(ui)).toEqual(before)
  }
  return held.map(button => String(button.key))
}

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

test('a legendary’s card: b back to the pages and r the roster, with m, c and x held', async ($, on) => {
  const [legendary] = KIT.legendaries
  if (legendary === undefined) throw new Error('The kit needs a legendary')
  stubStore(on, { [SQUISHYDEX_KEY]: { species: {}, legendaries: { [legendary.id]: { met: 0 } } } })
  // Room for every place on one page, the legendaries last
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${legendaryKey(legendary.id)}` })

  expect(await hotkeysOf(ui)).toEqual({ 'held-squishydex-palette': 'c', 'held-squishydex-partner': 'm', 'held-share': 'x', 'squishydex-back': 'b', 'squishydex-roster': 'r' })
})

test('the roster holds m with no overflow: drawn as +0, dimmed, its press says why', async ($, on) => {
  const toasts = stubToasts(on)
  stubStore(on, PARTNERED)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 4, 1)), surface: 'terminal' })

  expect(await hotkeysOf(ui)).toEqual({ partner: '1', 'squishy-agent-1': '2', 'held-overflow': 'm', settings: 'o', squishydex: 'd' })
  expect((await ui.find({ type: 'Button', key: 'held-overflow' }))?.props.label).toBe('+0')
  expect(await pressHeld($, ui, toasts)).toEqual(['held-overflow'])
  expect(await ui.find({ key: 'overflow-list' })).toBeUndefined()
})

// The focus view's hotkeys besides the model and effort controls, which
// another ticket reworks: r, s, 1, x and i in every state
const FOCUS_HOTKEYS = ['1', 'i', 'r', 's', 'x']

test('the focus view holds s, x and 1 in every state: running, stopping, Asleep, Squished, and with no partner', async ($, on) => {
  const toasts = stubToasts(on)
  const stored = stubStore(on, PARTNERED)
  // Stop's presses read the clock
  mock.clock(on)
  const statuses = new Map<string, AgentStatus>([['agent-2', 'running']])
  stubAgentList(on, statuses)
  // TaskStop refused: agent-2 is held back, its stop under way
  on('tool.call', { tool: 'TaskStop' }, () => ({ deny: 'Permission to use TaskStop has been denied.' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  stubSpawns(on)
  for (const id of ['toolu_1', 'toolu_2', 'toolu_3']) await $.agent.spawn(spawnOf(id))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const focusOn = async (agentId: string) => {
    if ((await ui.find({ type: 'Button', key: 'back' })) !== undefined) await $.ui.press({ plugin: 'squishys', key: 'back' })
    await $.ui.press({ plugin: 'squishys', key: `squishy-${agentId}` })
  }
  const held: Record<string, string[]> = {}

  // Working: Share is held
  await focusOn('agent-1')
  expect(await heldHotkeys(ui)).toEqual(FOCUS_HOTKEYS)
  held.working = await pressHeld($, ui, toasts)

  // A stop under way: Stop is held too
  await focusOn('agent-2')
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  await $.ui.press({ plugin: 'squishys', key: 'stop' })
  expect(await heldHotkeys(ui)).toEqual(FOCUS_HOTKEYS)
  held.stopping = await pressHeld($, ui, toasts)

  // Asleep: Stop is held, Share isn't
  await $.turn.complete(finishOf('agent-1'))
  await focusOn('agent-1')
  expect(await heldHotkeys(ui)).toEqual(FOCUS_HOTKEYS)
  held.asleep = await pressHeld($, ui, toasts)

  // Squished: Stop and Share are held
  await $.turn.complete(finishOf('agent-3', 'error'))
  await focusOn('agent-3')
  expect(await heldHotkeys(ui)).toEqual(FOCUS_HOTKEYS)
  held.squished = await pressHeld($, ui, toasts)

  // With no partner saved, 1 is held
  stored.delete(PARTNER_KEY)
  await focusOn('agent-1')
  expect(await heldHotkeys(ui)).toEqual(FOCUS_HOTKEYS)
  held.noPartner = await pressHeld($, ui, toasts)

  expect(held).toEqual({
    working: [`held-${agentShareKey('agent-1')}`],
    stopping: ['held-stop', `held-${agentShareKey('agent-2')}`],
    asleep: ['held-stop'],
    squished: ['held-stop', `held-${agentShareKey('agent-3')}`],
    noPartner: ['held-stop', 'held-partner'],
  })
  // Each says why
  expect(toasts.filter(toast => /Stop|stop|Share|share|partner/.test(toast))).toHaveLength(toasts.length)
})

test('settings hold c where no chime plays: dimmed, its press says why', async ($, on) => {
  const toasts = stubToasts(on)
  stubStore(on)
  let afplay = true
  on('fs.exists', ($, e) => ({ value: afplay && e.path === '/usr/bin/afplay' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'settings' })
  expect(await hotkeysOf(ui)).toEqual({ model: 'm', slotCap: 's', liveModelSwitch: 'l', chime: 'c', back: 'r' })

  afplay = false
  await ui.redraw(PANE.props)
  expect(await hotkeysOf(ui)).toEqual({ model: 'm', slotCap: 's', liveModelSwitch: 'l', 'held-chime': 'c', back: 'r' })
  expect(await pressHeld($, ui, toasts)).toEqual(['held-chime'])
})

// A Squishydex with a dozen species met in the kit's first palette, the first in two
function metSpecies(): Record<string, unknown> {
  const [first, second] = KIT.palettes
  const bare = bareAccessory(KIT)?.id ?? ''
  if (first === undefined || second === undefined) throw new Error('The kit needs two palettes')
  const variant = (palette: string) => variantKey({ palette, accessory: bare, shiny: false })
  const species = everySpecies(KIT).slice(0, 12).map((each, index) => [speciesKey(each), { met: 0, variants: index === 0 ? [variant(first.id), variant(second.id)] : [variant(first.id)] }])
  return { [SQUISHYDEX_KEY]: { species: Object.fromEntries(species), legendaries: {} } }
}

test('the Squishydex pages hold n and p on the first and last page, and on a page that’s the only one', async ($, on) => {
  const toasts = stubToasts(on)
  stubStore(on, metSpecies())
  // Room for a few places a page, so there are several pages
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 40, bodyRows: 20 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  const footerKeys = async () => Object.entries(await hotkeysOf(ui)).filter(([key]) => !key.includes('-pick-'))

  expect(await footerKeys()).toEqual([['held-squishydex-previous', 'p'], ['squishydex-next', 'n'], ['squishydex-roster', 'r']])
  expect(await pressHeld($, ui, toasts)).toEqual(['held-squishydex-previous'])

  // The last page
  for (let page = 0; page < 200 && (await ui.find({ type: 'Button', key: 'squishydex-next' })) !== undefined; page += 1) {
    await $.ui.press({ plugin: 'squishys', key: 'squishydex-next' })
  }
  expect(await footerKeys()).toEqual([['squishydex-previous', 'p'], ['held-squishydex-next', 'n'], ['squishydex-roster', 'r']])
  expect(await pressHeld($, ui, toasts)).toEqual(['held-squishydex-next'])

  // One page holds them all
  await ui.redraw(paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }).props)
  expect(await footerKeys()).toEqual([['held-squishydex-previous', 'p'], ['held-squishydex-next', 'n'], ['squishydex-roster', 'r']])
  expect(await pressHeld($, ui, toasts)).toEqual(['held-squishydex-previous', 'held-squishydex-next'])
})

test('a species’ card holds m once it’s the partner and c with one palette met; a legendary’s card holds m, c and x', async ($, on) => {
  const toasts = stubToasts(on)
  const [legendary] = KIT.legendaries
  const [species, other] = everySpecies(KIT)
  if (legendary === undefined || species === undefined || other === undefined) throw new Error('The kit needs a legendary and two species')
  const dex = metSpecies()[SQUISHYDEX_KEY] as { species: object }
  // The partner is the first species, in its first palette
  stubStore(on, { ...PARTNERED, [SQUISHYDEX_KEY]: { ...dex, legendaries: { [legendary.id]: { met: 0 } } } })
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  const card = async (key: string) => {
    if ((await ui.find({ type: 'Button', key: 'squishydex-back' })) !== undefined) await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
    await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${key}` })
    return { hotkeys: await heldHotkeys(ui), held: await pressHeld($, ui, toasts) }
  }
  const CARD_HOTKEYS = ['b', 'c', 'm', 'r', 'x']

  expect(await card(speciesKey(species))).toEqual({ hotkeys: CARD_HOTKEYS, held: ['held-squishydex-partner'] })
  expect(await card(speciesKey(other))).toEqual({ hotkeys: CARD_HOTKEYS, held: ['held-squishydex-palette'] })
  expect(await card(legendaryKey(legendary.id))).toEqual({
    hotkeys: CARD_HOTKEYS,
    held: ['held-squishydex-palette', 'held-squishydex-partner', 'held-share'],
  })
})
