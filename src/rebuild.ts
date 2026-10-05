// Rebuilding the roster when the session changes underneath it. /clear,
// /resume and a branch reset every $.state value, and session.start doesn't
// fire again; classic.SessionStart does. The roster is rebuilt from Claude
// Code's agent list, each agent's state read off its status, and each
// agent the mod gave a squishy before gets that squishy back: squishys are
// also kept in the store, by agent id. /resume also brings back the resumed
// session's agents the list has dropped: the store keeps which agents each
// session started.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On } from 'claude-code'

import type { Agent, Squishy, SquishyState } from '../types'
import { KIT } from './kit'
import { squishysOnScreen } from './pane'
import { PARTNER_KEY, partnerFrom } from './partner'
import { isMoment } from './moments'
import { cryptoRandom, forcedOdds, roll, squishyOf } from './roller'
import type { Odds } from './roller'
import { liveSquishys } from './slots'
import { recordMet } from './squishydex-record'
import type { StoreCalls } from './squishydex-record'
import { endedState, stateOfStatus } from './states'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

/**
 * Where the store keeps each agent's squishy (Remembered), the agent seen
 * longest ago first. Only the squishy's key, never a picture.
 */
export const REMEMBERED_KEY = 'agentSquishys'

/**
 * The most agents the store keeps a squishy for, and the most it keeps
 * under their sessions (SESSIONS_KEY). Every session shares the store and
 * the agent list names only its own session's agents, so entries are
 * dropped by age rather than for missing from one list. At a few dozen
 * bytes each (a description at most REMEMBERED_DESCRIPTION characters),
 * this stays far inside the store's 4 MiB.
 */
export const REMEMBERED_AGENTS = 1000

/** The most characters of an agent's description the store keeps. */
export const REMEMBERED_DESCRIPTION = 100

/** One agent's squishy, as the store keeps it. */
export type RememberedPair = [agentId: string, squishyKey: string]
export type Remembered = RememberedPair[]

/** The pairs a stored value holds, leaving out anything else. */
export function rememberedFrom(stored: unknown): Remembered {
  if (!Array.isArray(stored)) return []
  return stored.filter(
    (pair): pair is RememberedPair => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string',
  )
}

/**
 * The pairs with these agents' squishys as the ones seen last, and the
 * agents seen longest ago dropped past REMEMBERED_AGENTS.
 */
export function withRemembered(remembered: Remembered, seen: readonly Pick<Agent, 'id' | 'squishy'>[]): Remembered {
  const seenIds = new Set(seen.map(agent => agent.id))
  const older = remembered.filter(([agentId]) => !seenIds.has(agentId))
  const latest = seen.map((agent): RememberedPair => [agent.id, agent.squishy.key])
  return [...older, ...latest].slice(-REMEMBERED_AGENTS)
}

/**
 * Where the store keeps which agents each session started (Sessions), so
 * /resume of a session brings its agents back after Claude Code's agent
 * list has dropped them (#63). Their squishys stay under REMEMBERED_KEY.
 */
export const SESSIONS_KEY = 'sessionAgents'

/** One agent a session started, by id, with its description. */
export type SessionAgent = [agentId: string, description: string]
/** A session (`$.session.id()`) and the agents it started, in the order seen. */
export type SessionEntry = [sessionId: string, agents: SessionAgent[]]
/** The sessions the store keeps, the one that started an agent longest ago first. */
export type Sessions = SessionEntry[]

/** The sessions a stored value holds, leaving out anything else. */
export function sessionsFrom(stored: unknown): Sessions {
  if (!Array.isArray(stored)) return []
  const isAgent = (agent: unknown): agent is SessionAgent => Array.isArray(agent) && typeof agent[0] === 'string' && typeof agent[1] === 'string'
  return stored.flatMap((entry): Sessions => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) return []
    return [[entry[0], entry[1].filter(isAgent)]]
  })
}

/**
 * The sessions with these agents kept as this session's, which becomes the
 * one seen last. The sessions seen longest ago are dropped while they keep
 * more than REMEMBERED_AGENTS agents in all, never the one seen last.
 */
export function withSessionAgents(sessions: Sessions, sessionId: string, seen: readonly Pick<Agent, 'id' | 'description'>[]): Sessions {
  const seenIds = new Set(seen.map(agent => agent.id))
  const kept = sessions.find(([id]) => id === sessionId)?.[1] ?? []
  const agentsNow: SessionAgent[] = [
    ...kept.filter(([agentId]) => !seenIds.has(agentId)),
    ...seen.map((agent): SessionAgent => [agent.id, agent.description.slice(0, REMEMBERED_DESCRIPTION)]),
  ]
  const latest: SessionEntry = [sessionId, agentsNow.slice(-REMEMBERED_AGENTS)]
  const older = sessions.filter(([id]) => id !== sessionId)
  let total = latest[1].length + older.reduce((sum, [, each]) => sum + each.length, 0)
  while (total > REMEMBERED_AGENTS && older.length > 0) total -= older.shift()?.[1].length ?? 0
  return [...older, latest]
}

