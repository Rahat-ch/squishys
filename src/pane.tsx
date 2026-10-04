// The pane: one Squishys panel beside the main view. It shows one mode at a
// time (see PaneMode); this file draws the roster, one slot per agent, and
// animates the squishys in it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { SquishyState } from '../types'
import { compose } from './composer'
import { KIT } from './kit'
import { halfBlocks } from './raster'

export const PANE_ID = 'squishys'

/** How long each animation frame shows, in milliseconds. */
export const FRAME_MS = 200

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const reducedMotion = atom({ plugin: 'squishys', key: 'reducedMotion' } as const, false)

// The animator. Its frames repaint the roster's pictures with `$.ui.blit`,
// never a redraw, so they're kept here rather than in $.state: a reload
// only restarts the animation.

/** The frame every animated squishy is on: the timer's ticks so far. */
let frame = 0
/** The animator's timer, while it runs. */
let animator: Timer | undefined
/** The cells each slot's picture shows now, by agent id: the pictures the animator may repaint. */
const shown = new Map<string, string>()

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    await readMotionSetting($)
    // immediate: the orchestrator is usually mid-turn while its agents run,
    // which is exactly when the user wants the pane.
    await $.command.register({ name: 'squishys', description: 'Open or close the squishys pane', immediate: true })
    return next(e)
  })

  // The user can turn Reduce motion on or off in /config at any time.
  on('config.set', async ($, e, next) => {
    const changed = await next(e)
    await readMotionSetting($)
    return changed
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
    if (e.surface !== 'terminal') return next(e)
    // Each pane mode has its own hook, which draws only in its own mode.
    if ((await read($, mode)) !== 'roster') {
      shown.clear()
      return next(e)
    }
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const still = await read($, reducedMotion)
    if (still) stopAnimating()
    // Drawn at the animation's current frame, so a redraw doesn't jump back
    const slots = (await read($, agents)).map(agent => ({
      agent,
      picture: halfBlocks(compose(KIT, agent.squishy, { state: agent.state, frame })),
    }))
    shown.clear()
    for (const { agent, picture } of slots) shown.set(agent.id, picture.cells)
    if (!still && slots.some(({ agent }) => moves(agent.state))) startAnimating($)
    return (
      <Box flexDirection="column" rowGap={1}>
        {slots.length === 0 ? (
          <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {slots.map(({ agent, picture }) => (
              <Box key={`slot-${agent.id}`} flexDirection="column" alignItems="center">
                <Raster key={`picture-${agent.id}`} {...picture} />
                {/* Picking a squishy opens its focus view in a later ticket. */}
                <Button key={`squishy-${agent.id}`} plain label={agent.squishy.name} onPress={() => {}} />
                <Text key={`description-${agent.id}`} dimColor>
                  {agent.description}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Button key="settings" hotkey="o" plain dimColor label="Settings" onPress={() => void update($, mode, () => 'settings')} />
      </Box>
    )
  })
}

/** Whether a squishy in this state animates. */
function moves(state: SquishyState): boolean {
  return state === 'working' || state === 'thinking'
}

/** Keeps `reducedMotion` in step with Claude Code's `prefersReducedMotion` setting. */
async function readMotionSetting($: EngineInterface): Promise<void> {
  let reduced: boolean
  try {
    reduced = (await $.settings.read()).prefersReducedMotion === true
  } catch {
    return // settings that can't be read leave things as they were
  }
  if ((await read($, reducedMotion)) !== reduced) await update($, reducedMotion, () => reduced)
}

function startAnimating($: EngineInterface): void {
  animator ??= $.clock.every(FRAME_MS, () => void nextFrame($))
}

function stopAnimating(): void {
  animator?.cancel()
  animator = undefined
  frame = 0
}

/**
 * Moves the animation on a frame, blitting each shown squishy whose
 * picture changed. It stops once no shown squishy is Working or Thinking,
 * Reduce motion is on, or the roster isn't on screen; the next drawing of
 * the roster starts it again.
 */
async function nextFrame($: EngineInterface): Promise<void> {
  const moving = (await read($, agents)).filter(agent => shown.has(agent.id) && moves(agent.state))
  if (moving.length === 0 || (await read($, reducedMotion))) return stopAnimating()
  frame += 1
  for (const agent of moving) {
    const picture = halfBlocks(compose(KIT, agent.squishy, { state: agent.state, frame }))
    if (shown.get(agent.id) === picture.cells) continue
    let refused = true
    try {
      refused = (await $.ui.blit({ requestId: PANE_ID, key: `picture-${agent.id}`, ...picture })).deny !== undefined
    } catch {}
    if (refused) return stopAnimating()
    shown.set(agent.id, picture.cells)
  }
}
