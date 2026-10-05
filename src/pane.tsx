// The pane: one Squishys panel beside the main view. It shows one mode at a
// time (see PaneMode); this file draws the roster, as many slots as fit
// with the overflow as "+N" (see slots.ts), and animates the squishys every
// mode, and the band (see band.tsx), shows.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PaneOpenArgs, Timer } from 'claude-code'

import type { Agent, Squishy } from '../types'
import { compose } from './composer'
import type { Size } from './composer'
import { heldKey, heldLabel } from './held'
import type { Hold } from './held'
import { pickKeys } from './keys'
import { KIT } from './kit'
import { isSparkling } from './moments'
import { PARTNER_BUTTON, PARTNER_KEY, PARTNER_PICTURE, partnerFrom } from './partner'
import { halfBlocks } from './raster'
import type { RasterCells } from './raster'
import { SETTINGS_KEY, settingsFrom } from './settings'
import {
  FOOTER_BUTTON_GAP,
  FOOTER_COLUMN_GAP,
  FOOTER_COLUMNS,
  FOOTER_ROW_COLUMNS,
  FOOTER_ROW_GAP,
  OVERFLOW_HOTKEY,
  SETTINGS_BUTTON,
  SQUISHYDEX_BUTTON,
  SLOT_COLUMN_GAP,
  SLOT_COLUMNS,
  SLOT_ROWS,
  SLOT_ROW_GAP,
  SLOT_SHAPES,
  buttonColumns,
  layoutRoster,
  linedUp,
  slotLabel,
} from './slots'
import { moves } from './states'

export const PANE_ID = 'squishys'

/**
 * What a Button that picks a squishy is keyed: this, then its agent's id.
 * src/focus.tsx answers a press on any pane Button keyed so (the pick).
 */
export const PICK_PREFIX = 'squishy-'

/**
 * How a squishy's slot lights while the pointer is anywhere over it (the
 * roster's, the band's and a met Squishydex place's keyed Box), so a
 * squishy feels clickable; its Name stays the press. A background alone,
 * which takes no cells, so nothing moves, in the theme's selection color:
 * the one theme key that stands out from both the docked pane's background
 * and the terminal's on every theme (AGENTS.md says how that was checked).
 * Only fullscreen rendering has the pointer; on the main screen nothing
 * changes.
 */
export const SLOT_HOVER = { backgroundColor: 'selectionBg' } as const

/**
 * How the pane is opened unasked, at the first spawn, with no `focus`, so it
 * never asks for the keyboard while the user may be typing. Inline, rows
 * are scarce: it asks for one row of slots.
 */
export const OPEN_PANE = { id: PANE_ID, title: 'Squishys', rows: SLOT_ROWS } as const

/**
 * How the pane is opened when the user asks for it (/squishys, /squishydex,
 * a pick from the band): with `focus` too, so its hotkeys can work at once.
 *
 * What makes an open asked is the person's input behind it, not `focus`:
 * the types say "An open answering the person's input (a command or prompt
 * they entered, a press) is placed at any width". And `focus` is "A request,
 * not a grant: the surface focuses (and raises) the pane only while the
 * prompt has the keys over an empty composer. An element of the band or a
 * pane the person holds, text in the composer, a dialog or a survey each
 * refuse it: the pane opens without the keyboard." So a pick from the band,
 * whose press holds the keys, likely opens it without them; the focus view
 * and the starter pick say how to give it the keyboard while it lacks it.
 */
export const OPEN_PANE_ASKED = { ...OPEN_PANE, focus: true } as const

/** Why the overflow count is held while the overflow is empty: as wide as a count, which the footer budgets. */
const NO_OVERFLOW: Hold = { reason: 'every agent has a slot, so the overflow is empty.' }

/** The keys the roster's footer takes, which no squishy's pick does. */
const ROSTER_KEYS = [OVERFLOW_HOTKEY, SETTINGS_BUTTON.hotkey, SQUISHYDEX_BUTTON.hotkey]

/**
 * Whether the user asked for the pane since it last opened unasked. While
 * they haven't, /squishys opens an open pane again (asking for the keyboard)
 * rather than closing it. Kept here, not in $.state: a reload only makes the
 * next /squishys open it again first.
 */
let askedFor = false

/**
 * Notes an open that went through, by the args it was opened with: only the
 * opens the user asks for are OPEN_PANE_ASKED, the ones with `focus`.
 */
