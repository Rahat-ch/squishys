// Rebuilding the roster after /clear, /resume, a branch or compaction. The
// kit starts every test with $.state at its defaults, which is how /clear
// leaves it, so a test fires classic.SessionStart without session.start.

import { expect, mock, test } from 'claude-code/testing'
import type { Mounted, Plugin } from 'claude-code/testing'
import type { AgentStatus, TraceEntry } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { KIT } from '../src/kit'
import { FRAME_MS } from '../src/pane'
import { REMEMBERED_AGENTS, REMEMBERED_KEY, SESSIONS_KEY, agentsOfSession, rememberedFrom, sessionsFrom, withRemembered, withSessionAgents } from '../src/rebuild'
import type { Remembered, RememberedPair, Sessions } from '../src/rebuild'
import { roll, squishyOf } from '../src/roller'
import { seeded } from '../src/seeded'
import type { SquishyState } from '../src/states'
import type { Agent, Squishy } from '../types'
import { PANE, PARTNERED, finishOf, nameOfAgent, paneSized, roomFor, spawnOf, stubAgentList, stubBlits, stubSessionStart, stubSpawns, stubStore, stubTurns } from './fixtures'
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

/** The pictures of agents' squishys the pane shows, leaving out the partner's. */
async function agentPictures(ui: Mounted<'terminal', 'Pane'>) {
  return (await ui.findAll({ type: 'Raster' })).filter(picture => picture.key?.startsWith('picture-'))
}

/** The agent ids the store keeps squishys for, in the order it keeps them. */
function rememberedIds(stored: Map<string, unknown>): string[] {
  return (stored.get(REMEMBERED_KEY) as Remembered).map(([agentId]) => agentId)
}

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`after a session start from ${source}, the roster is rebuilt from the agent list, each squishy in its agent’s state`, async ($, on) => {
    // The store keeps the listed agents as the session's own, as /clear and
    // /resume want (isOfSession); a branch takes the whole list
    const rng = seeded(16)
    const rolled: Squishy[] = []
    for (const _ of LISTED) rolled.push(roll(KIT, { live: rolled, rng }))
    stubStore(on, leftBy([['session-now', LISTED.map(({ id, description }, index) => ({ id, description, squishy: rolled[index] as Squishy }))]]))
    stubSessionStart(on)
    stubAgentList(on, LISTED)

    await $.classic.SessionStart({ source, session_id: 'session-now' })

    // Room for the partner and every listed agent
    const ui = await $.ui.mount({ ...paneSized(roomFor('dock', LISTED.length + 1, 1)), surface: 'terminal' })
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
    stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: [['agent-a', squishy.key]] })
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
  stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: restored })
  stubSessionStart(on)
  const ids = [...restored.map(([agentId]) => agentId), 'agent-new-1', 'agent-new-2', 'agent-new-3']
  stubAgentList(on, ids.map(id => ({ id, description: 'Find config parser', status: 'running' })))

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 3)), surface: 'terminal' })
  const pictures = (await agentPictures(ui)).map(picture => picture.props.cells)
  expect(pictures).toHaveLength(6)
  expect(new Set(pictures).size).toBe(6)
})

test('an agent spawned while the roster is rebuilt keeps its squishy and its one slot, and no squishy shows twice', async ($, on) => {
  const restored = roll(KIT, { live: [], rng: seeded(13) })
  const stored = new Map<string, unknown>([...Object.entries(PARTNERED), [REMEMBERED_KEY, [['agent-a', restored.key]]]])
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
  const pictures = (await agentPictures(ui)).map(picture => picture.props.cells)
  expect(pictures).toHaveLength(3)
  expect(new Set(pictures).size).toBe(3)
  expect(rememberedIds(stored).toSorted()).toEqual(['agent-1', 'agent-a', 'agent-b'])
})

test('the store keeps squishys for at most REMEMBERED_AGENTS agents, dropping those seen longest ago', async ($, on) => {
  const key = roll(KIT, { live: [], rng: seeded(12) }).key
  const old = Array.from({ length: REMEMBERED_AGENTS }, (_, n): RememberedPair => [`agent-old-${n + 1}`, key])
  const stored = stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: old })
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
  stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: [['agent-a', 'gone/gone/gone/gone'], 'not a pair'] })
  stubSessionStart(on)
  stubAgentList(on, [{ id: 'agent-a', description: 'Find config parser', status: 'running' }])

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await watch(ui, 'agent-a')).squishy).toBeDefined()
})

