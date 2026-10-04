// The agent tracker: turns Claude Code's events into the session's agents,
// each with the squishy that stands for it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Agent } from '../types'

/** Every agent seen this session, in the order they were first seen. */
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

export function registerAgentTracking(on: On): void {
  // Subagents, forks and background agents all start through agent.spawn.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) await meet($, started.agentId)
    return started
  })

  // Fallback for agents that start without agent.spawn (in-process
  // teammates may): an agent first seen through its tool call. Only ids
  // `$.agent.list()` names count, which leaves out workflow agents and
  // Claude Code's own forks.
  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined && !(await read($, agents)).some(agent => agent.id === agentId)) {
      const listed = await $.agent.list()
      if (listed.some(agent => agent.id === agentId)) await meet($, agentId)
    }
    return next(e)
  })
}

/** Gives an agent its squishy, unless it already has one. */
async function meet($: EngineInterface, agentId: string): Promise<void> {
  await update($, agents, list => {
    if (list.some(agent => agent.id === agentId)) return list
    const met: Agent = { id: agentId, squishy: { name: `Squishy ${list.length + 1}` } }
    return [...list, met]
  })
}