/**
 * The agents the store keeps as a session's, in the order they were seen,
 * each with its squishy. One whose squishy the store dropped, or the kit no
 * longer has, is left out.
 */
export function agentsOfSession(sessions: Sessions, remembered: Remembered, sessionId: string): Pick<Agent, 'id' | 'squishy' | 'description'>[] {
  const keyOf = new Map(remembered)
  const started = sessions.find(([id]) => id === sessionId)?.[1] ?? []
  return started.flatMap(([id, description]) => {
    const squishy = squishyOf(KIT, keyOf.get(id) ?? '')
    return squishy === undefined ? [] : [{ id, squishy, description }]
  })
}

/**
 * An agent just given a freshly rolled squishy, and whether
 * SQUISHYS_FORCE_ROLL forced it to come up shiny or legendary: such a roll
 * still toasts, sparkles and chimes, but the Squishydex never records it.
 * A roll forced plain counts as any other, since it reaches nothing the
 * standard odds don't (and it's what keeps the mod's tests from stray shinies).
 */
export type Rolled = { agent: Agent; forced: boolean }

/** Whether a roll made with these odds was forced to come up shiny or legendary. */
export function forcedMoment(odds: Partial<Odds> | undefined, squishy: Squishy): boolean {
  return odds !== undefined && isMoment(squishy)
}

/**
 * The agents the last rebuild gave fresh rolls, for the agent tracker's
 * classic.SessionStart hook (outside this one) to announce a shiny or
 * legendary among them, as it does a spawn's: `$` stays in each hook's file,
 * so they're handed over as plain data. Restored squishys are never here.
 */
let freshRolls: Rolled[] = []

/** The agents the last rebuild gave fresh rolls, handed over once. */
export function takeFreshRolls(): readonly Rolled[] {
  const taken = freshRolls
  freshRolls = []
  return taken
}

/** The last write to REMEMBERED_KEY and SESSIONS_KEY this process has queued. */
let remembering: Promise<void> = Promise.resolve()

/**
 * The one way squishys, and the sessions agents started in, are written to
 * the store: each write waits for the one before, then reads the values
 * again, merges these agents in and writes, so writes from this process
 * (parallel spawns, a spawn during a rebuild) never lose each other's. With
 * a session, the agents are kept as that session's too (withSessionAgents).
 * The hook passes its own store calls in (see StoreCalls), as `$` stays in
 * the hook's file. Another session writing between one read and write can
 * still lose an entry; that's rare, and costs only a squishy coming back
 * after /clear or /resume. A store that can't be written loses only that too.
 */
export function rememberSquishys({ get, set }: StoreCalls, seen: readonly Pick<Agent, 'id' | 'squishy' | 'description'>[], sessionId?: string): Promise<void> {
  remembering = remembering.then(async () => {
    // Each value on its own, so one that fails costs only itself
    try {
      await set(REMEMBERED_KEY, withRemembered(rememberedFrom(await get(REMEMBERED_KEY)), seen))
    } catch {}
    if (sessionId === undefined) return
    try {
      await set(SESSIONS_KEY, withSessionAgents(sessionsFrom(await get(SESSIONS_KEY)), sessionId, seen))
    } catch {}
  })
  return remembering
}

/**
 * Whether the roster of a session shows an agent the agent list names, which
 * names the agents of every session in the process: one the store keeps as
 * that session's does, one it keeps as only other sessions' doesn't, and one
 * it keeps under no session only while it runs.
 */
export function isOfSession(sessions: Sessions, sessionId: string, { id, status }: { id: string; status: string }): boolean {
  const keptUnder = sessions.filter(([, started]) => started.some(([agentId]) => agentId === id)).map(([session]) => session)
  if (keptUnder.length === 0) return endedState(status) === undefined
  return keptUnder.includes(sessionId)
}

/**
 * The session the latest classic.SessionStart (clear, resume, fork) named,
 * and what `$.session.id()` answered then. For a while after a resume,
 * `$.session.id()` still answers the session being left (seen for #63).
 */
let sessionStarted: { id: string; answered: string | undefined } | undefined

/**
 * The session an agent the tracker gives a squishy now started in, from what
 * `$.session.id()` answers (undefined when it failed): the session the latest
 * session start named while `$.session.id()` still answers what it did then.
 */
export function sessionOfSpawn(answered: string | undefined): string | undefined {
  if (sessionStarted !== undefined && (answered === undefined || answered === sessionStarted.answered)) return sessionStarted.id
  return answered
}

