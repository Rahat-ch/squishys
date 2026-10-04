// The agent tracker: turns Claude Code's events into the session's agents,
// each with the squishy that stands for it and the state its squishy shows
// (Needs you comes later, with the permission prompts).

import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, EngineInterface, On, Timer } from 'claude-code'

import type { Agent, SquishyState } from '../types'
import { KIT } from './kit'
import { roll } from './roller'
import { SETTINGS_KEY, settingsFrom, withModelDefault } from './settings'

/**
 * How often, in milliseconds, the agent list is checked for agents that
 * failed or were stopped without a stop event, while any agent runs.
 */
export const AGENT_CHECK_MS = 5000

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

  // An agent running a tool is Working, an ended one that a message resumed
  // too. And the fallback for agents that start without agent.spawn
  // (in-process teammates may): an agent first seen through its tool call.
  // Only ids `$.agent.list()` names count, which leaves out workflow agents
  // and Claude Code's own forks.
  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined && !notAgents.has(agentId) && !hasSquishy(await read($, agents), agentId)) {
      const listed = (await $.agent.list()).find(agent => agent.id === agentId)
      if (listed !== undefined) await assignSquishy($, agentId, listed.description)
      else notAgents.add(agentId)
    }
    if (agentId !== undefined) await setState($, agentId, 'working')
    return next(e)
  })

  // A squishy is Thinking from the first piece of its agent's response to
  // the last, then Working while the agent runs the tools the response
  // called, or until the turn completes.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    const response = next(e)
    if (agentId === undefined) return yield* response
    let streaming = false
    try {
      for await (const chunk of response) {
        if (!streaming) {
          streaming = true
          await setState($, agentId, 'thinking')
        }
        yield chunk
      }
    } finally {
      if (streaming) await setState($, agentId, 'working')
    }
    return await response.result
  })

  // Each run of an agent's loop is one turn. One that answered (or refused)
  // finished normally; one that died on an error, or that the user
  // interrupted, failed or was stopped.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) {
      await setState($, e.agentId, e.reason === 'error' || e.reason === 'aborted' ? 'squished' : 'asleep')
    }
    return completed
  })

  // An agent that stopped: the agent list says whether it finished, failed
  // or was stopped. One the list can't tell about finished.
  on('classic.SubagentStop', async ($, e, next) => {
    const stopped = await next(e)
    let status: AgentStatus | undefined
    try {
      status = (await $.agent.list()).find(agent => agent.id === e.agent_id)?.status
    } catch {}
    await setState($, e.agent_id, status !== undefined && endedBadly(status) ? 'squished' : 'asleep')
    return stopped
  })
}

/** Whether an agent list status says the agent failed or was stopped. */
function endedBadly(status: AgentStatus): boolean {
  return status === 'failed' || status === 'killed'
}

/**
 * Whether an agent is still running: not Asleep or Squished. A message can
 * resume an agent that ended, and its activity makes it running again.
 */
function isRunning(agent: { state: SquishyState }): boolean {
  return agent.state !== 'asleep' && agent.state !== 'squished'
}

/** Puts an agent's squishy in a state; agents without a squishy are left out. */
async function setState($: EngineInterface, agentId: string, state: SquishyState): Promise<void> {
  // Read first, so a state that doesn't change redraws nothing
  if (!(await read($, agents)).some(agent => agent.id === agentId && agent.state !== state)) return
  await update($, agents, known => known.map(agent => (agent.id === agentId ? { ...agent, state } : agent)))
  if (isRunning({ state })) keepChecking($)
}

/** The agent list check's timer, set while any agent is running. */
let checking: Timer | undefined

/**
 * Checks the agent list every AGENT_CHECK_MS while any agent is running,
 * for agents that ended without a stop event or a turn of their own ending.
 */
function keepChecking($: EngineInterface): void {
  checking ??= $.clock.every(AGENT_CHECK_MS, () => void checkAgentList($))
}

async function checkAgentList($: EngineInterface): Promise<void> {
  const running = (await read($, agents)).filter(isRunning)
  if (running.length === 0) {
    checking?.cancel()
    checking = undefined
    return
  }
  let listed: AgentInfo[]
  try {
    listed = await $.agent.list()
  } catch {
    return // checked again next time
  }
  for (const agent of running) {
    const status = listed.find(each => each.id === agent.id)?.status
    if (status === undefined) continue
    if (endedBadly(status)) await setState($, agent.id, 'squished')
    else if (status === 'completed') await setState($, agent.id, 'asleep')
  }
}

function hasSquishy(known: readonly Agent[], agentId: string): boolean {
  return known.some(agent => agent.id === agentId)
}

/**
 * Gives an agent a freshly rolled squishy, unless it already has one. The
 * roll leaves out the squishys running agents have; those of agents that
 * are Asleep or Squished are back in the pool.
 */
async function assignSquishy($: EngineInterface, agentId: string, description: string): Promise<void> {
  await update($, agents, known => {
    if (hasSquishy(known, agentId)) return known
    const live = known.filter(isRunning).map(agent => agent.squishy)
    const squishy = roll(KIT, { live, rng: cryptoRandom })
    const agent: Agent = { id: agentId, description, squishy, state: 'working' }
    return [...known, agent]
  })
  keepChecking($)
}

/** Real randomness for the roller: a number in [0, 1) from the platform. */
function cryptoRandom(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return value / 0x1_0000_0000
}
