// The spinner: squishys in Claude Code's own spinner line. Some turns, the
// word Claude Code sampled for the turn gives way to a squishy verb
// (src/verbs.ts), and the orchestrator's spinner carries the partner's tiny
// face (src/face.ts) beside it.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { tinyFace } from './face'
import { KIT } from './kit'
import { PARTNER_KEY, partnerFrom } from './partner'
import { cryptoRandom } from './roller'
import { pickVerb } from './verbs'

/** What the Box holding the partner's tiny face is keyed. */
export const PARTNER_FACE = 'partner-face'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

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
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const verb = verbFor(e.requestId, e.props.word)
    const claudeSpinner = await next(verb === undefined ? e : { ...e, props: { ...e.props, word: verb } })
    // The face is the orchestrator's: an agent's spinner goes without. Any
    // failure here leaves Claude Code's spinner as it drew it.
    try {
      if ((await read($, agents)).some(agent => agent.id === e.requestId)) return claudeSpinner
      const partner = await savedPartner($)
      const face = partner === undefined ? [] : tinyFace(KIT, partner)
      if (face.length === 0) return claudeSpinner
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" columnGap={1}>
          <Box key={PARTNER_FACE} flexDirection="column">
            {face.map((row, index) => (
              <Text key={`face-row-${index}`}>
                {row.map(({ glyph, color, backgroundColor }) => (
                  <Text color={color} backgroundColor={backgroundColor}>
                    {glyph}
                  </Text>
                ))}
              </Text>
            ))}
          </Box>
          {claudeSpinner}
        </Box>
      )
    } catch {
      return claudeSpinner
    }
  })
}

/** The partner the store keeps; undefined for none. */
async function savedPartner($: EngineInterface) {
  return partnerFrom(await $.store.get(PARTNER_KEY))
}
