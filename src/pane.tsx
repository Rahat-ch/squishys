// The pane: one Squishys panel beside the main view. For now it shows only
// the roster, one slot per agent.

import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { PLACEHOLDER_SQUISHY } from './placeholder'
import { halfBlocks } from './raster'

export const PANE_ID = 'squishys'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'squishys', description: 'Open or close the squishys pane' })
    return next(e)
  })

  // A toggle. Claude Code's own list of open panes is the truth, since the
  // person can also close the pane themselves (ctrl+x x).
  on('command.run', { command: 'squishys' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE_ID)) await $.ui.close({ id: PANE_ID })
    else await $.ui.open({ id: PANE_ID, title: 'Squishys' })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    // v1 draws only in the terminal; elsewhere Claude Code draws its own.
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const roster = await read($, agents)
    if (roster.length === 0) {
      return <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
    }
    const sprite = halfBlocks(PLACEHOLDER_SQUISHY)
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {roster.map(agent => (
          <Box key={`slot-${agent.id}`} flexDirection="column" alignItems="center">
            <Raster key={`sprite-${agent.id}`} {...sprite} />
            {/* Picking a squishy opens its focus view in a later ticket. */}
            <Button key={`squishy-${agent.id}`} plain label={agent.squishy.name} onPress={() => {}} />
          </Box>
        ))}
      </Box>
    )
  })
}
