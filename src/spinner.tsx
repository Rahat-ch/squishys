// The spinner: squishys in Claude Code's own spinner line. Some turns, the
// word Claude Code sampled for the turn gives way to a squishy verb
// (src/verbs.ts); otherwise the spinner is Claude Code's own drawing.

import type { On } from 'claude-code'

import { cryptoRandom } from './roller'
import { pickVerb } from './verbs'

/**
 * Each spinner's turn, by spinner id (the engine's `requestId` for the
 * Spinner): the word Claude Code sampled for the turn, and the squishy verb
 * it gave way to, if any. The pick holds through every drawing of the turn;
 * a new word is a new turn. Kept here, since a drawing can't write $.state:
 * a reload only picks again.
 */
const turns = new Map<string, { word: string; verb: string | undefined }>()

/** The squishy verb this spinner's turn shows in place of `word`, picked once per turn; undefined to leave it. */
function verbFor(spinnerId: string, word: string): string | undefined {
  const turn = turns.get(spinnerId)
  if (turn?.word === word) return turn.verb
  const verb = pickVerb(cryptoRandom)
  turns.set(spinnerId, { word, verb })
  return verb
}

export function registerSpinner(on: On): void {
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const verb = verbFor(e.requestId, e.props.word)
    return next(verb === undefined ? e : { ...e, props: { ...e.props, word: verb } })
  })
}
