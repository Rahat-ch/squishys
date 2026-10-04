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
    const result = await next(e)
    // A prompt the call raised has been answered once its result is in
    if (agentId !== undefined) await clearNeedsYou($, agentId)
    return result
  })

  // A squishy is Thinking from the first piece of its agent's response to
  // the last, then Working while the agent runs the tools the response
  // called, or until the turn completes.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    const response = next(e)
    if (agentId === undefined) return yield* response
    await clearNeedsYou($, agentId)
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

  // An agent blocked on a permission prompt Needs you, unless a settings
  // hook answered the request so no prompt shows. A prompt from the
  // orchestrator carries no agent_id and marks nothing.
  on('classic.PermissionRequest', async ($, e, next) => {
    const asked = await next(e)
    if (e.agent_id === undefined || asked.decision !== undefined) return asked
    await setState($, e.agent_id, 'needsYou')
    if (hasSquishy(await read($, agents), e.agent_id)) asking.add(e.agent_id)
    return asked
  })

  // Nothing fires when the user answers a prompt; the agent's next sign of
  // life says they did.
  on('classic.PostToolUse', async ($, e, next) => {
    if (e.agent_id !== undefined) await clearNeedsYou($, e.agent_id)
    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    if (e.agent_id !== undefined) await clearNeedsYou($, e.agent_id)
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
 * Puts an agent's squishy in a state; agents without a squishy are left
 * out, and with `from`, so is a squishy in any other state than that.
 */
async function setState(
  $: EngineInterface,
  agentId: string,
  state: SquishyState,
  { from }: { from?: SquishyState } = {},
): Promise<void> {
  const changes = (agent: Agent) => agent.id === agentId && agent.state !== state && (from === undefined || agent.state === from)
  // Read first, so a state that doesn't change redraws nothing
  if (!(await read($, agents)).some(changes)) return
  await update($, agents, known => known.map(agent => (changes(agent) ? { ...agent, state } : agent)))
  if (!isEnded(state)) keepChecking($)
}

/**
 * The agents a permission prompt put in Needs you. Every read in one
 * dispatch sees the moment it began, so after `await next(e)` the tool.call
 * hook can't read that a prompt its call raised marked the agent; this says
 * so. A reload empties it, and the agent's next model request clears Needs
 * you then.
 */
const asking = new Set<string>()

/** Moves an agent's squishy on from Needs you, by the rule in states.ts. */
async function clearNeedsYou($: EngineInterface, agentId: string): Promise<void> {
  if (asking.delete(agentId)) {
    // update writes on the value as it stands now, not as this dispatch read it
    await update($, agents, known => known.map(agent => (agent.id === agentId ? { ...agent, state: answered(agent.state) } : agent)))
    return
  }
  const agent = (await read($, agents)).find(each => each.id === agentId)
  if (agent !== undefined) await setState($, agentId, answered(agent.state))
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
async function assignSquishy($: EngineInterface, agentId: string, description: string): Promise<void> {
  await update($, agents, known => {
    if (hasSquishy(known, agentId)) return known
    const squishy = roll(KIT, { live: known.map(agent => agent.squishy), rng: cryptoRandom })
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