test('after compaction, which keeps the roster, each squishy stays as it was and agents the roster lacks join it', async ($, on) => {
  stubStore(on, PARTNERED)
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
  stubStore(on, PARTNERED)
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
    stubStore(on, PARTNERED)
    stubSpawns(on)
    stubSessionStart(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('settings.read', () => ({ value: {} }))
    stubAgentList(on, [
      { id: 'agent-1', description: 'Find config parser', status: 'running' },
      { id: 'agent-2', description: 'Run the tests', status: 'running' },
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
    expect(await agentPictures(terminal)).toHaveLength(2)
  })
}

// /clear continues under a new session id, so the list may name no agent
test('after /clear with an empty agent list, the roster starts empty and no hook fails', { plugins: [WATCHER] }, async ($, on) => {
  const failures: string[] = []
  on('ui.toast', ($, e) => {
    failures.push(e.text)
    return { value: undefined }
  })
  stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: [['agent-old', roll(KIT, { live: [], rng: seeded(14) }).key]] })
  stubSessionStart(on)
  stubAgentList(on, [])

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await agentPictures(ui)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
  expect(failures).toEqual([])
})

test('after /clear, a rebuilt agent that fails with no stop event is caught by checking the agent list', async ($, on) => {
  const clock = mock.clock(on)
  stubStore(on, PARTNERED)
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

// Seen in a session (#63): Claude Code's agent list drops an agent within a
// minute of its end, so by the time /resume comes the list may name only the
// agents still running. The store keeps which agents each session
// started, as earlier sessions left it here (leftBy).
const EARLIER_SESSION = 'session-earlier'
const OTHER_SESSION = 'session-other'

/** Three squishys an earlier session rolled for its agents, none alike. */
function earlierSquishys() {
  const rng = seeded(15)
  const rolled: Squishy[] = []
  for (let n = 0; n < 3; n += 1) rolled.push(roll(KIT, { live: rolled, rng }))
  return rolled as [Squishy, Squishy, Squishy]
}

type Started = Pick<Agent, 'id' | 'description' | 'squishy'>

/** The store as earlier sessions left it, each having started these agents. */
function leftBy(started: readonly (readonly [sessionId: string, agents: readonly Started[]])[]): Record<string, unknown> {
  let remembered: Remembered = []
  let sessions: Sessions = []
  for (const [sessionId, agents] of started) {
    remembered = withRemembered(remembered, agents)
    sessions = withSessionAgents(sessions, sessionId, agents)
  }
  return { ...PARTNERED, [REMEMBERED_KEY]: remembered, [SESSIONS_KEY]: sessions }
}

test('after /resume, the resumed session’s ended agents come back with their squishys, Asleep, though the agent list no longer names them', { plugins: [WATCHER] }, async ($, on) => {
  const failures: string[] = []
  on('ui.toast', ($, e) => {
    failures.push(e.text)
    return { value: undefined }
  })
  const [first, second] = earlierSquishys()
  const started = [
    { id: 'agent-a', description: 'Reply alpha', squishy: first },
    { id: 'agent-b', description: 'Reply beta', squishy: second },
  ]
  stubStore(on, leftBy([[EARLIER_SESSION, started]]))
  stubSessionStart(on)
  stubAgentList(on, [])

  await $.classic.SessionStart({ source: 'resume', session_id: EARLIER_SESSION })

  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 1)), surface: 'terminal' })
  for (const { id, squishy, description } of started) {
    expect((await ui.find({ key: `squishy-${id}` }))?.props.label).toBe(squishy.name)
    expect((await ui.find({ key: `picture-${id}` }))?.props.cells).toBe(cellsOf(squishy, 'asleep'))
    expect(await ui.find({ type: 'Text', text: description })).toBeDefined()
  }
  expect(failures).toEqual([])
})

test('after /resume, an agent the list still names shows its listed state, and agents of other sessions stay away', async ($, on) => {
  const [running, ended, elsewhere] = earlierSquishys()
  stubStore(
    on,
    leftBy([
      [
        EARLIER_SESSION,
        [
          { id: 'agent-running', description: 'Sleep then reply', squishy: running },
          { id: 'agent-ended', description: 'Reply alpha', squishy: ended },
        ],
      ],
      [OTHER_SESSION, [{ id: 'agent-elsewhere', description: 'Run the tests', squishy: elsewhere }]],
    ]),
  )
  stubSessionStart(on)
  stubAgentList(on, [{ id: 'agent-running', description: 'Sleep then reply', status: 'waiting' }])

  await $.classic.SessionStart({ source: 'resume', session_id: EARLIER_SESSION })

  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 4, 1)), surface: 'terminal' })
  expect((await ui.find({ key: 'squishy-agent-running' }))?.props.label).toBe(running.name)
  expect((await ui.find({ key: 'picture-agent-running' }))?.props.cells).toBe(cellsOf(running, 'working'))
  expect((await ui.find({ key: 'picture-agent-ended' }))?.props.cells).toBe(cellsOf(ended, 'asleep'))
  expect(await ui.find({ key: 'slot-agent-elsewhere' })).toBeUndefined()
  expect(await agentPictures(ui)).toHaveLength(2)
})

