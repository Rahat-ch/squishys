// Rebuilding the roster when the session changes underneath it. /clear,
// /resume and a branch reset every $.state value, and session.start doesn't
// fire again; classic.SessionStart does. The roster is rebuilt from Claude
// Code's agent list, each agent's state read off its status, and each
// agent the mod gave a squishy before gets that squishy back: squishys are
// also kept in the store, by agent id.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On } from 'claude-code'

import type { Agent, Squishy } from '../types'
import { KIT } from './kit'
import { cryptoRandom, roll, squishyOf } from './roller'
import { stateOfStatus } from './states'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

/**
 * Where the store keeps each agent's squishy (Remembered), the agent seen
 * longest ago first. Only the squishy's key, never a picture.
 */
export const REMEMBERED_KEY = 'agentSquishys'

/**
 * The most agents the store keeps a squishy for. Every session shares the
 * store and the agent list names only its own session's agents, so pairs
 * are dropped by age rather than for missing from one list. At a few dozen
 * bytes each, this stays far inside the store's 4 MiB.
 */
export const REMEMBERED_AGENTS = 1000

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

/** The last write to REMEMBERED_KEY this process has queued. */
let remembering: Promise<void> = Promise.resolve()

/**
 * The one way squishys are written to the store: each write waits for the
 * one before, then reads the pairs again, merges these agents in and
 * writes, so writes from this process (parallel spawns, a spawn during a
 * rebuild) never lose each other's pairs. The hook passes its own store
 * calls in, as `$` stays in the hook's file. Another session writing
 * between one read and write can still lose a pair; that's rare, and costs
 * only a squishy coming back after /clear. A store that can't be written
 * loses only that too.
 */
export function rememberSquishys(
  store: { get: () => Promise<unknown>; set: (remembered: Remembered) => Promise<void> },
  seen: readonly Pick<Agent, 'id' | 'squishy'>[],
): Promise<void> {
  remembering = remembering.then(async () => {
    try {
      await store.set(withRemembered(rememberedFrom(await store.get()), seen))
    } catch {}
  })
  return remembering
}

export function registerRebuild(on: On): void {
  // Compaction keeps $.state, so its rebuild only adds agents the roster lacks.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork', 'compact'] }, async ($, e, next) => {
    await rebuild($)
    return next(e)
  })
}

/**
 * Adds every agent the agent list names that the roster lacks, in its
 * status's state. An agent the store kept a squishy for gets it back,
 * even one another agent shows (an agent's identity wins); any other gets
 * a fresh roll that no squishy in the roster has, restored ones included.
 * A store that can't be read means fresh rolls, never no roster.
 */
async function rebuild($: EngineInterface): Promise<void> {
  let listed: AgentInfo[]
  try {
    listed = await $.agent.list()
  } catch {
    return // nothing to rebuild from
  }
  if (listed.length === 0) return
  let remembered: Remembered = []
  try {
    remembered = rememberedFrom(await $.store.get(REMEMBERED_KEY))
  } catch {}
  const keyOf = new Map(remembered)
  const restored = new Map<string, Squishy>()
  for (const info of listed) {
    const squishy = squishyOf(KIT, keyOf.get(info.id) ?? '')
    if (squishy !== undefined) restored.set(info.id, squishy)
  }
  let added: Agent[] = []
  // Against the roster as it is now, which a spawn may have joined meanwhile
  await update($, agents, current => {
    const missing = listed.filter(info => !current.some(agent => agent.id === info.id))
    const live: Squishy[] = [...current.map(agent => agent.squishy), ...missing.flatMap(info => restored.get(info.id) ?? [])]
    added = missing.map((info): Agent => {
      let squishy = restored.get(info.id)
      if (squishy === undefined) {
        squishy = roll(KIT, { live, rng: cryptoRandom })
        live.push(squishy)
      }
      return { id: info.id, description: info.description, squishy, state: stateOfStatus(info.status) }
    })
    return added.length === 0 ? current : [...current, ...added]
  })
  if (added.length === 0) return
  await rememberSquishys({ get: () => $.store.get(REMEMBERED_KEY), set: remembered => $.store.set(REMEMBERED_KEY, remembered) }, added)
}
