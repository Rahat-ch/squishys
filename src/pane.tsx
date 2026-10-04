// The pane: one Squishys panel beside the main view. It shows one mode at a
// time (see PaneMode); this file draws the roster, as many slots as fit
// with the overflow as "+N" (see slots.ts), and animates the squishys every
// mode, and the band (see band.tsx), shows.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { Agent, Squishy } from '../types'
import { compose } from './composer'
import type { Size } from './composer'
import { KIT } from './kit'
import { isSparkling } from './moments'
import { PARTNER_BUTTON, PARTNER_KEY, PARTNER_PICTURE, partnerFrom, stillPicture } from './partner'
import { halfBlocks } from './raster'
import type { RasterCells } from './raster'
import { SETTINGS_KEY, settingsFrom } from './settings'
import {
  FOOTER_BUTTON_GAP,
  FOOTER_COLUMN_GAP,
  FOOTER_COLUMNS,
  FOOTER_ROW_GAP,
  OVERFLOW_HOTKEY,
  SETTINGS_BUTTON,
  SQUISHYDEX_BUTTON,
  SLOT_COLUMN_GAP,
  SLOT_COLUMNS,
  SLOT_ROWS,
  SLOT_ROW_GAP,
  buttonColumns,
  layoutRoster,
  linedUp,
} from './slots'
import { moves } from './states'

export const PANE_ID = 'squishys'

/**
 * What a Button that picks a squishy is keyed: this, then its agent's id.
 * src/focus.tsx answers a press on any pane Button keyed so (the pick).
 */
export const PICK_PREFIX = 'squishy-'

/**
 * How the pane is opened, by the user's /squishys, a pick from the band or
 * the first spawn. Inline, rows are scarce: it asks for one row of slots.
 */
export const OPEN_PANE = { id: PANE_ID, title: 'Squishys', rows: SLOT_ROWS } as const

/** The toast for an open the user asked for that a `ui.open` hook refused. */
export function openRefused(error: unknown): string {
  return `Squishys couldn't open its pane: ${error instanceof Error ? error.message : String(error)}`
}

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

/**
 * Whether the overflow emptied while its list was asked for: the list
 * stays shut then, even once the overflow fills again, until it's asked
 * for anew. Kept here, since a drawing can't write $.state.
 */
let listOutlived = false

/**
 * The agents whose squishys are on screen, or will be again when the
 * roster comes back: those in the roster's slots as last drawn and any
 * other the pane last drew (the focus view's). Undefined before the
 * roster is first drawn.
 */
