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

/**
 * Whether a squishy in this state animates: Working and Thinking do, and
 * one that's `sparkling` (a shiny or legendary just after it appears, see
 * src/moments.ts) does in any state.
 */
export function moves(state: SquishyState, sparkling = false): boolean {
  return sparkling || state === 'working' || state === 'thinking'
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
 * Why a run of an agent's loop ended. Mirrors the engine's
 * `TurnCompleteReason`, written out since this module never imports from
 * Claude Code.
 */
export type TurnCompleteReason = 'answer' | 'aborted' | 'refusal' | 'error'

/**
 * The state a run of an agent's loop leaves it in, by why the run ended:
 * one that answered (or refused) finished, one that ended on an error or
 * that the user interrupted failed or was stopped. A run the user stopped
 * was stopped, whatever its reason says.
 */
export function stateAfterRun(reason: TurnCompleteReason, stoppedByUser = false): SquishyState {
  return stoppedByUser || reason === 'error' || reason === 'aborted' ? 'squished' : 'asleep'
}

/**
 * The state a squishy is in once a stop event (SubagentStop, TaskStop, the
 * agent list showing it ended) says its agent stopped, with the agent's
 * status in the agent list if it gave one. One whose run already ended
 * keeps what that end gave it. Otherwise one the user stopped is Squished,
 * whatever the list says (a run the fallback ended reads as completed), and
 * any other takes its status's state: Asleep when the list can't tell.
 */
export function stateAtStop(state: SquishyState, { status, stoppedByUser }: { status?: string; stoppedByUser: boolean }): SquishyState {
  if (isEnded(state)) return state
  if (stoppedByUser) return 'squished'
  return (status === undefined ? undefined : endedState(status)) ?? 'asleep'
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
