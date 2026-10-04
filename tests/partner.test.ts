import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KIT } from '../src/kit'
import type { Species } from '../src/kit'
import { FRAME_MS } from '../src/pane'
import { PARTNER_BUTTON, PARTNER_KEY, PARTNER_PICTURE } from '../src/partner'
import { halfBlocks } from '../src/raster'
import { compose } from '../src/composer'
import { roll, speciesSquishy, squishyOf } from '../src/roller'
import { seeded } from '../src/seeded'
import type { AssembledSquishy } from '../src/roller'
import { REMEMBERED_KEY } from '../src/rebuild'
import type { Remembered } from '../src/rebuild'
import { PANE, PARTNERED, paneSized, roomFor, spawnOf, stubBlits, stubSessionStart, stubSpawns, stubStore } from './fixtures'

const [FIRST, SECOND] = KIT.starters
const [FIRST_PALETTE, SECOND_PALETTE] = KIT.palettes
if (FIRST === undefined || SECOND === undefined || FIRST_PALETTE === undefined || SECOND_PALETTE === undefined) {
  throw new Error('The kit needs its starters and two palettes')
}

// A species as the starter pick and the partner's slot draw it (the roller's
// own rule), in this palette
function drawn(species: Species, palette?: string): AssembledSquishy {
  const squishy = speciesSquishy(KIT, species, palette)
  if (squishy === undefined) throw new Error(`The kit can't make ${species.body}/${species.face}`)
  return squishy
}

// Its still picture
function stillCells(squishy: AssembledSquishy): string {
  return halfBlocks(compose(KIT, squishy, { state: 'working', frame: 0 })).cells
}

// Starts an interactive session, as Claude Code does
async function startSession($: Engine, on: On): Promise<void> {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

test('on first open, the pane shows the three starters and nothing else, each answering to its digit', async ($, on) => {
  stubStore(on)
  stubSpawns(on)
  await startSession($, on)
  await $.agent.spawn(spawnOf('toolu_1'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const pictures = await ui.findAll({ type: 'Raster' })
  expect(pictures.map(picture => picture.props.cells)).toEqual(KIT.starters.map(starter => stillCells(drawn(starter))))
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(button => [button.key, button.props.hotkey, button.props.label])).toEqual(
    KIT.starters.map((starter, index) => [`starter-${index + 1}`, String(index + 1), drawn(starter).name]),
  )
  expect(await ui.find({ key: 'squishy-agent-1' })).toBeUndefined()
  expect(await ui.find({ key: 'settings' })).toBeUndefined()
})

test('on a pane narrower than three slots, the starters wrap onto rows that fit', async ($, on) => {
  stubStore(on)
  await startSession($, on)

  const narrow = await $.ui.mount({ ...paneSized(roomFor('dock', 1, 3)), surface: 'terminal' })
  for (const [row, number] of KIT.starters.map((_, index) => [index, index + 1])) {
    const shown = await narrow.find({ key: `starter-row-${row}` })
    expect(JSON.stringify(shown)).toContain(`"starter-${number}"`)
  }
  await narrow.unmount()

  const wide = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 1)), surface: 'terminal' })
  expect(JSON.stringify(await wide.find({ key: 'starter-row-0' }))).toContain(`"starter-${KIT.starters.length}"`)
  expect(await wide.find({ key: 'starter-row-1' })).toBeUndefined()
})

test('picking a starter saves its species and palette as the partner and shows the roster, the partner first', async ($, on) => {
  const stored = stubStore(on)
  stubSpawns(on)
  await startSession($, on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.ui.press({ plugin: 'squishys', key: 'starter-2' })

  expect(stored.get(PARTNER_KEY)).toEqual({ body: SECOND.body, face: SECOND.face, palette: FIRST_PALETTE.id })
  expect(await ui.find({ key: 'starter-1' })).toBeUndefined()
  expect(await ui.find({ key: 'slot-partner' })).toBeDefined()
  expect((await ui.find({ type: 'Raster', key: PARTNER_PICTURE }))?.props.cells).toBe(stillCells(drawn(SECOND)))
  expect(await ui.find({ type: 'Button', key: PARTNER_BUTTON })).toMatchObject({ props: { hotkey: '1', label: drawn(SECOND).name } })
  expect((await ui.find({ key: 'squishy-agent-1' }))?.props.hotkey).toBe('2')
})

test('a partner saved in an earlier session is pinned first in the roster, with no starter pick', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  await startSession($, on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'starter-1' })).toBeUndefined()
  // Slot order is digit order
  const picks = await Promise.all([PARTNER_BUTTON, 'squishy-agent-1', 'squishy-agent-2'].map(key => ui.find({ type: 'Button', key })))
  expect(picks.map(pick => pick?.props.hotkey)).toEqual(['1', '2', '3'])
  expect((await ui.find({ type: 'Raster', key: PARTNER_PICTURE }))?.props.cells).toBe(stillCells(drawn(FIRST)))
})

