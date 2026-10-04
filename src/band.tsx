// The band: while the pane is open but unplaced (opened unasked on a narrow
// terminal; the agent tracker opens it at the first agent), the band above
// the prompt shows mini squishys instead, with the overflow count and a
// hint for opening the pane. Which squishys show is layoutBand in slots.ts.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { PANE_ID, PICK_PREFIX, SLOT_HOVER, animatedPicture, pictureKey } from './pane'
import { BAND_GAP, layoutBand, nameCut } from './slots'

/** What the band says about opening the pane. */
export const OPEN_HINT = 'Run /squishys to open the pane'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

export function registerBand(on: On): void {
  // Its Buttons pick a squishy by click alone: they carry no hotkeys, since
  // a digit typed into an empty prompt would press one and swallow the first
  // keystroke of a message. Their presses are keyed for the pick in
  // src/focus.tsx, which opens the pane, and the pane's hook animates the
  // minis drawn here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const known = await read($, agents)
    if (known.length === 0 || !(await paneUnplaced($))) return next(e)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const { bodyColumns, maxRows } = e.props
    const band = layoutBand({ agents: known, bodyColumns, maxRows, hintColumns: OPEN_HINT.length })
    return (
      <Box flexDirection="row" columnGap={BAND_GAP}>
        {band.shown.map(agent => (
          <Box key={`band-${agent.id}`} flexDirection="column" alignItems="center" width={band.placeColumns} hover={SLOT_HOVER}>
            {band.pictured ? <Raster key={pictureKey(agent.id, 'mini')} {...animatedPicture(agent, 'mini', e.requestId)} /> : null}
            <Button key={`${PICK_PREFIX}${agent.id}`} plain label={nameCut(agent.squishy.name)} onPress={() => {}} />
          </Box>
        ))}
        <Box key="band-hint" flexDirection={band.pictured ? 'column' : 'row'} columnGap={BAND_GAP}>
          {band.overflow.length > 0 ? <Text>{`+${band.overflow.length}`}</Text> : null}
          <Text dimColor wrap="truncate-end">
            {OPEN_HINT}
          </Text>
        </Box>
      </Box>
    )
  })
}

/** Whether the pane is open but unplaced, as an unasked open on a narrow terminal leaves it. */
async function paneUnplaced($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE_ID && !pane.isPlaced)
  } catch {
    return false
  }
}

