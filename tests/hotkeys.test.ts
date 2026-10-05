// Every control in the pane answers to a hotkey of its own (AGENTS.md, "Keys"):
// each Button has a hotkey no other control in its mode has, and no mode
// draws a Select. Every hotkey a mode can show is held in every state of
// that mode: a control that doesn't apply is drawn held, dimmed, and its
// press toasts why, so its key never reaches the prompt. The band has none
// by design, and is left out.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted, Plugin } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'

import { KIT, everySpecies } from '../src/kit'
import { bareAccessory, legendaryKey } from '../src/roller'
import { agentShareKey } from '../src/share'
import { LABEL_SLOT_ROWS, MINI_SLOT_ROWS } from '../src/slots'
import { SQUISHYDEX_KEY, speciesKey, variantKey } from '../src/squishydex-record'
import { HELD_PREFIX } from '../src/held'
import { PARTNER_KEY } from '../src/partner'
import { PANE, PARTNERED, finishOf, nameOfAgent, paneSized, roomFor, spawnOf, stubAgentList, stubSpawns, stubStore } from './fixtures'

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

test('the Squishydex: digits pick the places met, then n, p and r, with a card’s keys held; a card has m, c, x, b and r, with n and p held', async ($, on) => {
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
  expect(await unheld(ui, SQUISHYDEX_HOTKEYS)).toEqual([])

  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${speciesKey(species)}` })
  const card = await hotkeysOf(ui)
  expect(card).toMatchObject({ 'squishydex-partner': 'm', 'squishydex-palette': 'c', 'squishydex-back': 'b', 'squishydex-roster': 'r' })
  expect(Object.values(card)).toContain('x')
  expect(await unheld(ui, SQUISHYDEX_HOTKEYS)).toEqual([])
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
// once, and nothing else changes. Gives each one's toast, by its key.
async function pressHeld($: Engine, ui: Mounted<'terminal', 'Pane'>, toasts: string[]): Promise<Record<string, string>> {
  const held = (await ui.findAll({ type: 'Button' })).filter(button => String(button.key).startsWith(HELD_PREFIX))
  const before = await hotkeysOf(ui)
  const toasted: Record<string, string> = {}
  for (const button of held) {
    const key = String(button.key)
    expect([key, button.props.dimColor]).toEqual([key, true])
    const from = toasts.length
    await $.ui.press({ plugin: 'squishys', key })
    expect([key, toasts.length - from]).toEqual([key, 1])
    toasted[key] = toasts[from] ?? ''
    expect(await hotkeysOf(ui)).toEqual(before)
  }
  return toasted
}

// Which of `expected` the mode drew no control for: none, once every one is held
async function unheld(ui: Mounted<'terminal', 'Pane'>, expected: readonly string[]): Promise<string[]> {
  const drawn = Object.values(await hotkeysOf(ui))
  return expected.filter(hotkey => !drawn.includes(hotkey))
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

test('a legendary’s card: b back to the pages and r the roster, with m, c, x, n and p held', async ($, on) => {
  const [legendary] = KIT.legendaries
  if (legendary === undefined) throw new Error('The kit needs a legendary')
  stubStore(on, { [SQUISHYDEX_KEY]: { species: {}, legendaries: { [legendary.id]: { met: 0 } } } })
  // Room for every place on one page, the legendaries last
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${legendaryKey(legendary.id)}` })

  expect(await hotkeysOf(ui)).toEqual({
    'held-squishydex-palette': 'c',
    'held-squishydex-partner': 'm',
    'held-squishydex-share': 'x',
    'squishydex-back': 'b',
    'squishydex-roster': 'r',
    'held-squishydex-previous': 'p',
    'held-squishydex-next': 'n',
  })
})

