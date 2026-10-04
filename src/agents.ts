// The agent tracker: turns Claude Code's events into the session's agents,
// each with the squishy that stands for it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Agent } from '../types'
import { KIT } from './kit'
import { roll } from './roller'
import { SETTINGS_KEY, settingsFrom, withModelDefault } from './settings'

/** Every agent seen this session, in the order they were first seen. */
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

/**
 * Ids a tool call carried that `$.agent.list()` didn't name (workflow agents,
 * Claude Code's own forks), so each is looked up only once.
 */
const notAgents = new Set<string>()

export function registerAgentTracking(on: On): void {
  // Subagents, forks and background agents all start through agent.spawn,
  // on the user's default model when one is set.
  on('agent.spawn', async ($, e, next) => {
    // A store that can't be read means no default, never a lost squishy.
    let settings = settingsFrom(undefined)
    try {
      settings = settingsFrom(await $.store.get(SETTINGS_KEY))
    } catch {}
    const started = await next(withModelDefault(e, settings))
    if (started.agentId !== undefined) await assignSquishy($, started.agentId, e.description)
    return started
  })

  // Fallback for agents that start without agent.spawn (in-process
  // teammates may): an agent first seen through its tool call. Only ids
  // `$.agent.list()` names count, which leaves out workflow agents and
  // Claude Code's own forks.
  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined && !notAgents.has(agentId) && !hasSquishy(await read($, agents), agentId)) {
      const listed = (await $.agent.list()).find(agent => agent.id === agentId)
      if (listed !== undefined) await assignSquishy($, agentId, listed.description)
      else notAgents.add(agentId)
    }
    return next(e)
  })
}

function hasSquishy(known: readonly Agent[], agentId: string): boolean {
  return known.some(agent => agent.id === agentId)
}

/**
 * Gives an agent a freshly rolled squishy, unless it already has one. The
 * roll leaves out the squishys every agent seen this session already has.
 */
async function assignSquishy($: EngineInterface, agentId: string, description: string): Promise<void> {
  await update($, agents, known => {
    if (hasSquishy(known, agentId)) return known
    const squishy = roll(KIT, { live: known.map(agent => agent.squishy), rng: cryptoRandom })
    return [...known, { id: agentId, description, squishy }]
  })
}

/** Real randomness for the roller: a number in [0, 1) from the platform. */
function cryptoRandom(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return value / 0x1_0000_0000
}
