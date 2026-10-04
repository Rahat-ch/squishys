// The spinner: squishys in Claude Code's own spinner line. Some turns, the
// word Claude Code sampled for the turn gives way to a squishy verb
// (src/verbs.ts), and the orchestrator's spinner carries the partner's mini
// (src/face.ts) right after the verb, standing on the spinner line.

import { atom, read } from 'claude-code'
import type { EngineInterface, On, RenderPropsOf } from 'claude-code'

import { miniRows } from './face'
import type { MiniRow } from './face'
import { KIT } from './kit'
import { PARTNER_KEY, partnerFrom } from './partner'
import { cryptoRandom } from './roller'
import { textColumns } from './slots'
import { pickVerb } from './verbs'

/** What the Box holding the partner's mini is keyed. */
export const PARTNER_MINI = 'partner-mini'

/**
 * Which row of Claude Code's drawing of the Spinner the spinner line is,
 * counting from 0: its first row is blank, and the tip, when there is one,
 * comes right after the line (as a real session draws it).
 */
export const SPINNER_LINE_ROW = 1

/** The columns of the spinner line before the word: Claude Code's spinner glyph and a space. */
export const GLYPH_COLUMNS = 2

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

/**
 * Room on the spinner line for a mini `columns` wide: the suffix that makes
 * it (Claude Code's ellipsis, then a space and as many blank columns as the
 * mini takes, which Claude Code's stats follow after a space of their own),
 * and the column the mini starts at.
 *
 * Claude Code's drawing of the Spinner is one engine node: the glyph, the
 * word, the suffix, the stats and the tip can't be taken apart, and no Box
 * may clip or size it. So the stats are moved over by the suffix, and the
 * mini is drawn over the blank columns.
 */
function roomForMini({ word, message, suffix }: RenderPropsOf['Spinner'], columns: number) {
  const text = message ?? word
  // Claude Code leaves its ellipsis off a text that already ends in one
  const ellipsis = text.endsWith('…') ? '' : suffix
  return {
    suffix: `${ellipsis} ${' '.repeat(columns)}`,
    left: GLYPH_COLUMNS + textColumns(text) + textColumns(ellipsis) + 1,
  }
}

export function registerSpinner(on: On): void {
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const verb = verbFor(e.requestId, e.props.word)
    const asked = verb === undefined ? e : { ...e, props: { ...e.props, word: verb } }
    // Everything that can fail comes before `next`, so a failure leaves
    // Claude Code's spinner as it draws it, squishy verb and all.
    let mini: MiniRow[]
    try {
      mini = await partnerMini($, e.requestId)
    } catch {
      return next(asked)
    }
    if (mini.length === 0) return next(asked)
    const { Box, Text } = $.ui.resolve(e)
    const room = roomForMini(asked.props, mini[0]?.length ?? 0)
    // The mini stands on the spinner line: its last row is the line's, and
    // the rows above it are the drawing's blank first row and as many more
    // as it needs, so it never covers the tip below the line.
    const above = Math.max(0, mini.length - 1 - SPINNER_LINE_ROW)
    const claudeSpinner = await next({ ...asked, props: { ...asked.props, suffix: room.suffix } })
    return (
      <Box flexDirection="column">
        {Array.from({ length: above }, (_, index) => (
          <Text key={`above-${index}`}> </Text>
        ))}
        {claudeSpinner}
        <Box key={PARTNER_MINI} position="absolute" top={0} left={room.left} flexDirection="column">
          {mini.map((row, index) => (
            <Text key={`mini-row-${index}`}>
              {row.map(({ glyph, color, backgroundColor }) => (
                <Text color={color} backgroundColor={backgroundColor}>
                  {glyph}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

/**
 * The partner's mini for this spinner: none on an agent's spinner (the
 * partner stands for the orchestrator), or while no partner is saved.
 */
async function partnerMini($: EngineInterface, spinnerId: string): Promise<MiniRow[]> {
  if ((await read($, agents)).some(agent => agent.id === spinnerId)) return []
  const partner = partnerFrom(await $.store.get(PARTNER_KEY))
  return partner === undefined ? [] : miniRows(KIT, partner)
}
