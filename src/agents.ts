// The agent tracker: turns Claude Code's events into the session's agents,
// each with the squishy that stands for it and the state its squishy shows.
// The state rules themselves live in states.ts.

import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, On, Timer } from 'claude-code'

import type { Agent, SquishyState } from '../types'
import { KIT } from './kit'
import { roll } from './roller'
import { SETTINGS_KEY, settingsFrom, withModelDefault } from './settings'
import { answered, endedState, isEnded, stateAfterRun } from './states'

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
  // A hot reload keeps $.state but drops this module's timers, and starts
  // the session again. The pane's hook on session.start is the unmatched
  // one, and `$` can't be handed across files, so the agent tracker's hook
  // matches every session instead.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    agentCheck?.cancel()
    agentCheck = undefined
    if ((await read($, agents)).some(agent => !isEnded(agent.state))) keepChecking($)
    return next(e)
  })

  // Subagents, forks and background agents all start through agent.spawn,
  // on the user's default model when one is set.
  on('agent.spawn', async ($, e, next) => {
    // A store that can't be read means no default, never a lost squishy.
    let settings = settingsFrom(undefined)
    try {
      settings = settingsFrom(await $.store.get(SETTINGS_KEY))
    } catch {}
    const started = await next(withModelDefault(e, settings))
    if (started.agentId !== undefined) await assignSquishy($, started.agentId, e.description, started.model)
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
    const result = await next(e)
    // A prompt the call raised has been answered once its result is in. This
    // dispatch's reads predate the prompt, so `asking` says whether one came.
    if (agentId !== undefined && asking.has(agentId)) await setState($, agentId, answered, { current: true })
    return result
  })

  // A squishy is Thinking from the first piece of its agent's response to
  // the last, then Working while the agent runs the tools the response
  // called, or until the turn completes.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    const response = next(e)
    if (agentId === undefined) return yield* response
    await signOfLife($, agentId)
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
      // Only a squishy still Thinking goes back to Working: an agent that
      // ended while its response streamed stays ended
      if (streaming) await setState($, agentId, 'working', { from: 'thinking' })
    }
    return await response.result
  })

  // Each run of an agent's loop is one turn, and how it ended says whether
  // the agent finished, failed or was stopped.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) await setState($, e.agentId, stateAfterRun(e.reason))
    return completed
  })

  // An agent whose tool call asks the user for permission Needs you, unless
  // a settings hook decided the request (`decision`, or `block` to refuse
  // it), so no prompt shows.
  // A prompt from the orchestrator carries no agent_id and marks nothing.
  on('classic.PermissionRequest', async ($, e, next) => {
    const asked = await next(e)
    if (e.agent_id !== undefined && asked.decision === undefined && asked.block === undefined) {
      await setState($, e.agent_id, 'needsYou')
    }
    return asked
  })

  // Nothing fires when the user answers a prompt; the agent's next sign of
  // life says they did.
  on('classic.PostToolUse', async ($, e, next) => {
    await signOfLife($, e.agent_id)
    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    await signOfLife($, e.agent_id)
    return next(e)
  })

  // An agent that stopped: the agent list says whether it finished, failed
  // or was stopped. One the list can't tell about finished.
  on('classic.SubagentStop', async ($, e, next) => {
    const stopped = await next(e)
    let status: AgentStatus | undefined
    try {
      status = (await $.agent.list()).find(agent => agent.id === e.agent_id)?.status
    } catch {}
    await setState($, e.agent_id, (status !== undefined ? endedState(status) : undefined) ?? 'asleep')
    return stopped
  })
}

/**
 * Puts an agent's squishy in a state, or the state `to` makes of its
 * current one; agents without a squishy are left out, and with `from`, so is
 * a squishy in any other state than that.
 *
 * It reads first, so a state that doesn't change redraws nothing. Every read
 * in one dispatch sees the moment the dispatch began, so `current` skips
 * that read, for a change another event made since.
 */
async function setState(
  $: EngineInterface,
  agentId: string,
  to: SquishyState | ((state: SquishyState) => SquishyState),
  { from, current = false }: { from?: SquishyState; current?: boolean } = {},
): Promise<void> {
  const stateFrom = typeof to === 'function' ? to : () => to
  const changes = (agent: Agent) => agent.id === agentId && stateFrom(agent.state) !== agent.state && (from === undefined || agent.state === from)
  // Any other state means the agent has moved on from its prompt
  if (to !== 'needsYou') asking.delete(agentId)
  if (!current) {
    const known = await read($, agents)
    if (to === 'needsYou' && hasSquishy(known, agentId)) asking.add(agentId)
    if (!known.some(changes)) return
  }
  const written = await update($, agents, known => known.map(agent => (changes(agent) ? { ...agent, state: stateFrom(agent.state) } : agent)))
  const state = written.find(agent => agent.id === agentId)?.state
  if (state !== undefined && !isEnded(state)) keepChecking($)
}

/**
 * The agents a permission prompt put in Needs you, until they move on. The
 * tool.call hook reads it after `await next(e)`, where its `$.state` reads
 * still show the moment before the prompt. A reload empties it; the agent's
 * next sign of life in a dispatch of its own clears Needs you then.
 */
const asking = new Set<string>()

/**
 * A sign of life from an agent, in a dispatch of its own: a prompt it was
 * on has been answered, so it moves on from Needs you by the rule in
 * states.ts.
 */
async function signOfLife($: EngineInterface, agentId: string | undefined): Promise<void> {
  if (agentId !== undefined) await setState($, agentId, answered)
}

/** The agent list check's timer, set while any agent is running. */
let agentCheck: Timer | undefined

/**
 * Checks the agent list every AGENT_CHECK_MS while any agent is running,
 * for agents that ended without a stop event or a turn of their own ending.
 */
function keepChecking($: EngineInterface): void {
  agentCheck ??= $.clock.every(AGENT_CHECK_MS, () => void checkAgentList($))
}

async function checkAgentList($: EngineInterface): Promise<void> {
  const running = (await read($, agents)).filter(agent => !isEnded(agent.state))
  if (running.length === 0) {
    agentCheck?.cancel()
    agentCheck = undefined
    return
  }
  let listed: { id: string; status: AgentStatus }[]
  try {
    listed = await $.agent.list()
  } catch {
    return // checked again next time
  }
  for (const agent of running) {
    const status = listed.find(each => each.id === agent.id)?.status
    const ended = status !== undefined ? endedState(status) : undefined
    if (ended !== undefined) await setState($, agent.id, ended)
  }
}

function hasSquishy(known: readonly Agent[], agentId: string): boolean {
  return known.some(agent => agent.id === agentId)
}

/**
 * Gives an agent a freshly rolled squishy, unless it already has one. The
 * roll leaves out every squishy in the roster, running or ended: an Asleep
 * squishy stays on screen in its slot. (Once slots are reused, an agent
 * whose slot went to another leaves the pool.) An ended agent that wakes
 * keeps its own squishy, even if another agent has rolled it since: an
 * agent's identity wins over keeping squishys apart.
 */
async function assignSquishy($: EngineInterface, agentId: string, description: string, model?: string): Promise<void> {
  await update($, agents, known => {
    if (hasSquishy(known, agentId)) return known
    const squishy = roll(KIT, { live: known.map(agent => agent.squishy), rng: cryptoRandom })
    const agent: Agent = { id: agentId, description, squishy, state: 'working', ...(model !== undefined ? { model } : {}) }
    return [...known, agent]
  })
  keepChecking($)
}

/** Real randomness for the roller: a number in [0, 1) from the platform. */
function cryptoRandom(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return value / 0x1_0000_0000
}
