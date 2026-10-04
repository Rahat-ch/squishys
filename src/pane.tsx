// The pane: one Squishys panel beside the main view. It shows one mode at a
// time (see PaneMode); this file draws the roster, one slot per agent.

import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { PLACEHOLDER_SQUISHY } from './placeholder'
import { halfBlocks } from './raster'

export const PANE_ID = 'squishys'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    // immediate: the orchestrator is usually mid-turn while its agents run,
    // which is exactly when the user wants the pane.
    await $.command.register({ name: 'squishys', description: 'Open or close the squishys pane', immediate: true })
    return next(e)
  })

  // A toggle. Claude Code's own list of open panes is the truth, since the
  // user can also close the pane themselves (ctrl+x x).
  on('command.run', { command: 'squishys' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE_ID)) await $.ui.close({ id: PANE_ID })
    else await $.ui.open({ id: PANE_ID, title: 'Squishys' })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    // v1 draws only in the terminal; elsewhere Claude Code draws its own.
    // Each pane mode has its own hook, which draws only in its own mode.
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'roster') return next(e)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const seen = await read($, agents)
    const picture = halfBlocks(PLACEHOLDER_SQUISHY)
    return (
      <Box flexDirection="column" rowGap={1}>
        {seen.length === 0 ? (
          <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {seen.map(agent => (
              <Box key={`slot-${agent.id}`} flexDirection="column" alignItems="center">
                <Raster key={`picture-${agent.id}`} {...picture} />
                {/* Picking a squishy opens its focus view in a later ticket. */}
                <Button key={`squishy-${agent.id}`} plain label={agent.squishy.name} onPress={() => {}} />
              </Box>
            ))}
          </Box>
        )}
        <Button key="settings" hotkey="o" plain dimColor label="Settings" onPress={() => void update($, mode, () => 'settings')} />
      </Box>
    )
  })
}