test('the roster holds m with no overflow: drawn as +0, dimmed, its press says why', async ($, on) => {
  const toasts = stubToasts(on)
  stubStore(on, PARTNERED)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 4, 1)), surface: 'terminal' })

  expect(await hotkeysOf(ui)).toEqual({ partner: '1', 'squishy-agent-1': '2', 'held-overflow': 'm', settings: 'o', squishydex: 'd' })
  expect((await ui.find({ type: 'Button', key: 'held-overflow' }))?.props.label).toBe('+0')
  expect(await pressHeld($, ui, toasts)).toEqual({ 'held-overflow': 'Squishys: every agent has a slot, so the overflow is empty.' })
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
  const [first, second, third] = ['agent-1', 'agent-2', 'agent-3'].map(id => nameOfAgent(stored, id))
  const focusOn = async (agentId: string) => {
    if ((await ui.find({ type: 'Button', key: 'back' })) !== undefined) await $.ui.press({ plugin: 'squishys', key: 'back' })
    await $.ui.press({ plugin: 'squishys', key: `squishy-${agentId}` })
  }
  const held: Record<string, Record<string, string>> = {}

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

  const finished = (name: string | undefined) => `Squishys: ${name} has finished, so there’s nothing to stop.`
  expect(held).toEqual({
    working: { [`held-${agentShareKey('agent-1')}`]: `Squishys: ${first} is still running. Share works once it’s Asleep.` },
    stopping: {
      'held-stop': `Squishys: ${second} is already being stopped.`,
      [`held-${agentShareKey('agent-2')}`]: `Squishys: ${second} is still running. Share works once it’s Asleep.`,
    },
    asleep: { 'held-stop': finished(first) },
    squished: {
      'held-stop': finished(third),
      [`held-${agentShareKey('agent-3')}`]: `Squishys: only an Asleep squishy can be shared, and ${third} is Squished.`,
    },
    noPartner: { 'held-stop': finished(first), 'held-partner': 'Squishys: no partner is saved yet. r goes back to the roster.' },
  })
})

// Stands for a stale drawing's pick, of an agent the tracker no longer
// knows: a press of agent-1's pick reaches the mod naming agent-9
const STALE_PICK: Plugin = {
  name: 'stale-pick',
  tier: 'prepend',
  register: on => {
    on('ui.press', ($, e, next) => next(e.element === 'squishy-agent-1' ? { ...e, element: 'squishy-agent-9' } : e))
  },
}

test('the focus view of an agent no longer here holds s, x and i, and keeps 1 and r', { plugins: [STALE_PICK] }, async ($, on) => {
  const toasts = stubToasts(on)
  stubStore(on, PARTNERED)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  expect(await ui.find({ type: 'Text', text: 'That agent is no longer here.' })).toBeDefined()
  expect(await hotkeysOf(ui)).toEqual({
    back: 'r',
    'held-stop': 's',
    partner: '1',
    [`held-${agentShareKey('agent-9')}`]: 'x',
    'held-focus-redirect': 'i',
  })
  const gone = 'Squishys: that agent is no longer here.'
  expect(await pressHeld($, ui, toasts)).toEqual({ 'held-stop': gone, [`held-${agentShareKey('agent-9')}`]: gone, 'held-focus-redirect': gone })
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
  expect(await pressHeld($, ui, toasts)).toEqual({ 'held-chime': 'Squishys: no chime plays here: Claude Code plays sounds only on macOS.' })
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

// Every hotkey the Squishydex can show, besides the picks: the pages' and the cards'
const SQUISHYDEX_HOTKEYS = ['b', 'c', 'm', 'n', 'p', 'r', 'x']

// What a held control on the pages and on a card says
const FIRST_PAGE = 'Squishys: this is the first page.'
const LAST_PAGE = 'Squishys: this is the last page.'
const ON_THE_PAGES = 'Squishys: open a card first: pick a squishy you’ve met.'
const ON_A_CARD = 'Squishys: go back to the pages first (b).'
// A card's controls, by hotkey, held on the pages
const CARD_ON_PAGES: Record<string, string> = { b: 'held-squishydex-back', m: 'held-squishydex-partner', c: 'held-squishydex-palette', x: 'held-squishydex-share' }

test('the Squishydex pages hold a card’s keys, and n and p on the first and last page, and on a page that’s the only one', async ($, on) => {
  const toasts = stubToasts(on)
  stubStore(on, metSpecies())
  // Room for a few places a page, so there are several pages
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 40, bodyRows: 24 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  // A card's controls held, but where a pick on the page takes the hotkey
  const cardHeld = async () => {
    const picks = await pickHotkeys(ui, /^squishydex-pick-/)
    return Object.fromEntries(Object.entries(CARD_ON_PAGES).flatMap(([hotkey, key]) => (picks.includes(hotkey) ? [] : [[key, ON_THE_PAGES]])))
  }

  expect(await unheld(ui, SQUISHYDEX_HOTKEYS)).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'squishydex-next' })).toBeDefined()
  expect(await pressHeld($, ui, toasts)).toEqual({ 'held-squishydex-previous': FIRST_PAGE, ...(await cardHeld()) })

  // The last page
  for (let page = 0; page < 200 && (await ui.find({ type: 'Button', key: 'squishydex-next' })) !== undefined; page += 1) {
    await $.ui.press({ plugin: 'squishys', key: 'squishydex-next' })
  }
  expect(await unheld(ui, SQUISHYDEX_HOTKEYS)).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'squishydex-previous' })).toBeDefined()
  expect(await pressHeld($, ui, toasts)).toEqual({ 'held-squishydex-next': LAST_PAGE, ...(await cardHeld()) })

  // One page holds them all: past nine picks, b and c pick, so only m and x are held for a card
  await ui.redraw(paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }).props)
  expect(await unheld(ui, SQUISHYDEX_HOTKEYS)).toEqual([])
  expect(await pressHeld($, ui, toasts)).toEqual({
    'held-squishydex-previous': FIRST_PAGE,
    'held-squishydex-next': 'Squishys: every place fits on this one page.',
    'held-squishydex-partner': ON_THE_PAGES,
    'held-squishydex-share': ON_THE_PAGES,
  })
})

