// The pane: one Squishys panel beside the main view. It shows one mode at a
// time (see PaneMode); this file draws the roster, as many slots as fit
// with the overflow as "+N" (see slots.ts), and animates the squishys every
// mode shows.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { Agent } from '../types'
import { compose } from './composer'
import type { Size } from './composer'
import { KIT } from './kit'
import { halfBlocks } from './raster'
import type { RasterCells } from './raster'
import { SETTINGS_KEY, settingsFrom } from './settings'
import { FOOTER_COLUMNS, SLOT_COLUMN_GAP, SLOT_COLUMNS, SLOT_ROWS, SLOT_ROW_GAP, layoutRoster } from './slots'
import { moves } from './states'

export const PANE_ID = 'squishys'

/**
 * What a Button that picks a squishy is keyed: this, then its agent's id.
 * src/focus.tsx answers a press on any pane Button keyed so (the pick).
 */
export const PICK_PREFIX = 'squishy-'

/** How long each animation frame shows, in milliseconds. */
export const FRAME_MS = 200

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const reducedMotion = atom({ plugin: 'squishys', key: 'reducedMotion' } as const, false)
const overflowOpen = atom({ plugin: 'squishys', key: 'overflowOpen' } as const, false)

/**
 * The agents the roster's slots showed when it was last drawn, by id in
 * slot order: where each keeps its slot on the next drawing. Undefined
 * until the roster is first drawn. A reload only lays the slots out afresh.
 */
let slotted: string[] | undefined

/** The agents in the roster's slots as last drawn; undefined before the first drawing. */
export function rosterSlots(): readonly string[] | undefined {
  return slotted
}

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

/** The key of the Raster showing an agent's squishy at this size. */
export function pictureKey(agentId: string, size: Size = 'full'): string {
  return size === 'full' ? `picture-${agentId}` : `${size}-picture-${agentId}`
}

/**
 * An agent's squishy in its state's pose at the animation's current frame,
 * for the Raster keyed `pictureKey(agent.id, size)`, which the animator then
 * keeps repainting while the squishy moves. Every mode draws its squishys
 * through this.
 */