test('/clear starts fresh: the cleared session’s ended agents stay away, and the partner stays', async ($, on) => {
  const [first] = earlierSquishys()
  stubStore(on, leftBy([[EARLIER_SESSION, [{ id: 'agent-a', description: 'Reply alpha', squishy: first }]]]))
  stubSessionStart(on)
  stubAgentList(on, [])

  // /clear goes on under a session id of its own
  await $.classic.SessionStart({ source: 'clear', session_id: 'session-after-clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await agentPictures(ui)).toEqual([])
  expect(await ui.find({ key: 'partner' })).toBeDefined()
})

test('a spawned agent is kept as the session’s it started in, with its description and squishy, for /resume to bring back', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on)
  on('session.id', () => ({ value: EARLIER_SESSION }))

  await $.agent.spawn(spawnOf('toolu_1'))

  const kept = (sessionId: string) => agentsOfSession(sessionsFrom(stored.get(SESSIONS_KEY)), rememberedFrom(stored.get(REMEMBERED_KEY)), sessionId)
  const [agent] = kept(EARLIER_SESSION)
  expect(agent?.id).toBe('agent-1')
  expect(agent?.description).toBe('Find config parser')
  expect(agent?.squishy.name).toBe(nameOfAgent(stored, 'agent-1'))
  expect(kept(OTHER_SESSION)).toEqual([])
})

test('the store keeps the agents of the sessions that started one latest, at most REMEMBERED_AGENTS in all, dropping whole sessions seen longest ago', async ($, on) => {
  const [squishy] = earlierSquishys()
  const half = REMEMBERED_AGENTS / 2
  const agentsOf = (prefix: string) => Array.from({ length: half }, (_, n): Started => ({ id: `${prefix}-${n + 1}`, description: 'Find config parser', squishy }))
  const stored = stubStore(on, leftBy([[OTHER_SESSION, agentsOf('agent-other')], [EARLIER_SESSION, agentsOf('agent-earlier')]]))
  stubSpawns(on)
  on('session.id', () => ({ value: 'session-now' }))

  await $.agent.spawn(spawnOf('toolu_1'))

  const sessions = sessionsFrom(stored.get(SESSIONS_KEY))
  expect(sessions.map(([sessionId]) => sessionId)).toEqual([EARLIER_SESSION, 'session-now'])
  expect(sessions[0]?.[1]).toHaveLength(half)
})

// The agent list names the agents of every session in the process
test('after /resume, listed agents another session started stay away, and of listed agents kept under no session only running ones join', async ($, on) => {
  const [mine, otherRunning, otherEnded] = earlierSquishys()
  stubStore(
    on,
    leftBy([
      [
        OTHER_SESSION,
        [
          { id: 'agent-other-running', description: 'Run the tests', squishy: otherRunning },
          { id: 'agent-other-ended', description: 'Fix the build', squishy: otherEnded },
        ],
      ],
      [EARLIER_SESSION, [{ id: 'agent-mine', description: 'Reply alpha', squishy: mine }]],
    ]),
  )
  stubSessionStart(on)
  stubAgentList(on, [
    { id: 'agent-other-running', description: 'Run the tests', status: 'running' },
    { id: 'agent-other-ended', description: 'Fix the build', status: 'completed' },
    { id: 'agent-mine', description: 'Reply alpha', status: 'completed' },
    { id: 'agent-unknown-running', description: 'Review the docs', status: 'running' },
    { id: 'agent-unknown-ended', description: 'Find config parser', status: 'completed' },
  ])

  await $.classic.SessionStart({ source: 'resume', session_id: EARLIER_SESSION })

  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 6, 1)), surface: 'terminal' })
  expect((await ui.find({ key: 'picture-agent-mine' }))?.props.cells).toBe(cellsOf(mine, 'asleep'))
  expect(await (await watch(ui, 'agent-unknown-running')).state()).toBe('working')
  for (const id of ['agent-other-running', 'agent-other-ended', 'agent-unknown-ended']) expect(await ui.find({ key: `slot-${id}` })).toBeUndefined()
  expect(await agentPictures(ui)).toHaveLength(2)
})