export function registerRebuild(on: On): void {
  // Compaction keeps $.state, so its rebuild only adds agents the roster lacks.
  // /resume also brings back the resumed session's agents the list no longer
  // names. It names that session by the event's session_id: at this point
  // `$.session.id()` still answers the session being left (seen for #63).
  // /clear goes on under a new session id, so it starts fresh. Both show
  // only the agents the list names that are their session's (isOfSession).
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork', 'compact'] }, async ($, e, next) => {
    if (e.source !== 'compact') {
      let answered: string | undefined
      try {
        answered = await $.session.id()
      } catch {}
      sessionStarted = { id: e.session_id, answered }
    }
    const ofSession = e.source === 'clear' || e.source === 'resume' ? e.session_id : undefined
    const added = await rebuild($, ofSession, e.source === 'resume')
    const started = await next(e)
    // Met: the Squishydex records the rebuilt squishys once the event has
    // gone on, all but forced rolls. It keeps a squishy's first-met date,
    // so a restored one changes nothing.
    const met = added.filter(({ forced }) => !forced).map(({ agent }) => agent.squishy)
    await recordMet({ get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), now: () => $.clock.now() }, met)
    return started
  })
}

/**
 * Adds every agent the agent list names that the roster lacks, in its
 * status's state; given a session (/clear's or /resume's), only those of
 * that session (isOfSession), and for /resume the session's own (below). An agent the store kept a squishy for gets it back,
 * even one another agent shows (an agent's identity wins); any other gets
 * a fresh roll that repeats no live squishy (see liveSquishys), no
 * restored one and not the partner's.
 * A store that can't be read means fresh rolls, never no roster.
 * SQUISHYS_FORCE_ROLL forces the fresh rolls, as it does the tracker's.
 *
 * Given the session /resume brings back, it also adds every agent the store
 * keeps as that session's (agentsOfSession), first, in the order they were
 * seen: Claude Code's list drops an agent within a minute of its end, so one
 * the list doesn't name has ended, and its squishy is Asleep. One the list
 * names takes its state from the list.
 *
 * Returns the agents it added, each with whether its roll was forced (a
 * restored squishy's never was), and keeps the fresh rolls for the
 * tracker to announce (takeFreshRolls).
 */
async function rebuild($: EngineInterface, sessionId: string | undefined, restoring: boolean): Promise<Rolled[]> {
  freshRolls = []
  const resumedSession = restoring ? sessionId : undefined
  let listed: AgentInfo[] = []
  try {
    listed = await $.agent.list()
  } catch {
    if (resumedSession === undefined) return [] // nothing to rebuild from
  }
  if (listed.length === 0 && resumedSession === undefined) return []
  let remembered: Remembered = []
  let sessions: Sessions = []
  let partner: Squishy | undefined
  try {
    remembered = rememberedFrom(await $.store.get(REMEMBERED_KEY))
    if (sessionId !== undefined) sessions = sessionsFrom(await $.store.get(SESSIONS_KEY))
    partner = partnerFrom(await $.store.get(PARTNER_KEY))
  } catch {}
  // The list names other sessions' agents too
  if (sessionId !== undefined) listed = listed.filter(info => isOfSession(sessions, sessionId, info))
  let odds: ReturnType<typeof forcedOdds>
  try {
    odds = forcedOdds(await $.env.get('SQUISHYS_FORCE_ROLL'))
  } catch {}
  // The resumed session's agents, then any other the list names
  const listedById = new Map(listed.map(info => [info.id, info]))
  const members = resumedSession === undefined ? [] : agentsOfSession(sessions, remembered, resumedSession)
  const memberIds = new Set(members.map(member => member.id))
  const wanted: { id: string; description: string; state: SquishyState }[] = [
    ...members.map(({ id, description }) => {
      const info = listedById.get(id)
      return { id, description: info?.description ?? description, state: info === undefined ? ('asleep' as const) : stateOfStatus(info.status) }
    }),
    ...listed.filter(info => !memberIds.has(info.id)).map(info => ({ id: info.id, description: info.description, state: stateOfStatus(info.status) })),
  ]
  const keyOf = new Map(remembered)
  const restored = new Map<string, Squishy>()
  for (const { id } of wanted) {
    const squishy = squishyOf(KIT, keyOf.get(id) ?? '')
    if (squishy !== undefined) restored.set(id, squishy)
  }
  let added: Agent[] = []
  const fresh = new Set<string>()
  // Against the roster as it is now, which a spawn may have joined meanwhile
  await update($, agents, current => {
    const missing = wanted.filter(each => !current.some(agent => agent.id === each.id))
    // Restored squishys all count, so no fresh roll repeats one
    const live: Squishy[] = [...liveSquishys(current, squishysOnScreen(), partner), ...missing.flatMap(each => restored.get(each.id) ?? [])]
    added = missing.map(({ id, description, state }): Agent => {
      let squishy = restored.get(id)
      if (squishy === undefined) {
        squishy = roll(KIT, { live, rng: cryptoRandom, ...(odds !== undefined ? { odds } : {}) })
        live.push(squishy)
        fresh.add(id)
      }
      return { id, description, squishy, state }
    })
    return added.length === 0 ? current : [...current, ...added]
  })
  if (added.length === 0) return []
  await rememberSquishys({ get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) }, added)
  const rolled = added.map(agent => ({ agent, forced: fresh.has(agent.id) && forcedMoment(odds, agent.squishy) }))
  freshRolls = rolled.filter(({ agent }) => fresh.has(agent.id))
  return rolled
}
