// Shiny and legendary moments: a squishy rolled shiny or legendary is
// announced with a toast (and, on macOS with the setting on, a chime), and
// its slot sparkles for a while. These are the rules; the agent tracker
// announces and the pane's animator sparkles.
// Pure: it takes plain data and never touches Claude Code.

import type { Squishy } from './roller'

/** Whether rolling this squishy is a moment: it's shiny, legendary or both. */
export function isMoment(squishy: Squishy): boolean {
  return squishy.shiny || squishy.kind === 'legendary'
}

/** The toast announcing a squishy just rolled; none for a plain one. */
export function momentToast(squishy: Squishy): string | undefined {
  const legendary = squishy.kind === 'legendary'
  if (legendary && squishy.shiny) return `🌟 Whoa! A shiny legendary ${squishy.name} appeared!`
  if (legendary) return `👑 A legendary ${squishy.name} appeared!`
  if (squishy.shiny) return `✨ A shiny ${squishy.name} appeared!`
  return undefined
}

/**
 * How long a shiny or legendary squishy's slot sparkles after it appears,
 * in milliseconds. A while, not always: a moment, and the animator can
 * rest once it's over, even while the squishy itself is Asleep for hours.
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
