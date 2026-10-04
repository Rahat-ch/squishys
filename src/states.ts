// The squishy states and their rules, in one place: which states have
// ended, which animate, which state the way an agent ended maps to, and
// what an answered permission prompt leaves.
// Pure: it takes plain data and never touches Claude Code, so the agent
// tracker, the pane and the tests all share it.

/** What a squishy shows about its agent. types/index.d.ts writes it out again. */
export type SquishyState = 'working' | 'thinking' | 'needsYou' | 'asleep' | 'squished'

/** Every squishy state. */
export const SQUISHY_STATES: readonly SquishyState[] = ['working', 'thinking', 'needsYou', 'asleep', 'squished']

/**
 * Whether a squishy's agent has ended: Asleep or Squished. A message can
 * resume an agent that ended, and its activity makes it running again.
 */
export function isEnded(state: SquishyState): boolean {
  return state === 'asleep' || state === 'squished'
}

/**
 * The ended states whose squishys give up their roster slots, in the order
 * they give them up: Asleep before Squished, so failures stay in view
 * longer. A running squishy gives up its slot only to a smaller pane.
 */
export const SLOT_GIVING_ORDER: readonly SquishyState[] = ['asleep', 'squished']

/** Whether a squishy in this state animates. */
export function moves(state: SquishyState): boolean {
  return state === 'working' || state === 'thinking'
}

/**
 * The state an agent's status in the agent list means, once it has ended:
 * finished is Asleep, failed or stopped is Squished. Undefined while it runs.
 */
export function endedState(status: string): SquishyState | undefined {
  if (status === 'completed') return 'asleep'
  if (status === 'failed' || status === 'killed') return 'squished'
  return undefined
}

/**
 * The state an agent's status in the agent list means at any time: its
 * ended state once it has ended, and Working until then. For a squishy the
 * mod hasn't followed its agent's events for, as after /clear.
 */
export function stateOfStatus(status: string): SquishyState {
  return endedState(status) ?? 'working'
}

/**
 * The state a run of an agent's loop leaves it in, by why the run ended:
 * one that answered (or refused) finished, one that ended on an error or
 * that the user interrupted failed or was stopped.
 */
export function stateAfterRun(reason: string): SquishyState {
  return reason === 'error' || reason === 'aborted' ? 'squished' : 'asleep'
}

/**
 * The state a squishy is in once its agent shows a sign of life after a
 * permission prompt, since nothing says when the user answers it: Needs you
 * is Working again. Any other state stays as it was, so an agent that ended
 * while the prompt was open stays Asleep or Squished.
 */
export function answered(state: SquishyState): SquishyState {
  return state === 'needsYou' ? 'working' : state
}