export function notePaneOpened(opened: PaneOpenArgs): void {
  askedFor = opened.focus === true
}

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
 * The pictures the animator may repaint, by site and Raster key (`shownKey`),
 * so the pane's minis and the band's never stand for each other: whose
 * squishy each shows, at what size, in which site (the pane or the band, by
 * requestId), under which Raster key, and the cells it shows now. Each
 * drawing of a site fills it again for that site, through `animatedPicture`.
 */
const shown = new Map<string, { agentId: string; size: Size; requestId: string; key: string; cells: string }>()

/** Where `shown` keeps a picture: its site, then its Raster key. */
function shownKey(requestId: string, key: string): string {
  return `${requestId} ${key}`
}

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
  const key = pictureKey(agent.id, size)
  shown.set(shownKey(requestId, key), { agentId: agent.id, size, requestId, key, cells: picture.cells })
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
  for (const [at, picture] of shown) if (picture.requestId === requestId) shown.delete(at)
}

/** One slot of the roster as drawn: the partner's or an agent's. */
type Slot = {
  /** The agent's id, or `partner`. */
  id: string
  /** The key of the Button that picks it. */
  pickKey: string
  /** Its picture at the layout's slot size, and the Raster's key; none for a label slot. */
  picture: { key: string; cells: RasterCells } | undefined
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
  // A placed pane closes once the user has asked for it since it last opened
  // unasked; one that only opened unasked is opened again, asking for the
  // keyboard. Whether it has the keyboard says nothing here: the command is
  // typed at the prompt, which holds the keys while it's typed.
  on('command.run', { command: 'squishys' }, async $ => {
    const panes = await $.ui.panes()
    if (askedFor && panes.some(pane => pane.id === PANE_ID && pane.isPlaced)) await $.ui.close({ id: PANE_ID })
    else {
      try {
        await $.ui.open(OPEN_PANE_ASKED)
        notePaneOpened(OPEN_PANE_ASKED)
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
    // and it's marked while the main view shows the orchestrator. A short
    // inline pane draws mini pictures, or none (layout.slotSize).
    const shape = SLOT_SHAPES[layout.slotSize]
    const { picture: pictureSize } = shape
    const slots: Slot[] = showsList
      ? []
      : [
          ...(partner !== undefined && layout.partnerSlot
            ? [
                {
                  id: 'partner',
                  pickKey: PARTNER_BUTTON,
                  picture: pictureSize === undefined ? undefined : { key: PARTNER_PICTURE, cells: stillPictureAt(partner, pictureSize) },
                  name: partner.name,
                  description: 'Orchestrator',
                  inView: view.agentId === undefined,
                },
              ]
            : []),
          ...layout.slots.map(agent => ({
            id: agent.id,
            pickKey: `${PICK_PREFIX}${agent.id}`,
            picture: pictureSize === undefined ? undefined : { key: pictureKey(agent.id, pictureSize), cells: animatedPicture(agent, pictureSize) },
            name: agent.squishy.name,
            description: agent.description,
            inView: agent.id === view.agentId,
          })),
        ]
    if (!motionReduced) await animateShown($)

    const columns = Math.max(1, layout.columns)
    const rows = Array.from({ length: Math.ceil(slots.length / columns) }, (_, row) => slots.slice(row * columns, (row + 1) * columns))
    const noAgents = <Text dimColor>No agents yet. Each agent the orchestrator starts gets a squishy here.</Text>
    // Digits, then the letters the footer leaves free, pick the squishys shown
    const pickHotkeys = pickKeys(showsList ? layout.overflow.length : slots.length, ROSTER_KEYS)
    const body = showsList ? (
      // The overflow list: one line per agent, in place of the slots. Its
      // presses pick the squishy, as a slot's do: src/focus.tsx answers them.
      <Box key="overflow-list" flexDirection="column">
        {layout.overflow.map((agent, index) => (
          <Box key={`overflow-${agent.id}`} flexDirection="row" columnGap={1}>
            <Button
              key={`${PICK_PREFIX}${agent.id}`}
              {...(pickHotkeys[index] === undefined ? {} : { hotkey: pickHotkeys[index] })}
              plain
              label={agent.squishy.name}
              onPress={() => {}}
            />
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
              const hotkey = pickHotkeys[index]
              const lines = [
                // An agent's press picks its squishy: src/focus.tsx answers it. The partner's leaves the roster be.
                <Button key={slot.pickKey} {...(hotkey === undefined ? {} : { hotkey })} plain label={slotLabel(slot.name, hotkey)} onPress={() => {}} />,
                ...(shape.lines === 'all'
                  ? [
                      <Text key={`description-${slot.id}`} dimColor wrap="truncate-end">
                        {slot.description}
                      </Text>,
                      // Squishys only reads the main view, never changes it (ADR 0001).
                      slot.inView ? (
                        <Box key={`in-view-${slot.id}`}>
                          <Text color="cyan">▲ in main view</Text>
                        </Box>
                      ) : null,
                    ]
                  : []),
              ]
              // The picture over the slot's lines, or beside them in a column of their own, or none (SLOT_SHAPES)
              return (
                <Box
                  key={`slot-${slot.id}`}
                  flexDirection={shape.direction}
                  alignItems={shape.alignItems}
                  columnGap={shape.gap}
                  width={shape.columns}
                  hover={SLOT_HOVER}
                >
                  {slot.picture === undefined ? null : <Raster key={slot.picture.key} {...slot.picture.cells} />}
                  {shape.direction === 'column' ? (
                    lines
                  ) : (
                    <Box key={`lines-${slot.id}`} flexDirection="column" width={SLOT_COLUMNS}>
                      {lines}
                    </Box>
                  )}
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
      {
        columns: buttonColumns(overflowLabel, OVERFLOW_HOTKEY),
        // With no overflow, the count is held, so m never reaches the prompt (src/held.ts answers its press)
        button:
          layout.overflow.length > 0 ? (
            <Button key="overflow" hotkey={OVERFLOW_HOTKEY} plain label={overflowLabel} onPress={() => void showOverflowList($, !showsList)} />
          ) : (
            <Button key={heldKey('overflow', NO_OVERFLOW)} hotkey={OVERFLOW_HOTKEY} plain dimColor label={heldLabel(overflowLabel, NO_OVERFLOW)} onPress={() => {}} />
          ),
      },
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
    // As many buttons to a row as fit `columns` (slots.ts budgets the rows)
    const linedFooter = (columns: number) => (
      <Box key="footer" flexDirection="column" width={columns}>
        {linedUp(
          footer.map(each => each.columns),
          columns,
          FOOTER_BUTTON_GAP,
        ).map((line, index) => (
          <Box key={`footer-row-${index}`} flexDirection="row" columnGap={FOOTER_BUTTON_GAP}>
            {line.map(at => footer[at]?.button)}
          </Box>
        ))}
      </Box>
    )
    // Docked, the footer goes under the slots, so a narrow pane's takes more
    // rows; inline, where rows are scarce, beside them: a button to a row,
    // or in a pane too short for that, a row of them (layout.footer)
    return placement === 'inline' ? (
      <Box flexDirection="row" columnGap={FOOTER_COLUMN_GAP}>
        <Box flexDirection="column" flexGrow={1}>
          {body}
        </Box>
        {layout.footer === 'column' ? (
          <Box key="footer" flexDirection="column" width={FOOTER_COLUMNS}>
            {footer.map(each => each.button)}
          </Box>
        ) : (
          linedFooter(FOOTER_ROW_COLUMNS)
        )}
      </Box>
    ) : (
      <Box flexDirection="column" rowGap={FOOTER_ROW_GAP}>
        {body}
        {linedFooter(bodyColumns)}
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

/** The partner's squishy at rest at this size (src/partner.tsx's `stillPicture` at full size). */
function stillPictureAt(squishy: Squishy, size: Size): RasterCells {
  return halfBlocks(compose(KIT, squishy, { state: 'working', frame: 0, size }))
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
  return [...shown].flatMap(([at, each]) => {
    const agent = known.find(({ id }) => id === each.agentId)
    return agent !== undefined && moves(agent.state, sparklers.has(agent.id)) ? [{ at, agent, ...each }] : []
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
    for (const { at, key, agent, size, requestId, cells } of moving) {
      const picture = pictureOf(agent, size)
      if (cells === picture.cells) continue
      let refused = true
      try {
        refused = (await $.ui.blit({ requestId, key, ...picture })).deny !== undefined
      } catch {}
      if (refused) shown.delete(at)
      else shown.set(at, { agentId: agent.id, size, requestId, key, cells: picture.cells })
    }
  } finally {
    painting = false
  }
}
