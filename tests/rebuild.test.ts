// Rebuilding the roster after /clear, /resume, a branch or compaction. The
// kit starts every test with $.state at its defaults, which is how /clear
// leaves it, so a test fires classic.SessionStart without session.start.

import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { AgentStatus, TraceEntry } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { KIT } from '../src/kit'
import { FRAME_MS } from '../src/pane'
import { REMEMBERED_AGENTS, REMEMBERED_KEY } from '../src/rebuild'
import type { Remembered, RememberedPair } from '../src/rebuild'
import { roll, squishyOf } from '../src/roller'
import { seeded } from '../src/seeded'
import type { SquishyState } from '../src/states'
import { PANE, finishOf, paneSized, roomFor, spawnOf, stubAgentList, stubBlits, stubSessionStart, stubSpawns, stubStore, stubTurns } from './fixtures'
import { cellsOf, spawnAndWatch, squishyIn, watch } from './pictures'

const LISTED = [
  { id: 'agent-a', description: 'Find config parser', status: 'running' },
  { id: 'agent-b', description: 'Run the tests', status: 'completed' },
  { id: 'agent-c', description: 'Fix the build', status: 'failed' },
  { id: 'agent-d', description: 'Review the docs', status: 'killed' },
] as const

const EXPECTED: Record<string, SquishyState> = {
  'agent-a': 'working',
  'agent-b': 'asleep',
  'agent-c': 'squished',
  'agent-d': 'squished',
}

/** The agent ids the store keeps squishys for, in the order it keeps them. */
function rememberedIds(stored: Map<string, unknown>): string[] {
  return (stored.get(REMEMBERED_KEY) as Remembered).map(([agentId]) => agentId)
}

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`after a session start from ${source}, the roster is rebuilt from the agent list, each squishy in its agent’s state`, async ($, on) => {
    stubStore(on)
    stubSessionStart(on)
    stubAgentList(on, LISTED)

    await $.classic.SessionStart({ source })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    for (const { id, description } of LISTED) {
      const picture = await ui.find({ key: `picture-${id}` })
      const name = await ui.find({ key: `squishy-${id}` })
      expect(() => squishyIn(picture?.props.cells, String(name?.props.label), EXPECTED[id])).not.toThrow()
      expect(await ui.find({ type: 'Text', text: description })).toBeDefined()
    }
  })
}

test('a spawned agent’s squishy is kept in the store under its agent id', async ($, on) => {
  const stored = stubStore(on)
  stubSpawns(on)

  const { picture } = await spawnAndWatch($)

  const squishy = squishyOf(KIT, String(new Map(stored.get(REMEMBERED_KEY) as Remembered).get('agent-1')))
  expect(squishy).toBeDefined()
  if (squishy) expect(cellsOf(squishy, 'working')).toBe(await picture())
})

test('agents spawned at once all have their squishys kept in the store', async ($, on) => {
  const stored = stubStore(on)
  stubSpawns(on)

  await Promise.all([1, 2, 3, 4].map(n => $.agent.spawn(spawnOf(`toolu_${n}`))))

  expect(rememberedIds(stored).toSorted()).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4'])
})

for (const source of ['clear', 'resume'] as const) {
  test(`after a session start from ${source}, an agent that had a squishy gets the same squishy back`, async ($, on) => {
    const squishy = roll(KIT, { live: [], rng: seeded(10) })
    stubStore(on, { [REMEMBERED_KEY]: [['agent-a', squishy.key]] })
    stubSessionStart(on)
    stubAgentList(on, [{ id: 'agent-a', description: 'Find config parser', status: 'running' }])

    await $.classic.SessionStart({ source })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'squishy-agent-a' }))?.props.label).toBe(squishy.name)
    expect((await ui.find({ key: 'picture-agent-a' }))?.props.cells).toBe(cellsOf(squishy, 'working'))
  })
}

test('after /clear, agents never seen before get fresh squishys, none of them one already restored', async ($, on) => {
  const rng = seeded(11)
  const restored: Remembered = []
  for (let n = 1; n <= 3; n += 1) {
    const live = restored.flatMap(([, key]) => squishyOf(KIT, key) ?? [])
    restored.push([`agent-old-${n}`, roll(KIT, { live, rng }).key])
  }
  stubStore(on, { [REMEMBERED_KEY]: restored })
  stubSessionStart(on)
  const ids = [...restored.map(([agentId]) => agentId), 'agent-new-1', 'agent-new-2', 'agent-new-3']
  stubAgentList(on, ids.map(id => ({ id, description: 'Find config parser', status: 'running' })))

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 3)), surface: 'terminal' })
  const pictures = (await ui.findAll({ type: 'Raster' })).map(picture => picture.props.cells)
  expect(pictures).toHaveLength(6)
  expect(new Set(pictures).size).toBe(6)
})

