// The opening and the band: the first spawn asks Claude Code to open the
// pane, and while that pane waits unplaced (an unasked pane needs a wide
// terminal), the band above the prompt shows mini squishys instead, with
// the overflow count and a hint for opening the pane.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Agent } from '../types'
import { PICTURE_SIZE } from './composer'
import { OPEN_PANE, PANE_ID, PICK_PREFIX, animatedPicture, pictureKey } from './pane'
import { isEnded } from './states'

/** A mini squishy's picture in the band, in cells: half the full picture, two pixels down a cell. */
export const MINI_COLUMNS = Math.floor(PICTURE_SIZE / 2)
export const MINI_ROWS = Math.ceil(MINI_COLUMNS / 2)
/** The most of a squishy's Name the band shows under its mini. */
export const BAND_NAME_COLUMNS = 10
/** A mini squishy's place in the band: its picture over its Name. */
export const BAND_SLOT_COLUMNS = Math.max(MINI_COLUMNS, BAND_NAME_COLUMNS)
/** The rows the band needs to show its minis; with fewer it shows the Names alone. */
export const BAND_PICTURE_ROWS = MINI_ROWS + 1
/** The columns between the band's squishys, and before the hint. */
export const BAND_GAP = 1
/** What the band says about opening the pane. */
export const OPEN_HINT = 'Run /squishys to open the pane'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

export function registerBand(on: On): void {
  // The spawn of a session's first agent opens the pane, unasked: Claude
  // Code seats it only on a wide terminal. A session with agents already
  // (after a hot reload or /resume) opens nothing. The tracker's agent.spawn
  // hook is the unmatched one; this matcher fits every spawn.
  on('agent.spawn', { fork: [true, false] }, async ($, e, next) => {
    const first = (await read($, agents)).length === 0
    const started = await next(e)
    if (first && started.agentId !== undefined) {
      try {
        await $.ui.open(OPEN_PANE)
      } catch {} // a refused open leaves the agent its squishy all the same
    }
    return started
  })

  // The band, while the pane waits unplaced. Its Buttons pick a squishy by
  // click alone: they carry no hotkeys, since a digit typed into an empty
  // prompt would press one and swallow the first keystroke of a message.
  // Their presses are keyed for the pick in src/focus.tsx, which opens the
  // pane, and the pane's hook animates the minis drawn here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const known = await read($, agents)
    if (known.length === 0 || !(await paneWaits($))) return next(e)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const { bodyColumns, maxRows } = e.props
    const pictured = maxRows >= BAND_PICTURE_ROWS
    const across = Math.max(0, Math.floor((bodyColumns - OPEN_HINT.length) / (BAND_SLOT_COLUMNS + BAND_GAP)))
    const shown = inBand(known).slice(0, across)
    const overflow = known.length - shown.length
    return (
      <Box flexDirection="row" columnGap={BAND_GAP}>
        {shown.map(agent => (
          <Box key={`band-${agent.id}`} flexDirection="column" alignItems="center" width={BAND_SLOT_COLUMNS}>
            {pictured ? <Raster key={pictureKey(agent.id, 'mini')} {...animatedPicture(agent, 'mini', e.requestId)} /> : null}
            <Button key={`${PICK_PREFIX}${agent.id}`} plain label={cut(agent.squishy.name, BAND_NAME_COLUMNS)} onPress={() => {}} />
          </Box>
        ))}
        <Box key="band-hint" flexDirection={pictured ? 'column' : 'row'} columnGap={BAND_GAP}>
          {overflow > 0 ? <Text>{`+${overflow}`}</Text> : null}
          <Text dimColor wrap="truncate-end">
            {OPEN_HINT}
          </Text>
        </Box>
      </Box>
    )
  })
}

/** Whether the pane is open but waits unplaced, as an unasked open on a narrow terminal does. */
async function paneWaits($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE_ID && !pane.isPlaced)
  } catch {
    return false
  }
}

/**
 * The agents in the order the band shows them: running ones first, then
 * ended ones, each in the order they were first seen, never a second
 * picture of one squishy.
 */
function inBand(known: readonly Agent[]): Agent[] {
  const ordered = [...known.filter(agent => !isEnded(agent.state)), ...known.filter(agent => isEnded(agent.state))]
  return ordered.filter((agent, index) => ordered.findIndex(each => each.squishy.key === agent.squishy.key) === index)
}

/** A Name cut to `columns`, ending in … when it's longer. */
function cut(name: string, columns: number): string {
  return name.length > columns ? `${name.slice(0, columns - 1)}…` : name
}