export function squishysOnScreen(): readonly string[] | undefined {
  if (slotted === undefined) return undefined
  return [...new Set([...slotted, ...[...shown.values()].map(picture => picture.agentId)])]
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
 * shows, at what size, in which site (the pane or the band, by requestId),
 * and the cells it shows now. Each drawing of a site fills it again for
 * that site, through `animatedPicture`.
 */
const shown = new Map<string, { agentId: string; size: Size; requestId: string; cells: string }>()

/** The key of the Raster showing an agent's squishy at this size. */
export function pictureKey(agentId: string, size: Size = 'full'): string {
  return size === 'full' ? `picture-${agentId}` : `${size}-picture-${agentId}`
}

/**
 * An agent's squishy in its state's pose at the animation's current frame,
 * for the Raster keyed `pictureKey(agent.id, size)` in the site `requestId`
 * (the pane unless said), which the animator then keeps repainting while
 * the squishy moves. Every mode, and the band, draws its squishys through this.
 */
export function animatedPicture(agent: Agent, size: Size = 'full', requestId: string = PANE_ID): RasterCells {
  const picture = pictureOf(agent, size)
  shown.set(pictureKey(agent.id, size), { agentId: agent.id, size, requestId, cells: picture.cells })
  return picture
}

/**
 * The agents whose squishys sparkle now (src/moments.ts), as last worked
 * out: as a site is drawn, and at each frame. None under Reduce motion.
 */
let sparkling: ReadonlySet<string> = new Set()

/**
 * Works out which squishys sparkle now. The clock is read only while some
 * agent has had a sparkle; one that can't be read stops every sparkle.
 */
async function noteSparkles($: EngineInterface, known: readonly Agent[], motionReduced: boolean): Promise<void> {
  if (motionReduced || !known.some(agent => agent.sparkleUntil !== undefined)) {
    sparkling = new Set()
    return
  }
  try {
    const now = await $.clock.now()
    sparkling = new Set(known.filter(agent => isSparkling(agent.sparkleUntil, now)).map(agent => agent.id))
  } catch {
    sparkling = new Set()
  }
}

/** Forgets the pictures a site showed, as it's drawn again. */
function forgetShown(requestId: string): void {
  for (const [key, picture] of shown) if (picture.requestId === requestId) shown.delete(key)
}

/** One slot of the roster as drawn: the partner's or an agent's. */
type Slot = {
  /** The agent's id, or `partner`. */
  id: string
  pictureKey: string
  /** The key of the Button that picks it. */
  pickKey: string
  picture: RasterCells
  name: string
  description: string
  /** Whether the main view shows the agent (or, for the partner, the orchestrator). */
  inView: boolean
}

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    await readMotionSetting($)
    // immediate: the orchestrator is usually mid-turn while its agents run,
    // which is exactly when the user wants the pane.
    await $.command.register({ name: 'squishys', description: 'Open or close the squishys pane', immediate: true })
    // and so is /squishydex, which src/squishydex.tsx answers
    await $.command.register({ name: 'squishydex', description: 'Open the Squishydex: every squishy you have met', immediate: true })
    // A hot reload keeps $.state but drops the animator and forgets which
    // squishys sparkle; drawing the roster again works that out from the
    // agents' `sparkleUntil` and starts it.
    if ((await read($, agents)).some(agent => moves(agent.state) || agent.sparkleUntil !== undefined)) $.ui.invalidate('ui.render')
    // and starts with the overflow list shut
    await closeOverflowList($)
    return next(e)
  })

  // The user can turn Reduce motion on or off in /config at any time.
  on('config.set', async ($, e, next) => {
    const changed = await next(e)
    await readMotionSetting($)
    return changed
  })

  // A toggle. Claude Code's own list of open panes is the truth, since the
  // user can also close the pane themselves (ctrl+x x). An unplaced pane
  // (opened unasked on a narrow terminal) is opened: asked for, it's placed
  // at any width, and the band (src/band.tsx) is drawn again to step aside.
  on('command.run', { command: 'squishys' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE_ID && pane.isPlaced)) await $.ui.close({ id: PANE_ID })
    else {
      try {
        await $.ui.open(OPEN_PANE)
      } catch (error) {
        $.ui.toast(openRefused(error))
      }
      $.ui.invalidate('ui.render')
    }
    return {}
  })

  // Any press in the pane but the overflow count's own shuts the overflow
  // list: a pick from it (src/focus.tsx answers that same press, nested
  // inside this hook), Settings, or anything else. It picks nothing itself.
  on('ui.press', { plugin: 'squishys' }, async ($, e, next) => {
    if (e.element !== 'overflow') await closeOverflowList($)
    return next(e)
  })

  // The band (src/band.tsx) draws its mini squishys inside this hook, which
  // animates them as the pane's own.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const motionReduced = await read($, reducedMotion)
    forgetShown(e.requestId)
    await noteSparkles($, await read($, agents), motionReduced)
    const drawing = await next(e)
    if (motionReduced) stopAnimating()
    else await animateShown($)
    return drawing
  })

  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    // v1 draws only in the terminal; elsewhere Claude Code draws its own.
    if (e.surface !== 'terminal') return next(e)
    // Under Reduce motion every squishy is drawn at rest
    const motionReduced = await read($, reducedMotion)
    if (motionReduced) stopAnimating()
    forgetShown(PANE_ID)
    await noteSparkles($, await read($, agents), motionReduced)
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
    const partner = await readPartner($)
    const layout = layoutRoster({
      placement,
      bodyColumns,
      bodyRows: scroll.bodyRows,
      slotCap: await readSlotCap($),
      agents: known,
      slotted,
      ...(partner !== undefined ? { partner } : {}),
    })
    slotted = layout.slots.map(agent => agent.id)
    // The list shows while asked for, until the overflow empties
    if (layout.overflow.length === 0) listOutlived ||= await read($, overflowOpen)
    const showsList = layout.overflow.length > 0 && !listOutlived && (await read($, overflowOpen))
    // Drawn at the animation's current frame, so a redraw doesn't jump
    // back. Only the slots' pictures are drawn, so only they animate. The
    // partner, pinned first, stands for the orchestrator: its picture is
    // still, its pick (src/focus.tsx leaves it be) returns to the roster,
    // and it's marked while the main view shows the orchestrator.
    const slots: Slot[] = showsList
      ? []
      : [
          ...(partner !== undefined && layout.partnerSlot
            ? [
                {
                  id: 'partner',
                  pictureKey: PARTNER_PICTURE,
                  pickKey: PARTNER_BUTTON,
                  picture: stillPicture(partner),
                  name: partner.name,
                  description: 'Orchestrator',
                  inView: view.agentId === undefined,
                },
              ]
            : []),
          ...layout.slots.map(agent => ({
            id: agent.id,
            pictureKey: pictureKey(agent.id),
            pickKey: `${PICK_PREFIX}${agent.id}`,
            picture: animatedPicture(agent),
            name: agent.squishy.name,
            description: agent.description,
            inView: agent.id === view.agentId,
          })),
        ]
    if (!motionReduced) await animateShown($)

    const columns = Math.max(1, layout.columns)
    const rows = Array.from({ length: Math.ceil(slots.length / columns) }, (_, row) => slots.slice(row * columns, (row + 1) * columns))
    const noAgents = <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
    const body = showsList ? (
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
    ) : known.length === 0 && slots.length === 0 ? (
      noAgents
    ) : (
      <Box key="slots" flexDirection="column" rowGap={SLOT_ROW_GAP}>
        {rows.map((row, rowIndex) => (
          <Box key={`slot-row-${rowIndex}`} flexDirection="row" columnGap={SLOT_COLUMN_GAP}>
            {row.map((slot, column) => {
              const index = rowIndex * columns + column
              return (
                <Box key={`slot-${slot.id}`} flexDirection="column" alignItems="center" width={SLOT_COLUMNS}>
                  <Raster key={slot.pictureKey} {...slot.picture} />
                  {/* An agent's press picks its squishy: src/focus.tsx answers it. The partner's leaves the roster be. */}
                  <Button
                    key={slot.pickKey}
                    {...(index < 9 ? { hotkey: String(index + 1) } : {})}
                    plain
                    label={slot.name}
                    onPress={() => {}}
                  />
                  <Text key={`description-${slot.id}`} dimColor wrap="truncate-end">
                    {slot.description}
                  </Text>
                  {/* Squishys only reads the main view, never changes it (ADR 0001). */}
                  {slot.inView ? (
                    <Box key={`in-view-${slot.id}`}>
                      <Text color="cyan">▲ in main view</Text>
                    </Box>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        ))}
        {known.length === 0 ? noAgents : null}
      </Box>
    )
    const overflowLabel = `+${layout.overflow.length}`
    const footer = [
      ...(layout.overflow.length > 0
        ? [
            {
              columns: buttonColumns(overflowLabel, OVERFLOW_HOTKEY),
              button: <Button key="overflow" hotkey={OVERFLOW_HOTKEY} plain label={overflowLabel} onPress={() => void showOverflowList($, !showsList)} />,
            },
          ]
        : []),
      {
        columns: buttonColumns(SETTINGS_BUTTON.label, SETTINGS_BUTTON.hotkey),
        button: <Button key="settings" {...SETTINGS_BUTTON} plain dimColor onPress={() => void update($, mode, () => 'settings')} />,
      },
      {
        columns: buttonColumns(SQUISHYDEX_BUTTON.label, SQUISHYDEX_BUTTON.hotkey),
        // src/squishydex.tsx answers its press
        button: <Button key="squishydex" {...SQUISHYDEX_BUTTON} plain dimColor onPress={() => {}} />,
      },
    ]
    // Docked, the footer goes under the slots; inline, where rows are
    // scarce, beside them
    return placement === 'inline' ? (
      <Box flexDirection="row" columnGap={FOOTER_COLUMN_GAP}>
        <Box flexDirection="column" flexGrow={1}>
          {body}
        </Box>
        <Box key="footer" flexDirection="column" width={FOOTER_COLUMNS}>
          {footer.map(each => each.button)}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column" rowGap={FOOTER_ROW_GAP}>
        {body}
        {/* As many buttons to a row as fit, so a narrow pane's footer takes more rows (slots.ts budgets them) */}
        <Box key="footer" flexDirection="column">
          {linedUp(
            footer.map(each => each.columns),
            bodyColumns,
            FOOTER_BUTTON_GAP,
          ).map((line, index) => (
            <Box key={`footer-row-${index}`} flexDirection="row" columnGap={FOOTER_BUTTON_GAP}>
              {line.map(at => footer[at]?.button)}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

/** Asks for the overflow list, or shuts it. */
async function showOverflowList($: EngineInterface, show: boolean): Promise<void> {
  const outlived = listOutlived
  listOutlived = false
  if ((await read($, overflowOpen)) !== show) await update($, overflowOpen, () => show)
  // A list asked for again while still marked open writes nothing to redraw
  else if (outlived && show) $.ui.invalidate('ui.render')
}

async function closeOverflowList($: EngineInterface): Promise<void> {
  await showOverflowList($, false)
}

/** The slot cap from settings; a store that can't be read leaves the most. */
async function readSlotCap($: EngineInterface): Promise<number> {
  try {
    return settingsFrom(await $.store.get(SETTINGS_KEY)).slotCap
  } catch {
    return settingsFrom(undefined).slotCap
  }
}

/** The partner from the store; a store that can't be read leaves none. */
async function readPartner($: EngineInterface): Promise<Squishy | undefined> {
  try {
    return partnerFrom(await $.store.get(PARTNER_KEY))
  } catch {
    return undefined
  }
}

/** An agent's squishy in its state's pose, at the animation's current frame, sparkling while it does. */
function pictureOf(agent: Agent, size: Size): RasterCells {
  return halfBlocks(compose(KIT, agent.squishy, { state: agent.state, frame, size, sparkle: sparkling.has(agent.id) }))
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

/** Starts the animator if a squishy just drawn is Working, Thinking or sparkling. */
async function animateShown($: EngineInterface): Promise<void> {
  if (movingPictures(await read($, agents), sparkling).length > 0) animator ??= $.clock.every(FRAME_MS, () => void nextFrame($))
}

/**
 * The shown pictures whose squishy is Working, Thinking or one of
 * `sparklers`, each with its agent.
 */
function movingPictures(known: readonly Agent[], sparklers: ReadonlySet<string>) {
  return [...shown].flatMap(([key, each]) => {
    const agent = known.find(({ id }) => id === each.agentId)
    return agent !== undefined && moves(agent.state, sparklers.has(agent.id)) ? [{ key, agent, ...each }] : []
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
 * alone until the pane is drawn again. A squishy whose sparkle just ended
 * is repainted once more, at rest. The animation stops once no shown
 * squishy is Working, Thinking or sparkling, or Reduce motion is on; the
 * next drawing of the pane starts it again.
 */
async function nextFrame($: EngineInterface): Promise<void> {
  if (painting) return
  painting = true
  try {
    const known = await read($, agents)
    if (await read($, reducedMotion)) return stopAnimating()
    const sparkledBefore = sparkling
    await noteSparkles($, known, false)
    const moving = movingPictures(known, new Set([...sparkledBefore, ...sparkling]))
    if (moving.length === 0) return stopAnimating()
    frame += 1
    for (const { key, agent, size, requestId, cells } of moving) {
      const picture = pictureOf(agent, size)
      if (cells === picture.cells) continue
      let refused = true
      try {
        refused = (await $.ui.blit({ requestId, key, ...picture })).deny !== undefined
      } catch {}
      if (refused) shown.delete(key)
      else shown.set(key, { agentId: agent.id, size, requestId, cells: picture.cells })
    }
  } finally {
    painting = false
  }
}
