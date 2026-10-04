// Moments: a squishy rolled shiny or legendary is announced with a toast
// (and, on macOS with the setting on, a chime), and its slot sparkles for
// a while. These are the rules; the agent tracker announces and the pane's
// animator sparkles.
// Pure: it takes plain data and never touches Claude Code.

import { rollKind } from './roller'
import type { RollKind, Squishy } from './roller'

/** Whether rolling this squishy is a Moment: it's shiny, legendary or both. */
export function isMoment(squishy: Pick<Squishy, 'kind' | 'shiny'>): boolean {
  return rollKind(squishy) !== 'plain'
}

/**
 * Each kind of Moment's toast, from the squishy's Name (a shiny's starts
 * with ✨ already, see SHINY_MARK); a plain roll gets none.
 */
const TOASTS: Readonly<Record<RollKind, ((name: string) => string) | undefined>> = {
  plain: undefined,
  shiny: name => `A shiny ${name} appeared!`,
  legendary: name => `👑 A legendary ${name} appeared!`,
  'shiny-legendary': name => `🌟 Whoa! A shiny legendary ${name} appeared!`,
}

/** The toast announcing a squishy just rolled; none for a plain one. */
export function momentToast(squishy: Squishy): string | undefined {
  return TOASTS[rollKind(squishy)]?.(squishy.name)
}

/**
 * How long a shiny or legendary squishy's slot sparkles after it appears,
 * in milliseconds. A while, not always: once it's over the animator can
 * rest, even while the squishy itself is Asleep for hours.
 */
export const SPARKLE_MS = 10_000

/**
 * Until when a squishy that appeared at `now` sparkles (`$.clock.now()`
 * milliseconds); undefined for a plain one, which never does.
 */
export function sparkleUntil(squishy: Squishy, now: number): number | undefined {
  return isMoment(squishy) ? now + SPARKLE_MS : undefined
}

/** Whether a squishy sparkling until `until` still sparkles at `now`. */
export function isSparkling(until: number | undefined, now: number): boolean {
  return until !== undefined && now < until
}

/**
 * The agents with every sparkle that has passed by `now` cleared, so
 * nothing reads the clock for it again, and when the next one still to
 * come ends (undefined when none is left). The same agents when none has passed.
 */
export function withSparklesTidied<A extends { sparkleUntil?: number }>(agents: readonly A[], now: number): { agents: readonly A[]; nextEnd?: number } {
  const ends = agents.flatMap(agent => (agent.sparkleUntil === undefined ? [] : [agent.sparkleUntil]))
  const coming = ends.filter(until => isSparkling(until, now))
  const nextEnd = coming.length > 0 ? Math.min(...coming) : undefined
  if (coming.length === ends.length) return { agents, ...(nextEnd !== undefined ? { nextEnd } : {}) }
  const tidied = agents.map(agent => {
    if (agent.sparkleUntil === undefined || isSparkling(agent.sparkleUntil, now)) return agent
    const { sparkleUntil: _, ...rest } = agent
    return rest as A
  })
  return { agents: tidied, ...(nextEnd !== undefined ? { nextEnd } : {}) }
}
