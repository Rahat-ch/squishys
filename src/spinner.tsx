// The spinner: squishys in Claude Code's own spinner line. Some turns, the
// word Claude Code sampled for the turn gives way to a squishy verb, and
// the partner's tiny face (src/face.ts) sits beside the spinner.

import type { EngineInterface, On } from 'claude-code'

import type { Squishy } from '../types'
import { tinyFace } from './face'
import type { FaceRow } from './face'
import { KIT } from './kit'
import { PARTNER_KEY, partnerFrom } from './partner'
import { cryptoRandom } from './roller'

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

/** What the Box holding the partner's tiny face is keyed. */
export const PARTNER_FACE = 'partner-face'

/**
 * Each spinner's turn, by its agent id: the word Claude Code sampled for it
 * and the squishy verb it gave way to, if any. The site draws again on every
 * change of mode or message within a turn, and the pick holds through them;
 * a new word is a new turn. Kept here, since a drawing can't write $.state:
 * a reload only picks again.
 */
const turns = new Map<string, { word: string; verb: string | undefined }>()

/** The squishy verb this spinner's turn shows in place of `word`, picked once per turn; undefined to leave it. */
function verbFor(requestId: string, word: string): string | undefined {
  const turn = turns.get(requestId)
  if (turn?.word === word) return turn.verb
  const verb = cryptoRandom() < VERB_ODDS ? SQUISHY_VERBS[Math.floor(cryptoRandom() * SQUISHY_VERBS.length)] : undefined
  turns.set(requestId, { word, verb })
  return verb
}

export function registerSpinner(on: On): void {
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const verb = verbFor(e.requestId, e.props.word)
    const face = faceOf(await savedPartner($))
    const theirs = await next(verb === undefined ? e : { ...e, props: { ...e.props, word: verb } })
    if (face.length === 0) return theirs
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
        {theirs}
      </Box>
    )
  })
}

function faceOf(partner: Squishy | undefined): FaceRow[] {
  return partner === undefined ? [] : tinyFace(KIT, partner)
}

/** The partner the store keeps; undefined for none, or a store that can't be read. */
async function savedPartner($: EngineInterface): Promise<Squishy | undefined> {
  try {
    return partnerFrom(await $.store.get(PARTNER_KEY))
  } catch {
    return undefined
  }
}