test('after /clear, a running agent the cleared session started stays away, while one kept under no session joins', async ($, on) => {
  const [first] = earlierSquishys()
  stubStore(on, leftBy([[EARLIER_SESSION, [{ id: 'agent-a', description: 'Sleep then reply', squishy: first }]]]))
  stubSessionStart(on)
  stubAgentList(on, [
    { id: 'agent-a', description: 'Sleep then reply', status: 'running' },
    { id: 'agent-b', description: 'Run the tests', status: 'running' },
  ])

  await $.classic.SessionStart({ source: 'clear', session_id: 'session-after-clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'slot-agent-a' })).toBeUndefined()
  expect(await (await watch(ui, 'agent-b')).state()).toBe('working')
})

test('an agent spawned while `$.session.id()` still answers the session /resume left is kept as the resumed session’s, and once it catches up, as the one it answers', async ($, on) => {
  const stored = stubStore(on, PARTNERED)
  stubSpawns(on)
  stubSessionStart(on)
  stubAgentList(on, [])
  // Seen for #63: for a while after a resume, it answers the session left
  let answer = 'session-left'
  on('session.id', () => ({ value: answer }))
  await $.classic.SessionStart({ source: 'resume', session_id: EARLIER_SESSION })

  await $.agent.spawn(spawnOf('toolu_1'))
  answer = OTHER_SESSION
  await $.agent.spawn(spawnOf('toolu_2'))

  const kept = (sessionId: string) => agentsOfSession(sessionsFrom(stored.get(SESSIONS_KEY)), rememberedFrom(stored.get(REMEMBERED_KEY)), sessionId).map(agent => agent.id)
  expect(kept(EARLIER_SESSION)).toEqual(['agent-1'])
  expect(kept(OTHER_SESSION)).toEqual(['agent-2'])
  expect(kept('session-left')).toEqual([])
})

test('two restored agents with the same squishy both keep it, an agent’s identity winning, and no agent spawned after takes it', async ($, on) => {
  const [shared] = earlierSquishys()
  const stored = stubStore(
    on,
    leftBy([
      [
        EARLIER_SESSION,
        [
          { id: 'agent-a', description: 'Reply alpha', squishy: shared },
          { id: 'agent-b', description: 'Reply beta', squishy: shared },
        ],
      ],
    ]),
  )
  stubSpawns(on)
  stubSessionStart(on)
  stubAgentList(on, [])
  await $.classic.SessionStart({ source: 'resume', session_id: EARLIER_SESSION })
  // The roster never shows one squishy twice, so agent-b waits in the
  // overflow, still with its own squishy
  const ui = await $.ui.mount({ ...paneSized(roomFor('dock', 3, 1)), surface: 'terminal' })
  expect((await ui.find({ key: 'picture-agent-a' }))?.props.cells).toBe(cellsOf(shared, 'asleep'))
  await $.ui.press({ plugin: 'squishys', key: 'overflow' })
  expect((await ui.find({ key: 'squishy-agent-b' }))?.props.label).toBe(shared.name)

  for (const n of [1, 2, 3]) await $.agent.spawn(spawnOf(`toolu_${n}`))

  for (const id of ['agent-1', 'agent-2', 'agent-3']) expect(nameOfAgent(stored, id)).not.toBe(shared.name)
})

for (const [refused, kept] of [
  [REMEMBERED_KEY, SESSIONS_KEY],
  [SESSIONS_KEY, REMEMBERED_KEY],
] as const) {
  test(`a store that refuses to keep ${refused} still keeps ${kept} for a spawned agent`, async ($, on) => {
    const stored = new Map<string, unknown>(Object.entries(PARTNERED))
    on('store.get', ($, e) => ({ value: stored.get(e.key) }))
    on('store.set', ($, e) => {
      if (e.key === refused) throw new Error('the store refuses it')
      stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
      return { value: undefined }
    })
    stubSpawns(on)
    on('session.id', () => ({ value: EARLIER_SESSION }))

    await $.agent.spawn(spawnOf('toolu_1'))

    expect(stored.get(refused)).toBeUndefined()
    expect(stored.get(kept)).toBeDefined()
  })
}