test('an agent spawned while the roster is rebuilt keeps its squishy and its one slot, and no squishy shows twice', async ($, on) => {
  const restored = roll(KIT, { live: [], rng: seeded(13) })
  const stored = new Map<string, unknown>([[REMEMBERED_KEY, [['agent-a', restored.key]]]])
  // The rebuild's read of the kept squishys answers only once the spawn has
  // landed, so the spawn joins the roster while the rebuild is under way
  let reading = () => {}
  const rebuildReads = new Promise<void>(resolve => (reading = resolve))
  let answer = () => {}
  const answered = new Promise<void>(resolve => (answer = resolve))
  let reads = 0
  on('store.get', async ($, e) => {
    if (e.key === REMEMBERED_KEY && ++reads === 1) {
      reading()
      await answered
    }
    return { value: stored.get(e.key) }
  })
  on('store.set', ($, e) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  stubSpawns(on)
  stubSessionStart(on)
  stubAgentList(on, [
    { id: 'agent-a', description: 'Find config parser', status: 'running' },
    { id: 'agent-1', description: 'Find config parser', status: 'running' },
    { id: 'agent-b', description: 'Run the tests', status: 'running' },
  ])

  const rebuilding = $.classic.SessionStart({ source: 'clear' })
  await rebuildReads
  await $.agent.spawn(spawnOf('toolu_1'))
  const spawned = squishyOf(KIT, String(new Map(stored.get(REMEMBERED_KEY) as Remembered).get('agent-1')))
  answer()
  await rebuilding

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ key: 'slot-agent-1' })).toHaveLength(1)
  expect(spawned).toBeDefined()
  if (spawned) expect((await ui.find({ key: 'picture-agent-1' }))?.props.cells).toBe(cellsOf(spawned, 'working'))
  expect((await ui.find({ key: 'picture-agent-a' }))?.props.cells).toBe(cellsOf(restored, 'working'))
  const pictures = (await ui.findAll({ type: 'Raster' })).map(picture => picture.props.cells)
  expect(pictures).toHaveLength(3)
  expect(new Set(pictures).size).toBe(3)
  expect(rememberedIds(stored).toSorted()).toEqual(['agent-1', 'agent-a', 'agent-b'])
})

test('the store keeps squishys for at most REMEMBERED_AGENTS agents, dropping those seen longest ago', async ($, on) => {
  const key = roll(KIT, { live: [], rng: seeded(12) }).key
  const old = Array.from({ length: REMEMBERED_AGENTS }, (_, n): RememberedPair => [`agent-old-${n + 1}`, key])
  const stored = stubStore(on, { [REMEMBERED_KEY]: old })
  stubSessionStart(on)
  // The oldest one comes back in this session, beside one never seen
  stubAgentList(on, [
    { id: 'agent-old-1', description: 'Find config parser', status: 'running' },
    { id: 'agent-new', description: 'Run the tests', status: 'running' },
  ])

  await $.classic.SessionStart({ source: 'resume' })

  const ids = rememberedIds(stored)
  expect(ids).toHaveLength(REMEMBERED_AGENTS)
  expect(ids.slice(-2)).toEqual(['agent-old-1', 'agent-new'])
  expect(ids).not.toContain('agent-old-2')
  expect(ids).toContain('agent-old-3')
})

test('an agent whose kept squishy the kit no longer has gets a fresh one', async ($, on) => {
  stubStore(on, { [REMEMBERED_KEY]: [['agent-a', 'gone/gone/gone/gone'], 'not a pair'] })
  stubSessionStart(on)
  stubAgentList(on, [{ id: 'agent-a', description: 'Find config parser', status: 'running' }])

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await watch(ui, 'agent-a')).squishy).toBeDefined()
})

test('after compaction, which keeps the roster, each squishy stays as it was and agents the roster lacks join it', async ($, on) => {
  stubStore(on)
  stubSpawns(on)
  stubTurns(on)
  stubSessionStart(on)
  stubAgentList(on, [
    { id: 'agent-1', description: 'Find config parser', status: 'running' },
    { id: 'agent-2', description: 'Run the tests', status: 'running' },
  ])
  const { ui, squishy, state } = await spawnAndWatch($)
  await $.turn.complete(finishOf('agent-1'))

  await $.classic.SessionStart({ source: 'compact' })

  expect(await state()).toBe('asleep')
  expect((await ui.find({ key: 'squishy-agent-1' }))?.props.label).toBe(squishy.name)
  expect((await watch(ui, 'agent-2')).squishy).toBeDefined()
})

