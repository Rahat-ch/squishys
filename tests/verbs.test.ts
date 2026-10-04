import { expect, test } from 'claude-code/testing'

import { seeded } from '../src/seeded'
import { SQUISHY_VERBS, VERB_ODDS, pickVerb } from '../src/verbs'

test('odds of 1 always pick a squishy verb, and odds of 0 never do', () => {
  const always = seeded(1)
  const never = seeded(2)
  for (let turn = 0; turn < 100; turn += 1) {
    expect(SQUISHY_VERBS).toContain(pickVerb(always, 1))
    expect(pickVerb(never, 0)).toBeUndefined()
  }
})

// Seeded, so each run sees the same numbers; the tolerance is still wide
// enough for any seed
test('about one turn in three gets a squishy verb, and every verb turns up', () => {
  const rng = seeded(3)
  const picks = Array.from({ length: 30_000 }, () => pickVerb(rng))
  const verbs = picks.filter(verb => verb !== undefined)

  expect(Math.abs(verbs.length / picks.length - 1 / 3)).toBeLessThan(0.02)
  expect(VERB_ODDS).toBe(1 / 3)
  expect(new Set(verbs)).toEqual(new Set(SQUISHY_VERBS))
})
