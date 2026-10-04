// The squishy verbs the spinner's word sometimes gives way to (src/spinner.tsx).
// Pure: the pick takes its randomness, so tests pass `seeded(n)` and the mod
// `cryptoRandom`.

import type { Rng } from './roller'

/** The squishy verbs a turn's word may give way to, drawn as Claude Code draws its own. */
export const SQUISHY_VERBS = [
  'Squishing',
  'Squooshing',
  'Smooshing',
  'Steaming',
  'Dumpling',
  'Mochi-ing',
  'Bao-ing',
  'Daifuku-ing',
  'Dim-summing',
  'Pleating',
  'Pinching',
  'Kneading',
  'Proofing',
  'Puffing',
  'Plumping',
  'Simmering',
  'Wobbling',
  'Jiggling',
  'Boinging',
  'Bouncing',
  'Snuggling',
  'Wiggling',
] as const

/** The share of turns whose word gives way to a squishy verb. */
export const VERB_ODDS = 1 / 3

/** A squishy verb for one turn, with `odds` chance, each verb as likely; undefined to leave Claude Code's word. */
export function pickVerb(rng: Rng, odds: number = VERB_ODDS): string | undefined {
  if (rng() >= odds) return undefined
  return SQUISHY_VERBS[Math.floor(rng() * SQUISHY_VERBS.length)]
}