test('a session start from startup leaves the agent list alone', async ($, on) => {
  stubStore(on)
  stubSessionStart(on)
  const lookups = stubAgentList(on, new Map([['agent-a', 'running']]))

  await $.classic.SessionStart({ source: 'startup' })

  expect(lookups()).toBe(0)
})

// A plugin loaded ahead of the mod that toasts each of the mod's hooks that
// failed (skipped, kept, caught, expired or rejected, as `next.trace` says),
// for the test to collect. An inline plugin's source runs on its own, apart
// from the test: everything it uses is inside `register`, each event name
// is spelled out and `$` is used only in the hooks, for the engine to read.
const WATCHER: Plugin = {
  name: 'watcher',
  tier: 'prepend',
  register: on => {
    const failed = (trace: readonly TraceEntry[]) =>
      trace
        .filter(link => link.plugin === 'squishys' && link.outcome !== 'returned' && link.outcome !== 'passed')
        .map(link => `squishys ${link.event}: ${link.outcome}`)
    on('session.start', async ($, e, next) => {
      const result = await next(e)
      for (const failure of failed(next.trace)) await $.ui.toast(failure)
      return result
    })
    on('agent.spawn', async ($, e, next) => {
      const result = await next(e)
      for (const failure of failed(next.trace)) await $.ui.toast(failure)
      return result
    })
    on('classic.SessionStart', async ($, e, next) => {
      const result = await next(e)
      for (const failure of failed(next.trace)) await $.ui.toast(failure)
      return result
    })
    on('ui.render', async ($, e, next) => {
      const result = await next(e)
      for (const failure of failed(next.trace)) await $.ui.toast(failure)
      return result
    })
  },
}

// Each surface that doesn't draw squishys, and a `claude -p` run (null),
// which draws nowhere
for (const surface of ['desktop', 'vscode', 'mobile', null] as const) {
  test(`on ${surface ?? 'a claude -p run'}, nothing is drawn and no hook fails, while agents are still tracked through a rebuild`, { plugins: [WATCHER] }, async ($, on) => {
    const clock = mock.clock(on)
    const failures: string[] = []
    on('ui.toast', ($, e) => {
      failures.push(e.text)
      return { value: undefined }
    })
    stubStore(on)
    stubSpawns(on)
    stubSessionStart(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('settings.read', () => ({ value: {} }))
    stubAgentList(on, [
      { id: 'agent-1', description: 'Find config parser', status: 'running' },
      { id: 'agent-2', description: 'Run the tests', status: 'completed' },
    ])
    // Stands for what Claude Code would draw in the pane
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const blits = stubBlits(on)

    await $.session.start({ surface, isInteractive: surface !== null, cwd: '/work' })
    await $.agent.spawn(spawnOf('toolu_1'))
    await $.classic.SessionStart({ source: 'clear' })
    if (surface !== null) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }
    await clock.advance(FRAME_MS * 4)

    expect(blits).toEqual([])
    expect(failures).toEqual([])
    // Tracked quietly all along: a terminal would show both
    const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await terminal.findAll({ type: 'Raster' })).toHaveLength(2)
  })
}

// /clear continues under a new session id, so the list may name no agent
test('after /clear with an empty agent list, the roster starts empty and no hook fails', { plugins: [WATCHER] }, async ($, on) => {
  const failures: string[] = []
  on('ui.toast', ($, e) => {
    failures.push(e.text)
    return { value: undefined }
  })
  stubStore(on, { [REMEMBERED_KEY]: [['agent-old', roll(KIT, { live: [], rng: seeded(14) }).key]] })
  stubSessionStart(on)
  stubAgentList(on, [])

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
  expect(failures).toEqual([])
})

test('after /clear, a rebuilt agent that fails with no stop event is caught by checking the agent list', async ($, on) => {
  const clock = mock.clock(on)
  stubStore(on)
  stubSessionStart(on)
  const statuses = new Map<string, AgentStatus>([['agent-a', 'running']])
  stubAgentList(on, statuses)
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const { state } = await watch(ui, 'agent-a')

  statuses.set('agent-a', 'failed')
  await clock.advance(AGENT_CHECK_MS)

  expect(await state()).toBe('squished')
})
