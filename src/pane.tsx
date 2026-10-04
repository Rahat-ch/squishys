// The pane: one Squishys panel beside the main view. It shows one mode at a
// time (see PaneMode); this file draws the roster, one slot per agent, and
// animates the squishys every mode shows.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { Agent } from '../types'
import { compose } from './composer'
import type { Size } from './composer'
import { KIT } from './kit'
import { halfBlocks } from './raster'
import type { RasterCells } from './raster'
import { moves } from './states'

export const PANE_ID = 'squishys'

/** How long each animation frame shows, in milliseconds. */
export const FRAME_MS = 200

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const reducedMotion = atom({ plugin: 'squishys', key: 'reducedMotion' } as const, false)

// The animator. Its frames repaint the pane's pictures with `$.ui.blit`,
// never a redraw, so they're kept here rather than in $.state: a reload
// only restarts the animation.

/** The frame every animated squishy is on: the timer's ticks so far. */
let frame = 0
/** The animator's timer, while it runs. */
let animator: Timer | undefined
/** Whether a frame's repaints are still going out. */
let painting = false
/**
 * The pictures the animator may repaint, by Raster key: whose squishy each
 * shows, at what size, and the cells it shows now. Each drawing of the pane
 * fills it again, through `animatedPicture`.
 */
const shown = new Map<string, { agentId: string; size: Size; cells: string }>()

/**
 * An agent's squishy in its state's pose at the animation's current frame,
 * for the Raster keyed `key`, which the animator then keeps repainting while
 * the squishy moves. Every mode draws its squishys through this.
 */
export function animatedPicture(agent: Agent, key: string, size: Size = 'full'): RasterCells {
  const picture = pictureOf(agent, size)
  shown.set(key, { agentId: agent.id, size, cells: picture.cells })
  return picture
}

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    await readMotionSetting($)
    // immediate: the orchestrator is usually mid-turn while its agents run,
    // which is exactly when the user wants the pane.
    await $.command.register({ name: 'squishys', description: 'Open or close the squishys pane', immediate: true })
    // A hot reload keeps $.state but drops the animator; drawing the roster
    // again starts it.
    if ((await read($, agents)).some(agent => moves(agent.state))) $.ui.invalidate('ui.render')
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
    // Under Reduce motion every squishy is drawn at rest
    const motionReduced = await read($, reducedMotion)
    if (motionReduced) stopAnimating()
    shown.clear()
    // Each pane mode has its own hook, which draws only in its own mode; the
    // animator moves whichever squishys it drew.
    if ((await read($, mode)) !== 'roster') {
      const drawing = await next(e)
      if (!motionReduced) await animateShown($)
      return drawing
    }
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    // Drawn at the animation's current frame, so a redraw doesn't jump back
    const slots = (await read($, agents)).map(agent => ({ agent, picture: animatedPicture(agent, `picture-${agent.id}`) }))
    if (!motionReduced) await animateShown($)
    return (
      <Box flexDirection="column" rowGap={1}>
        {slots.length === 0 ? (
          <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {slots.map(({ agent, picture }, index) => (
              <Box key={`slot-${agent.id}`} flexDirection="column" alignItems="center">
                <Raster key={`picture-${agent.id}`} {...picture} />
                {/* Its press picks the squishy: src/focus.tsx answers it. */}
                <Button
                  key={`squishy-${agent.id}`}
                  {...(index < 9 ? { hotkey: String(index + 1) } : {})}
                  plain
                  label={agent.squishy.name}
                  onPress={() => {}}
                />
                <Text key={`description-${agent.id}`} dimColor>
                  {agent.description}
                </Text>
                {/* Squishys only reads the main view, never changes it (ADR 0001). */}
                {agent.id === e.props.view.agentId ? (
                  <Box key={`in-view-${agent.id}`}>
                    <Text color="cyan">▲ in main view</Text>
                  </Box>
                ) : null}
              </Box>
            ))}
          </Box>
        )}
        <Button key="settings" hotkey="o" plain dimColor label="Settings" onPress={() => void update($, mode, () => 'settings')} />
      </Box>
    )
  })
}

/** An agent's squishy in its state's pose, at the animation's current frame. */
function pictureOf(agent: Agent, size: Size): RasterCells {
  return halfBlocks(compose(KIT, agent.squishy, { state: agent.state, frame, size }))
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

/** Starts the animator if a squishy just drawn is Working or Thinking. */
async function animateShown($: EngineInterface): Promise<void> {
  const known = await read($, agents)
  const showsMoving = [...shown.values()].some(({ agentId }) => known.some(agent => agent.id === agentId && moves(agent.state)))
  if (showsMoving) animator ??= $.clock.every(FRAME_MS, () => void nextFrame($))
}

function stopAnimating(): void {
  animator?.cancel()
  animator = undefined
  frame = 0
}

/**
 * Moves the animation on a frame, blitting each shown squishy whose
 * picture changed. A tick that comes while the last frame's repaints are
 * still going out is skipped. A squishy whose repaint is refused is left
 * alone until the pane is drawn again. The animation stops once no shown
 * squishy is Working or Thinking, or Reduce motion is on; the next drawing
 * of the pane starts it again.
 */
async function nextFrame($: EngineInterface): Promise<void> {
  if (painting) return
  painting = true
  try {
    const known = await read($, agents)
    const moving = [...shown].flatMap(([key, each]) => {
      const agent = known.find(({ id }) => id === each.agentId)
      return agent !== undefined && moves(agent.state) ? [{ key, agent, ...each }] : []
    })
    if (moving.length === 0 || (await read($, reducedMotion))) return stopAnimating()
    frame += 1
    for (const { key, agent, size, cells } of moving) {
      const picture = pictureOf(agent, size)
      if (cells === picture.cells) continue
      let refused = true
      try {
        refused = (await $.ui.blit({ requestId: PANE_ID, key, ...picture })).deny !== undefined
      } catch {}
      if (refused) shown.delete(key)
      else shown.set(key, { agentId: agent.id, size, cells: picture.cells })
    }
  } finally {
    painting = false
  }
}
