// The agent tracker: turns Claude Code's events into the session's agents,
// each with the squishy that stands for it and the state its squishy shows.
// The state rules themselves live in states.ts.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, EngineInterface, On, Timer } from 'claude-code'

import type { Agent, Squishy, SquishyState } from '../types'
import { KIT } from './kit'
import { OPEN_PANE, PANE_ID, squishysOnScreen } from './pane'
import { PARTNER_KEY, partnerFrom } from './partner'
import { REMEMBERED_KEY, rememberSquishys } from './rebuild'
import { cryptoRandom, roll } from './roller'
import { SQUISHYDEX_KEY, recordMet } from './squishydex'
import { SETTINGS_KEY, settingsFrom, withModelDefault } from './settings'
import { liveSquishys } from './slots'
import { answered, endedState, isEnded, stateAfterRun, stateAtStop } from './states'
import { STOPPED_BY_USER, disarmed, entryNamed, forgetStops, isHeldBack, refusalOf, resumed, runEnded, wasStoppedByUser } from './stop'

/**
 * How often, in milliseconds, the agent list is checked for agents that
 * failed or were stopped without a stop event, while any agent runs.
 */
export const AGENT_CHECK_MS = 5000

/** Every agent seen this session, in the order they were first seen. */
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const stopControl = atom({ plugin: 'squishys', key: 'stopControl' } as const, null)

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

  // After /clear, /resume, a branch or compaction, rebuild.ts's hook rebuilds
  // the roster before passing the event on, and this one checks after it:
  // the agent list is checked while any rebuilt agent runs.
  // Stop forgets every agent but after compaction, which keeps the session.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork', 'compact'] }, async ($, e, next) => {
    if (e.source !== 'compact') forgetStops()
    const started = await next(e)
    if ((await read($, agents)).some(agent => !isEnded(agent.state))) keepChecking($)
    return started
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
  //
  // An agent Stop holds back (src/stop.ts) has its tool calls refused,
  // before anything else sees them.
  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined && isHeldBack(agentId)) return { deny: STOPPED_BY_USER }
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
    // The squishy of an agent TaskStop stopped (the focus view's Stop, or the
    // orchestrator itself) is Squished, once the agent list shows it ended.
    // TaskStop names a teammate by its address or name, any other agent by id.
    if (e.tool === 'TaskStop' && e.task_id !== undefined && refusalOf(result) === undefined) {
      let entry: AgentInfo | undefined
      try {
        entry = entryNamed(e.task_id, await $.agent.list())
      } catch {}
      if (entry !== undefined && endedState(entry.status) !== undefined) {
        const { id, status } = entry
        await setState($, id, state => stateAtStop(state, { status, stoppedByUser: wasStoppedByUser(id) }))
      }
    }
    return result
  })

  // A squishy is Thinking from the first piece of its agent's response to
  // the last, then Working while the agent runs the tools the response
  // called, or until the turn completes.
  //
  // An agent Stop holds back gets an answer that ends its run instead of a
  // model request: no model is called. A request from one whose squishy
  // is Asleep or Squished is a resume, though, and goes through.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    if (agentId !== undefined && isHeldBack(agentId)) {
      const resuming = (await read($, agents)).some(agent => agent.id === agentId && isEnded(agent.state))
      if (resuming) {
        resumed(agentId)
      } else {
        yield { kind: 'text', index: 0, text: STOPPED_BY_USER } as const
        return { turnId: e.turnId, index: e.index, answer: STOPPED_BY_USER, toolUses: [], stopReason: 'end_turn', usage: null }
      }
    }
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
  // the agent finished, failed or was stopped. A run the user stopped was
  // stopped, whatever it answered.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) await setState($, e.agentId, stateAfterRun(e.reason, wasStoppedByUser(e.agentId)))
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

  // An agent that stopped: the agent list says how (see stateAtStop).
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    let status: AgentStatus | undefined
    try {
      status = (await $.agent.list()).find(agent => agent.id === e.agent_id)?.status
    } catch {}
    await setState($, e.agent_id, state => stateAtStop(state, { ...(status === undefined ? {} : { status }), stoppedByUser: wasStoppedByUser(e.agent_id) }))
    return result
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
  let before: SquishyState | undefined
  const written = await update($, agents, known => {
    before = known.find(agent => agent.id === agentId)?.state
    return known.map(agent => (changes(agent) ? { ...agent, state: stateFrom(agent.state) } : agent))
  })
  const state = written.find(agent => agent.id === agentId)?.state
  if (state !== undefined && !isEnded(state)) keepChecking($)
  // An agent that ends or resumes: Stop no longer holds it back, forgets it
  // once it resumes, and disarms for it either way.
  if (state === undefined || before === undefined || isEnded(state) === isEnded(before)) return
  if (isEnded(state)) runEnded(agentId)
  else resumed(agentId)
  await update($, stopControl, control => disarmed(control, agentId))
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
    if (status === undefined || endedState(status) === undefined) continue
    await setState($, agent.id, state => stateAtStop(state, { status, stoppedByUser: wasStoppedByUser(agent.id) }))
  }
}

/**
 * Opens the pane at the session's first agent, unless it's open already.
 * Unasked, Claude Code places it only on a wide terminal (144 columns, 110
 * once the user has opened it before) and leaves it unplaced otherwise,
 * while the band (src/band.tsx) shows instead.
 */
async function openPaneUnasked($: EngineInterface): Promise<void> {
  try {
    if ((await $.ui.panes()).some(pane => pane.id === PANE_ID)) return
    await $.ui.open(OPEN_PANE)
  } catch {} // a refused open leaves the agent its squishy all the same
}

function hasSquishy(known: readonly Agent[], agentId: string): boolean {
  return known.some(agent => agent.id === agentId)
}

/**
 * Gives an agent a freshly rolled squishy, unless it already has one. The
 * roll leaves out every running agent's squishy and every one in the
 * roster's slots: an Asleep squishy stays on screen in its slot until a new
 * agent takes it (see liveSquishys). An ended agent that wakes
 * keeps its own squishy, even if another agent has rolled it since: an
 * agent's identity wins over keeping squishys apart. Nor does it repeat
 * the partner's.
 */
async function assignSquishy($: EngineInterface, agentId: string, description: string, model?: string): Promise<void> {
  let partner: Squishy | undefined
  try {
    partner = partnerFrom(await $.store.get(PARTNER_KEY))
  } catch {}
  let assigned: Agent | undefined
  let first = false
  await update($, agents, known => {
    if (hasSquishy(known, agentId)) return known
    const squishy = roll(KIT, { live: liveSquishys(known, squishysOnScreen(), partner), rng: cryptoRandom })
    assigned = { id: agentId, description, squishy, state: 'working', ...(model !== undefined ? { model } : {}) }
    first = known.length === 0
    return [...known, assigned]
  })
  keepChecking($)
  if (first) await openPaneUnasked($)
  // Kept in the store too, so it comes back after /clear or /resume
  if (assigned === undefined) return
  await rememberSquishys({ get: () => $.store.get(REMEMBERED_KEY), set: remembered => $.store.set(REMEMBERED_KEY, remembered) }, [assigned])
  // and met: the Squishydex records it
  await recordMet({ get: () => $.store.get(SQUISHYDEX_KEY), set: dex => $.store.set(SQUISHYDEX_KEY, dex) }, [assigned.squishy], await $.clock.now())
}