export function animatedPicture(agent: Agent, size: Size = 'full'): RasterCells {
  const picture = pictureOf(agent, size)
  shown.set(pictureKey(agent.id, size), { agentId: agent.id, size, cells: picture.cells })
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
    // Inline, rows are scarce: ask for one row of slots
    else await $.ui.open({ id: PANE_ID, title: 'Squishys', rows: SLOT_ROWS })
    return {}
  })

  // Picking a squishy from the overflow list closes the list; src/focus.tsx
  // answers the same press with the agent's focus view.
  on('ui.press', { plugin: 'squishys', element: /^squishy-/ }, async ($, e, next) => {
    if (await read($, overflowOpen)) await update($, overflowOpen, () => false)
    return next(e)
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
    const { placement, bodyColumns, scroll, view } = e.props
    const known = await read($, agents)
    const layout = layoutRoster({ placement, bodyColumns, bodyRows: scroll.bodyRows, slotCap: await readSlotCap($), agents: known, slotted })
    slotted = layout.slots.map(agent => agent.id)
    const open = await read($, overflowOpen)
    // A list left open when the overflow emptied closes. A drawing can't
    // write $.state, so the write goes out just after it.
    if (open && layout.overflow.length === 0) $.clock.after(0, () => void closeOverflow($))
    const listing = open && layout.overflow.length > 0
    // Drawn at the animation's current frame, so a redraw doesn't jump
    // back. Only the slots' pictures are drawn, so only they animate.
    const slots = listing ? [] : layout.slots.map(agent => ({ agent, picture: animatedPicture(agent) }))
    if (!motionReduced) await animateShown($)

    const columns = Math.max(1, layout.columns)
    const rows = Array.from({ length: Math.ceil(slots.length / columns) }, (_, row) => slots.slice(row * columns, (row + 1) * columns))
    const body = listing ? (
      // The overflow list: one line per agent, in place of the slots. Its
      // presses pick the squishy, as a slot's do: src/focus.tsx answers them.
      <Box key="overflow-list" flexDirection="column">
        {layout.overflow.map(agent => (
          <Box key={`overflow-${agent.id}`} flexDirection="row" columnGap={1}>
            <Button key={`${PICK_PREFIX}${agent.id}`} plain label={agent.squishy.name} onPress={() => {}} />
            <Text dimColor wrap="truncate-end">
              {agent.description}
            </Text>
          </Box>
        ))}
      </Box>
    ) : known.length === 0 ? (
      <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
    ) : (
      <Box key="slots" flexDirection="column" rowGap={SLOT_ROW_GAP}>
        {rows.map((row, rowIndex) => (
          <Box key={`slot-row-${rowIndex}`} flexDirection="row" columnGap={SLOT_COLUMN_GAP}>
            {row.map(({ agent, picture }, column) => {
              const index = rowIndex * columns + column
              return (
                <Box key={`slot-${agent.id}`} flexDirection="column" alignItems="center" width={SLOT_COLUMNS}>
                  <Raster key={pictureKey(agent.id)} {...picture} />
                  {/* Its press picks the squishy: src/focus.tsx answers it. */}
                  <Button
                    key={`${PICK_PREFIX}${agent.id}`}
                    {...(index < 9 ? { hotkey: String(index + 1) } : {})}
                    plain
                    label={agent.squishy.name}
                    onPress={() => {}}
                  />
                  <Text key={`description-${agent.id}`} dimColor wrap="truncate-end">
                    {agent.description}
                  </Text>
                  {/* Squishys only reads the main view, never changes it (ADR 0001). */}
                  {agent.id === view.agentId ? (
                    <Box key={`in-view-${agent.id}`}>
                      <Text color="cyan">▲ in main view</Text>
                    </Box>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
    const footer = [
      ...(layout.overflow.length > 0
        ? [<Button key="overflow" hotkey="m" plain label={`+${layout.overflow.length}`} onPress={() => void update($, overflowOpen, was => !was)} />]
        : []),
      <Button key="settings" hotkey="o" plain dimColor label="Settings" onPress={() => void update($, mode, () => 'settings')} />,
    ]
    // Docked, the footer goes under the slots; inline, where rows are
    // scarce, beside them
    return placement === 'inline' ? (
      <Box flexDirection="row" columnGap={SLOT_COLUMN_GAP}>
        <Box flexDirection="column" flexGrow={1}>
          {body}
        </Box>
        <Box key="footer" flexDirection="column" width={FOOTER_COLUMNS}>
          {footer}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column" rowGap={1}>
        {body}
        <Box key="footer" flexDirection="row" columnGap={2}>
          {footer}
        </Box>
      </Box>
    )
  })
}

async function closeOverflow($: EngineInterface): Promise<void> {
  if (await read($, overflowOpen)) await update($, overflowOpen, () => false)
}

/** The slot cap from settings; a store that can't be read leaves the most. */
async function readSlotCap($: EngineInterface): Promise<number> {
  try {
    return settingsFrom(await $.store.get(SETTINGS_KEY)).slotCap
  } catch {
    return settingsFrom(undefined).slotCap
  }
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
  if (movingPictures(await read($, agents)).length > 0) animator ??= $.clock.every(FRAME_MS, () => void nextFrame($))
}

/** The shown pictures whose squishy is Working or Thinking, each with its agent. */
function movingPictures(known: readonly Agent[]) {
  return [...shown].flatMap(([key, each]) => {
    const agent = known.find(({ id }) => id === each.agentId)
    return agent !== undefined && moves(agent.state) ? [{ key, agent, ...each }] : []
  })
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
    const moving = movingPictures(await read($, agents))
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