test('the partner keeps the palette it was picked in, and falls back to the first once the kit no longer has it', async ($, on) => {
  const stored = stubStore(on, { [PARTNER_KEY]: { ...FIRST, palette: SECOND_PALETTE.id } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster', key: PARTNER_PICTURE }))?.props.cells).toBe(stillCells(drawn(FIRST, SECOND_PALETTE.id)))
  expect(drawn(FIRST, SECOND_PALETTE.id).palette).toBe(SECOND_PALETTE.id)
  await ui.unmount()

  stored.set(PARTNER_KEY, { ...FIRST, palette: 'gone' })
  const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await later.find({ type: 'Raster', key: PARTNER_PICTURE }))?.props.cells).toBe(stillCells(drawn(FIRST)))
})

test('with no agents yet, the roster still shows the partner', async ($, on) => {
  stubStore(on, PARTNERED)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'slot-partner' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
})

test('picking the partner from a focus view returns to the roster', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await ui.find({ key: 'focus' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: PARTNER_BUTTON }))?.props.label).toBe(drawn(FIRST).name)

  await $.ui.press({ plugin: 'squishys', key: PARTNER_BUTTON })

  expect(await ui.find({ key: 'focus' })).toBeUndefined()
  expect(await ui.find({ key: 'slot-agent-1' })).toBeDefined()

  // and picking it in the roster opens no focus view
  await $.ui.press({ plugin: 'squishys', key: PARTNER_BUTTON })
  expect(await ui.find({ key: 'focus' })).toBeUndefined()
})

test('the partner is highlighted while the main view shows the orchestrator, and an agent’s squishy while it shows that agent', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  await $.agent.spawn(spawnOf('toolu_1'))

  const onOrchestrator = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await onOrchestrator.find({ key: 'in-view-partner' })).toBeDefined()
  expect(await onOrchestrator.find({ key: 'in-view-agent-1' })).toBeUndefined()
  await onOrchestrator.unmount()

  const onAgent = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: 'agent-1' } }, surface: 'terminal' })
  expect(await onAgent.find({ key: 'in-view-partner' })).toBeUndefined()
  expect(await onAgent.find({ key: 'in-view-agent-1' })).toBeDefined()
})

test('the partner never animates, while the agents beside it do', async ($, on) => {
  const clock = mock.clock(on)
  stubStore(on, PARTNERED)
  stubSpawns(on)
  const blits = stubBlits(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.ui.mount({ ...PANE, surface: 'terminal' })

  await clock.advance(FRAME_MS * 4)

  expect(blits.map(blit => blit.key)).toContain('picture-agent-1')
  expect(blits.map(blit => blit.key)).not.toContain(PARTNER_PICTURE)
})

// The mod rolls with the platform's randomness, which a test can't load:
// each plugin's environment is its own. So the partner is made the squishy
// the dice come up most often (by a seeded tally), the one a roll that
// forgot the partner would most likely repeat.
test('no agent is rolled the partner’s squishy', async ($, on) => {
  const rng = seeded(16)
  const tally = new Map<string, number>()
  for (let n = 0; n < 500; n += 1) {
    const squishy = roll(KIT, { live: [], rng })
    if (squishy.kind === 'assembled' && speciesSquishy(KIT, squishy, squishy.palette)?.key === squishy.key) {
      tally.set(squishy.key, (tally.get(squishy.key) ?? 0) + 1)
    }
  }
  const [likeliest] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? []
  const partner = squishyOf(KIT, likeliest ?? '')
  if (partner?.kind !== 'assembled') throw new Error('No roll came up a squishy drawn as a partner is')
  const stored = stubStore(on, { [PARTNER_KEY]: { body: partner.body, face: partner.face, palette: partner.palette } })
  stubSpawns(on)

  for (const n of [1, 2, 3, 4, 5]) await $.agent.spawn(spawnOf(`toolu_${n}`))

  const rolled = new Map(stored.get(REMEMBERED_KEY) as Remembered)
  expect(rolled.size).toBe(5)
  expect([...rolled.values()]).not.toContain(partner.key)
})

test('after /clear with no partner saved, the pane shows the starters again; with one saved, the roster', async ($, on) => {
  const stored = stubStore(on)
  stubSessionStart(on)

  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'starter-1' })).toBeDefined()

  await $.ui.press({ plugin: 'squishys', key: 'starter-1' })
  expect(stored.get(PARTNER_KEY)).toEqual({ body: FIRST.body, face: FIRST.face, palette: FIRST_PALETTE.id })
  await $.classic.SessionStart({ source: 'clear' })
  expect(await ui.find({ key: 'starter-1' })).toBeUndefined()
  expect(await ui.find({ key: 'slot-partner' })).toBeDefined()
})

test('a saved partner whose species the kit no longer has is picked again', async ($, on) => {
  stubStore(on, { [PARTNER_KEY]: { body: 'gone', face: FIRST.face, palette: FIRST_PALETTE.id } })
  await startSession($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'starter-1' })).toBeDefined()
  expect(await ui.find({ key: 'slot-partner' })).toBeUndefined()
})

test('a store that cannot be read shows the roster, never a starter pick that could not be saved', async ($, on) => {
  on('store.get', () => ({ deny: 'store unavailable' }))
  await startSession($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'starter-1' })).toBeUndefined()
  expect(await ui.find({ key: 'settings' })).toBeDefined()
})