test('a card holds n and p; a species’ card holds m once it’s the partner and c with one palette met; a legendary’s holds m, c and x', async ($, on) => {
  const toasts = stubToasts(on)
  const stored = stubStore(on, PARTNERED)
  const [legendary] = KIT.legendaries
  const [species, other] = everySpecies(KIT)
  if (legendary === undefined || species === undefined || other === undefined) throw new Error('The kit needs a legendary and two species')
  const dex = metSpecies()[SQUISHYDEX_KEY] as { species: object }
  // The partner is the first species, in its first palette
  stored.set(SQUISHYDEX_KEY, { ...dex, legendaries: { [legendary.id]: { met: 0 } } })
  const ui = await $.ui.mount({ ...paneSized({ placement: 'dock', bodyColumns: 600, bodyRows: 200 }), surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  const card = async (key: string) => {
    if ((await ui.find({ type: 'Button', key: 'squishydex-back' })) !== undefined) await $.ui.press({ plugin: 'squishys', key: 'squishydex-back' })
    await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${key}` })
    return { hotkeys: await heldHotkeys(ui), held: await pressHeld($, ui, toasts) }
  }
  const paging = { 'held-squishydex-previous': ON_A_CARD, 'held-squishydex-next': ON_A_CARD }

  const partnerCard = await card(speciesKey(species))
  expect(partnerCard.hotkeys).toEqual(SQUISHYDEX_HOTKEYS)
  expect(partnerCard.held).toEqual({ ...paging, 'held-squishydex-partner': expect.stringMatching(/^Squishys: .+ is already your partner\.$/) })

  const onePalette = await card(speciesKey(other))
  expect(onePalette.hotkeys).toEqual(SQUISHYDEX_HOTKEYS)
  expect(onePalette.held).toEqual({ ...paging, 'held-squishydex-palette': expect.stringMatching(/^Squishys: .+ has been met in one plain palette only, so there’s none to step to\.$/) })

  expect(await card(legendaryKey(legendary.id))).toEqual({
    hotkeys: SQUISHYDEX_HOTKEYS,
    held: {
      ...paging,
      'held-squishydex-palette': 'Squishys: a legendary has one look: only a species’ partner palette can be picked.',
      'held-squishydex-partner': 'Squishys: a legendary can’t be your partner: only a species can.',
      'held-squishydex-share': 'Squishys: only a species’ card can be shared.',
    },
  })
})
