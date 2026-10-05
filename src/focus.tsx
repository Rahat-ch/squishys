// The focus view: the pane mode given over to one agent, reached by picking
// its squishy. It shows the squishy at 2×, who the agent is, and the agent's
// live activity, and lets the user redirect it with a message.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On, Timer } from 'claude-code'

import type { ActivityRow, Agent, Delivery, Model, RedirectOutcome, Squishy, SquishyState } from '../types'
import {
  EFFORT_SWITCH_PREFIX,
  MODEL_SWITCH_PREFIX,
  allowedModels,
  effortControlLabel,
  effortStep,
  modelControlLabel,
  modelStep,
  noteEffortStep,
  noteModelStep,
} from './model-switch'
import { controlColumns, heldButton } from './held'
import type { Hold } from './held'
import { OPEN_PANE_ASKED, PANE_ID, PICK_PREFIX, animatedPicture, notePaneOpened, openRefused, pictureKey } from './pane'
import { PARTNER_BUTTON, PARTNER_KEY, partnerFrom } from './partner'
import { SETTINGS_KEY, settingsFrom } from './settings'
import { SHARE_HOTKEY, SHARE_LINK_LABEL, agentShareKey, unopenedShare } from './share'
import { linedUp } from './slots'
import { canShare, endedState, isEnded } from './states'
import {
  STOP_CONFIRM_MS,
  STOP_WAIT_MS,
  askingTaskStop,
  disarmed,
  failureOf,
  holdBack,
  isArmed,
  refusalOf,
  stopUnderWay,
  taskIdOf,
  wasStoppedByUser,
} from './stop'
import { forgetResumed, fromUser, isResumedByRedirect, markResumed } from './resumes'
import { printable } from './text'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const focusedAgentId = atom({ plugin: 'squishys', key: 'focusedAgentId' } as const, null)
const fedAgentIds = atom({ plugin: 'squishys', key: 'fedAgentIds' } as const, [])
const switchedModels = atom({ plugin: 'squishys', key: 'switchedModels' } as const, {})
const switchedEfforts = atom({ plugin: 'squishys', key: 'switchedEfforts' } as const, {})
const effortTaken = atom({ plugin: 'squishys', key: 'effortTaken' } as const, {})
const stopControl = atom({ plugin: 'squishys', key: 'stopControl' } as const, null)
const delivery = atom({ plugin: 'squishys', key: 'delivery' } as const, null)
/** The feeds, one member per agent id, each read as `atom({ ...activity, id }, [])`. */
const activity = { plugin: 'squishys', key: 'activity' } as const

/** How many of its latest rows each agent's feed keeps. */
export const FEED_ROWS = 50

/** The most characters a Markdown draws. */
export const MARKDOWN_LIMIT = 10_000

/** What ends an answer cut to fit a Markdown. */
const CUT_SHORT = '\n\n… (cut short)'

/** What the focus view's Back button says. */
const BACK_LABEL = 'Back to the roster'

/** The columns between the focus view's controls. */
const CONTROL_GAP = 2

/** The longest a tool call's summary runs, in characters. */
const SUMMARY_LIMIT = 80

/** The longest a redirect's row in the feed runs, in characters. */
const REDIRECT_ROW_LIMIT = 500

/**
 * Claude Code's refusal of an append to an agent with no running loop
 * (`no running loop is <agent id>`), the one refusal a send can stand in for.
 */
const NO_RUNNING_LOOP = /no running loop/

/** The arguments that say most about a tool call, the most telling first. */
const TELLING_ARGUMENTS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill']

/** The fields of a tool call's input that aren't the tool's arguments. */
const ENVELOPE_FIELDS = ['tool', 'tool_use_id', 'agentId']

/** The longest TaskStop's refusal runs in the focus view, in characters. */
const REFUSAL_LIMIT = 200

/** The timer that redraws an armed Stop's note away once no second press can come. */
let disarm: Timer | undefined

/** The Redirect box's element key, which the redirect control moves the focus onto. */
const REDIRECT_BOX_KEY = 'redirect'

/** The redirect control's element key. */
const REDIRECT_CONTROL_KEY = 'focus-redirect'

/** The redirect control's hotkey, as `i` starts typing in vi. */
const REDIRECT_HOTKEY = 'i'

/** The model control's hotkey, which steps a switched agent to its next model. */
const MODEL_HOTKEY = 'm'

/** The effort control's hotkey, which steps a running agent to its next effort. */
const EFFORT_HOTKEY = 'e'

/** What the Redirect box says while the pane has the keyboard but the box hasn't. */
export const REDIRECT_HINT = 'Press i to redirect'

/** What the Redirect box says otherwise. */
const REDIRECT_PLACEHOLDER = 'a message for this agent'

/**
 * The element of the pane the focus ring is on, by the `ui.focus` moves
 * that landed. Claude Code says nothing as the pane hands the keyboard
 * back (Esc), and gives it back with the ring on nothing (seen in a tmux
 * session for #49), so a drawing of a pane without the keyboard forgets
 * it. Kept here, never in $.state, which a drawing never writes.
 */
let ringOn: string | undefined

/** How each state reads in the focus view. */
const STATE_NAMES: Record<SquishyState, string> = {
  working: 'Working',
  thinking: 'Thinking',
  needsYou: 'Needs you',
  asleep: 'Asleep',
  squished: 'Squished',
}

/** How each run that ended without an answer reads in the feed. */
const ENDED_ROWS = { interrupted: 'Interrupted', failed: 'Failed', stopped: 'Stopped by you' } as const

/** The first `length` UTF-16 units of `text`, never ending halfway through a surrogate pair. */
function cut(text: string, length: number): string {
  const head = text.slice(0, length)
  return /[\ud800-\udbff]$/.test(head) ? head.slice(0, -1) : head
}

/**
 * A short line of what a tool was called on: its most telling argument
 * (a command, a path, a pattern), else its first string argument.
 */
function summaryOf(call: Record<string, unknown>): string {
  const strings = Object.entries(call).filter(
    (entry): entry is [string, string] => !ENVELOPE_FIELDS.includes(entry[0]) && typeof entry[1] === 'string',
  )
  const telling = TELLING_ARGUMENTS.map(name => strings.find(([key]) => key === name)).find(found => found !== undefined)
  return shortened(printable((telling ?? strings[0])?.[1] ?? '').replace(/\s+/g, ' ').trim(), SUMMARY_LIMIT)
}

/** Text of at most `limit` characters, ending in … where it was cut. */
function shortened(text: string, limit: number): string {
  return text.length > limit ? `${cut(text, limit - 1)}…` : text
}

/** An answer as a Markdown can draw it: printable, and cut short, saying so, past its limit. */
function drawable(answer: string): string {
  const text = printable(answer)
  return text.length > MARKDOWN_LIMIT ? cut(text, MARKDOWN_LIMIT - CUT_SHORT.length) + CUT_SHORT : text
}

/** What a run that ended adds to its agent's feed, by why it ended. */
function rowAfterRun(reason: string, answer: string): ActivityRow | undefined {
  if (reason === 'aborted') return { kind: 'interrupted' }
  if (reason === 'error') return { kind: 'failed' }
  return answer.trim() === '' ? undefined : { kind: 'answer', text: drawable(answer) }
}

/**
 * The tool through which an agent may hand its report back (Claude Code's
 * SubagentHandback, seen in a session for #60), in place of a final answer:
 * its run's turn.complete then carries an empty one.
 */
const HANDBACK_TOOL = 'SubagentHandback'

/**
 * What a tool call adds to its agent's feed: the report a handback carries,
 * as the agent's answer, or else the tool and what it was called on.
 */
function rowOfToolCall(tool: string, call: Record<string, unknown>): ActivityRow {
  const report = call.message
  if (tool === HANDBACK_TOOL && typeof report === 'string' && report.trim() !== '') return { kind: 'answer', text: drawable(report) }
  return { kind: 'tool', tool: printable(tool), summary: summaryOf(call) }
}


/**
 * A feed with a row added: only the latest answer kept, and only the latest
 * FEED_ROWS rows. A run the user stopped reads Stopped by you, not also
 * Interrupted, whichever of the two comes first.
 */
function withRow(feed: readonly ActivityRow[], row: ActivityRow): ActivityRow[] {
  const last = feed.at(-1)?.kind
  if (row.kind === 'interrupted' && last === 'stopped') return [...feed]
  let kept: readonly ActivityRow[] = feed
  if (row.kind === 'answer') kept = feed.filter(each => each.kind !== 'answer')
  if (row.kind === 'stopped' && last === 'interrupted') kept = feed.slice(0, -1)
  return [...kept, row].slice(-FEED_ROWS)
}

/** Whether a pick came from outside the pane, as from the band, which leaves the pane to open. */
function pickedOutsidePane(press: { component: string }): boolean {
  return press.component !== 'Pane'
}

/**
 * What the focus view says while the pane lacks the keyboard, as after a
 * pick from the band, whose press holds the keys. On the main screen
 * (Claude Code's classic rendering) a click never reaches the pane.
 */
export function focusHint(isFullscreen: boolean): string {
  return isFullscreen ? 'Click here or press Ctrl+X Tab' : 'Press Ctrl+X Tab'
}

export function registerFocus(on: On): void {
  // The feed's hooks fit agents' events alone. They must run after the
  // agent tracker's hooks on the same events, which record an agent first
  // seen through this very tool call: hooks/register.tsx registers the
  // tracker first, and a plugin's registrations nest in order, first
  // outermost.
  on('tool.call', { agentId: /./ }, async ($, e, next) => {
    if (e.agentId !== undefined) await addActivity($, e.agentId, rowOfToolCall(e.tool, { ...e }))
    return next(e)
  })

  // A run a redirect resumed raises no tool.call the mod sees (AGENTS.md, "The
  // run a redirect resumes"), so its tool calls come from the blocks of its response
  // as Claude Code appends them, read on their way down: the row goes on as
  // it came. Any other run's tool calls reach the hook above.
  on('session.append', { agentId: /./, door: 'response' }, async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined && isResumedByRedirect(agentId)) {
      for (const block of e.message.content) {
        if (block.type !== 'tool_use' || typeof block.name !== 'string') continue
        const input = typeof block.input === 'object' && block.input !== null ? { ...block.input } : {}
        await addActivity($, agentId, rowOfToolCall(block.name, input))
      }
    }
    return next(e)
  })

  // A run the user's Stop ended at its next step was stopped, whatever it
  // answered. The tracker, outside this hook, lets the agent go after it.
  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    const completed = await next(e)
    const { agentId } = e
    if (agentId === undefined) return completed
    const row = wasStoppedByUser(agentId) ? { kind: 'stopped' as const } : rowAfterRun(e.reason, e.answer)
    if (row !== undefined) await addActivity($, agentId, row)
    forgetResumed(agentId)
    // A redirect's delivery is out of date once its agent ends
    await update($, delivery, latest => (latest?.agentId === agentId ? null : latest))
    return completed
  })

  // The pick: a press on any Button keyed `squishy-<agent id>` (PICK_PREFIX:
  // a roster slot's, by click or digit) opens that agent's focus view. One
  // handler for every place a squishy can be picked from. Picked outside the
  // pane (from the band, while the pane is unplaced), it opens the pane too:
  // asked for by the press, it's placed at any width and asks for the
  // keyboard (OPEN_PANE_ASKED, likely refused while the band holds the keys),
  // and the band is drawn again to step aside. Picked in a pane that lacks
  // the keyboard (a click there presses without handing it over: seen in a
  // tmux session for #49), it asks for the keyboard the same way, so the
  // focus view's hotkeys work at once. It answers the press itself: the
  // Buttons' own onPress is a no-op, and the redraw these writes bring
  // drops the handler that next(e) would reach.
  on('ui.press', { plugin: 'squishys', element: /^squishy-/ }, async ($, e) => {
    const agentId = e.element.slice(PICK_PREFIX.length)
    ringOn = undefined
    await leaveStop($)
    await update($, delivery, latest => (latest?.agentId === agentId ? latest : null))
    await update($, focusedAgentId, () => agentId)
    await update($, mode, () => 'focus')
    if (pickedOutsidePane(e)) {
      try {
        await $.ui.open(OPEN_PANE_ASKED)
        notePaneOpened(OPEN_PANE_ASKED)
      } catch (error) {
        $.ui.toast(openRefused(error))
      }
      $.ui.invalidate('ui.render')
    } else {
      await askForKeyboard($)
    }
    return { element: e.element }
  })

  // The redirect control (i) moves the focus into the Redirect box, awaited
  // inside the press's own dispatch. The control's element key is spelled
  // out, since the engine reads a matcher off this file alone.
  on('ui.press', { plugin: 'squishys', element: 'focus-redirect' }, async ($, e, next) => {
    await focusRedirect($)
    return next(e)
  })

  // Where the pane's focus ring lands, so the Redirect box says to press
  // i only while it lacks the focus
  on('ui.focus', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny === undefined) noteRing($, e.element)
    return moved
  })

  // Stop takes two presses: the first arms it, and a second within
  // STOP_CONFIRM_MS of the first stops the agent. Only a running agent that
  // isn't already being stopped can be.
  on('ui.press', { plugin: 'squishys', element: 'stop' }, async ($, e, next) => {
    const pressed = await next(e)
    const id = await read($, focusedAgentId)
    const agent = (await read($, agents)).find(each => each.id === id)
    if (agent === undefined || !canStop(agent)) return pressed
    // Awaited, so the agent tracker's hook sees the TaskStop call: the press
    // takes at most STOP_WAIT_MS more
    if (isArmed(await read($, stopControl), agent.id, await $.clock.now())) await stop($, agent)
    else await arm($, agent.id)
    return pressed
  })

  // The focus view. Each mode's hook draws only while the pane is in that
  // mode and passes the drawing on otherwise; the pane's id is spelled out,
  // since the engine reads a matcher off this file alone.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'focus') return next(e)
    const { Box, Button, Input, Link, Markdown, Raster, Text } = $.ui.resolve(e)
    // Given the keyboard again, the pane's ring starts on nothing
    if (!e.props.isFocused) ringOn = undefined
    const id = await read($, focusedAgentId)
    const agent = (await read($, agents)).find(each => each.id === id)
    const back = <Button key="back" hotkey="r" plain label={BACK_LABEL} onPress={() => void leaveFocus($)} />
    // The partner stands for the orchestrator: picking it returns to the
    // roster, like the slot's digit there
    let partner: Squishy | undefined
    try {
      partner = partnerFrom(await $.store.get(PARTNER_KEY))
    } catch {}
    // Every control is drawn in every state, so no hotkey reaches the prompt:
    // one that doesn't apply is held (src/held.tsx answers its press). Each is
    // budgeted at its widest, live or held, so the rows they're lined up in
    // don't change between states.
    const stopHold = agent === undefined ? GONE : canStop(agent) ? undefined : stopHoldOf(agent)
    const shareHold = agent === undefined ? GONE : canShare(agent) ? undefined : shareHoldOf(agent)
    const shareKey = agentShareKey(agent?.id ?? id ?? '')
    // The compose page of a Share the browser didn't open
    const shareLink = shareHold === undefined ? unopenedShare(shareKey) : undefined
    const controls: { columns: number; drawn: JSX.Element }[] = [
      { columns: controlColumns(BACK_LABEL, 'r'), drawn: back },
      {
        columns: controlColumns('Stop', 's', STOP_WHYS),
        drawn: stopHold === undefined ? <Button key="stop" hotkey="s" plain label="Stop" onPress={() => {}} /> : heldButton(Button, 'stop', 's', 'Stop', stopHold),
      },
      {
        columns: Math.max(controlColumns(partner?.name ?? PARTNER_LABEL, '1'), controlColumns(PARTNER_LABEL, '1', [NO_PARTNER_WHY])),
        drawn:
          partner !== undefined ? (
            <Button key={PARTNER_BUTTON} hotkey="1" plain dimColor label={partner.name} onPress={() => void leaveFocus($)} />
          ) : (
            heldButton(Button, PARTNER_BUTTON, '1', PARTNER_LABEL, NO_PARTNER)
          ),
      },
      // Answered by the ui.press hook in share.tsx
      {
        columns: controlColumns('Share', SHARE_HOTKEY, SHARE_WHYS),
        drawn:
          shareHold === undefined ? (
            <Button key={shareKey} hotkey={SHARE_HOTKEY} plain label="Share" onPress={() => {}} />
          ) : (
            heldButton(Button, shareKey, SHARE_HOTKEY, 'Share', shareHold)
          ),
      },
      ...(shareLink !== undefined ? [{ columns: SHARE_LINK_LABEL.length, drawn: <Link key="focus-share-link" href={shareLink} label={SHARE_LINK_LABEL} /> }] : []),
    ]
    // As many controls to a row as fit the pane
    const controlRows = (
      <Box key="controls" flexDirection="column">
        {linedUp(
          controls.map(control => control.columns),
          e.props.bodyColumns,
          CONTROL_GAP,
        ).map((line, index) => (
          <Box key={`controls-${index}`} flexDirection="row" columnGap={CONTROL_GAP}>
            {line.map(at => controls[at]?.drawn)}
          </Box>
        ))}
      </Box>
    )
    if (agent === undefined) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text dimColor>That agent is no longer here.</Text>
          {controlRows}
          <Box key="redirect-row">{heldButton(Button, REDIRECT_CONTROL_KEY, REDIRECT_HOTKEY, 'Redirect', GONE)}</Box>
        </Box>
      )
    }
    // Only this agent's feed: another agent's activity doesn't redraw it
    const feed = await read($, atom({ ...activity, id: agent.id }, []))
    // Experimental: the models the live model switch may name, while it's on
    // (src/model-switch.ts keeps the switches and answers the model control)
    let switchable: Model[] | undefined
    try {
      if (settingsFrom(await $.store.get(SETTINGS_KEY)).liveModelSwitch === true) {
        switchable = []
        switchable = allowedModels((await $.settings.read()).availableModels)
      }
    } catch {}
    const switched = switchable !== undefined ? (await read($, switchedModels))[agent.id] : undefined
    const shownModel = switched === undefined ? agent.model : switched.sent ? `${switched.model} (switched)` : `switching to ${switched.model}…`
    // The model control steps through the models allowed; src/model-switch.ts
    // answers its press with the step it was drawn with
    const step = switchable === undefined ? undefined : modelStep(switchable, switched?.model)
    if (step !== undefined) noteModelStep(agent.id, step)
    // The effort control steps through the efforts while the model the agent
    // is on takes one; src/model-switch.ts answers its press
    const effort =
      switchable === undefined
        ? undefined
        : effortStep(agent.id, {
            switchedModels: await read($, switchedModels),
            switchedEfforts: await read($, switchedEfforts),
            effortTaken: await read($, effortTaken),
          })
    if (effort !== undefined) noteEffortStep(agent.id, effort)
    const control = await read($, stopControl)
    const note = stopNote(agent, control?.agentId === agent.id && isArmed(control, agent.id, await $.clock.now()))
    // The latest redirect: to a running agent, while it hasn't ended since; to
    // an ended one, through the run it resumes (its turn.complete clears it)
    const latest = await read($, delivery)
    const shownDelivery = latest?.agentId === agent.id && (latest.wasEnded || !isEnded(agent.state)) ? latest : undefined
    return (
      <Box key="focus" flexDirection="column" rowGap={1}>
        <Box key="focus-header" flexDirection="row" columnGap={2}>
          <Raster key={pictureKey(agent.id, 'double')} {...animatedPicture(agent, 'double')} />
          <Box flexDirection="column">
            <Text bold>{agent.squishy.name}</Text>
            <Text>{STATE_NAMES[agent.state]}</Text>
            {shownModel !== undefined ? <Text dimColor>{shownModel}</Text> : null}
            {switchable === undefined || step === undefined || isEnded(agent.state) ? null : switchable.length === 0 ? (
              <Text dimColor>Experimental: no model can be switched to, by your availableModels setting.</Text>
            ) : (
              <Button
                key={`${MODEL_SWITCH_PREFIX}${agent.id}`}
                hotkey={MODEL_HOTKEY}
                plain
                label={modelControlLabel(step)}
                onPress={() => {}}
              />
            )}
            {effort === undefined || isEnded(agent.state) ? null : (
              <Button key={`${EFFORT_SWITCH_PREFIX}${agent.id}`} hotkey={EFFORT_HOTKEY} plain label={effortControlLabel(effort)} onPress={() => {}} />
            )}
            <Text>{agent.description}</Text>
            {/* Beside the 2× picture, which is taller than this column, and cut short: it never adds a row */}
            {e.props.isFocused ? null : (
              <Text dimColor wrap="truncate-end">
                {focusHint(e.viewport?.isFullscreen === true)}
              </Text>
            )}
          </Box>
        </Box>
        {controlRows}
        {note === undefined ? null : (
          <Box key="stop-note">
            <Text color="yellow">{note}</Text>
          </Box>
        )}
        {/* The redirect control (i) moves the focus into the Redirect box, and typing there never presses a hotkey: AGENTS.md, "While an Input has the focus" */}
        <Box key="redirect-row" flexDirection="column">
          <Box key="redirect-field" flexDirection="row" columnGap={1}>
            {/* Answered by the ui.press hook on the redirect control's element key */}
            <Button key={REDIRECT_CONTROL_KEY} hotkey={REDIRECT_HOTKEY} plain label="Redirect" onPress={() => {}} />
            <Input
              key={REDIRECT_BOX_KEY}
              placeholder={e.props.isFocused && ringOn !== REDIRECT_BOX_KEY ? REDIRECT_HINT : REDIRECT_PLACEHOLDER}
              submitLabel="send"
              onSubmit={text => void redirect($, agent, text)}
            />
          </Box>
          {shownDelivery === undefined ? null : shownDelivery.outcome === undefined ? (
            <Text dimColor>Sending…</Text>
          ) : shownDelivery.outcome.isDelivered ? (
            <Text>{shownDelivery.outcome.viaResume ? `Sent to ${agent.squishy.name}. It had finished; the message resumed it.` : `Sent to ${agent.squishy.name}`}</Text>
          ) : (
            <Text color="red">Not sent: {printable(shownDelivery.outcome.reason)}</Text>
          )}
        </Box>
        <Box key="activity" flexDirection="column">
          {feed.length === 0 && agent.state !== 'thinking' ? <Text dimColor>No activity yet.</Text> : null}
          {feed.map((row, index) => {
            const key = `activity-${index}`
            if (row.kind === 'answer') return <Markdown key={key} text={row.text} />
            if (row.kind === 'redirect') {
              return (
                <Box key={key}>
                  <Text bold>You: {shortened(row.text, REDIRECT_ROW_LIMIT)}</Text>
                </Box>
              )
            }
            if (row.kind !== 'tool') {
              return (
                <Box key={key}>
                  <Text italic>{ENDED_ROWS[row.kind]}</Text>
                </Box>
              )
            }
            return (
              <Box key={key} flexDirection="row" columnGap={1}>
                <Text bold>{row.tool}</Text>
                <Text dimColor wrap="truncate-end">
                  {row.summary}
                </Text>
              </Box>
            )
          })}
          {agent.state === 'thinking' ? (
            <Text italic dimColor>
              Thinking…
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  })
}

/**
 * The agents a redirect is being sent to, so a second Enter while one is on
 * its way sends nothing. Kept here rather than in $.state, whose reads in a
 * second dispatch may predate the first one's write.
 */
const sending = new Set<string>()

/**
 * Sends the user's message to an agent and records the delivery: shown in
 * the focus view, and once delivered, added to the agent's feed.
 */
async function redirect($: EngineInterface, agent: Agent, typed: string): Promise<void> {
  const text = typed.trim()
  if (text === '' || sending.has(agent.id)) return
  sending.add(agent.id)
  try {
    const wasEnded = isEnded(agent.state)
    const pending: Delivery = { agentId: agent.id, wasEnded }
    await update($, delivery, () => pending)
    const outcome = await deliver($, agent, fromUser(text))
    await update($, delivery, () => ({ ...pending, outcome }))
    if (outcome.isDelivered) await addActivity($, agent.id, { kind: 'redirect', text: printable(text) })
  } finally {
    sending.delete(agent.id)
  }
}

/**
 * Delivers a message to an agent: a running one reads it, appended to its
 * conversation, at the start of its next step; an ended one is sent it,
 * which resumes it, and the tracker wakes its squishy as the message lands
 * in its conversation (AGENTS.md, "The run a redirect resumes").
 * A running agent's append refused for want of a running loop (it ended
 * before its squishy showed it) is sent instead; any other refusal stands.
 * The test kit can't append: AGENTS.md, "A redirect goes".
 */
async function deliver($: EngineInterface, agent: Agent, message: string): Promise<RedirectOutcome> {
  if (!isEnded(agent.state)) {
    let refusal: string
    try {
      const appended = await $.session.append({ agentId: agent.id, message: { type: 'user', content: [{ type: 'text', text: message }] } })
      if (appended.deny === undefined) return { isDelivered: true, viaResume: false }
      refusal = appended.deny
    } catch (error) {
      refusal = reasonOf(error)
    }
    if (!NO_RUNNING_LOOP.test(refusal)) return { isDelivered: false, reason: refusal }
  }
  // Marked before the send, which may start the run before it answers
  markResumed(agent.id)
  let outcome: RedirectOutcome
  try {
    const sent = await $.session.send({ to: { agentId: agent.id }, text: message })
    outcome = sent.isDelivered ? { isDelivered: true, viaResume: true } : { isDelivered: false, reason: sent.reason }
  } catch (error) {
    outcome = { isDelivered: false, reason: reasonOf(error) }
  }
  if (!outcome.isDelivered) forgetResumed(agent.id)
  return outcome
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Adds a row to an agent's feed; agents without a squishy are left out.
 * Feeds of agents the tracker no longer knows are emptied on the way, and
 * while the pane shows this agent's focus view, it scrolls to the new row.
 */
async function addActivity($: EngineInterface, agentId: string, row: ActivityRow): Promise<void> {
  const known = (await read($, agents)).map(agent => agent.id)
  if (!known.includes(agentId)) return
  const fed = await read($, fedAgentIds)
  const gone = fed.filter(id => !known.includes(id))
  for (const id of gone) await update($, atom({ ...activity, id }, []), () => [])
  if (gone.length > 0 || !fed.includes(agentId)) {
    await update($, fedAgentIds, ids => [...ids.filter(id => known.includes(id) && id !== agentId), agentId])
  }
  await update($, atom({ ...activity, id: agentId }, []), feed => withRow(feed, row))
  if ((await read($, mode)) === 'focus' && (await read($, focusedAgentId)) === agentId) {
    try {
      await $.ui.scroll({ in: PANE_ID, to: 'end' })
    } catch {} // a pane that can't scroll now shows the row once the user scrolls
  }
}

/** Whether Stop is offered for this agent: it runs, and no stop of it is under way. */
function canStop(agent: Agent): boolean {
  return !isEnded(agent.state) && stopUnderWay(agent.id) === undefined
}

/** Why the controls of an agent the tracker no longer knows are held. */
const GONE: Hold = { why: 'gone', reason: 'that agent is no longer here.' }

/** Why Stop can be held, which its budget in the row counts: ended, a stop under way, or gone. */
const STOP_FINISHED = 'finished'
const STOP_STOPPING = 'stopping…'
const STOP_WHYS = [STOP_FINISHED, STOP_STOPPING, 'gone']

/** Why Stop is held for an agent it isn't offered for: it has ended, or a stop of it is under way. */
function stopHoldOf(agent: Agent): Hold {
  const { name } = agent.squishy
  if (isEnded(agent.state)) return { why: STOP_FINISHED, reason: `${name} has finished, so there’s nothing to stop.` }
  return { why: STOP_STOPPING, reason: `${name} is already being stopped.` }
}

/** Why Share can be held, which its budget in the row counts: still running, Squished, or gone. */
const SHARE_RUNNING = 'once Asleep'
const SHARE_WHYS = [SHARE_RUNNING, STATE_NAMES.squished, 'gone']

/** Why Share is held for an agent it isn't offered for: it still runs, or it's Squished. */
function shareHoldOf(agent: Agent): Hold {
  const { name } = agent.squishy
  if (!isEnded(agent.state)) return { why: SHARE_RUNNING, reason: `${name} is still running. Share works once it’s Asleep.` }
  return { why: STATE_NAMES.squished, reason: `only an Asleep squishy can be shared, and ${name} is ${STATE_NAMES.squished}.` }
}

/** The partner's control while no partner is saved, held. */
const PARTNER_LABEL = 'Partner'
const NO_PARTNER_WHY = 'none yet'
const NO_PARTNER: Hold = { why: NO_PARTNER_WHY, reason: 'no partner is saved yet. r goes back to the roster.' }

/** What the Stop control says about this agent, if anything: armed, or a stop under way. */
function stopNote(agent: Agent, armed: boolean): string | undefined {
  const { name } = agent.squishy
  if (armed) return `press s again to stop ${name}`
  // Once the agent has ended, its state and feed say how it went
  const underWay = isEnded(agent.state) ? undefined : stopUnderWay(agent.id)
  if (underWay === undefined) return undefined
  if (underWay.by === 'taskStop') return `Stopping ${name}…`
  const why = underWay.refusal === undefined ? '' : ` TaskStop didn't stop it: ${refusalLine(underWay.refusal)}`
  return `Stopping ${name} at its next step: its tool calls are refused.${why}`
}

/**
 * Moves the pane's focus into the Redirect box, so the user's keys type
 * there. Claude Code refuses it while the pane lacks the keyboard, as after
 * a click on the redirect control, which presses it without handing the
 * pane the keyboard, so it asks for the keyboard first. A refusal is toasted.
 */
async function focusRedirect($: EngineInterface): Promise<void> {
  await askForKeyboard($)
  let refusal: string | undefined
  try {
    refusal = (await $.ui.focus({ requestId: PANE_ID, key: REDIRECT_BOX_KEY })).deny
  } catch (error) {
    refusal = reasonOf(error)
  }
  if (refusal === undefined) noteRing($, REDIRECT_BOX_KEY)
  else $.ui.toast(`Squishys: the Redirect box can’t take the keys: ${refusalLine(refusal)}`)
}

/**
 * Asks for the keyboard while the pane is open without it, as an open the
 * user's press asked for (`focus` is a request, granted only over an empty
 * prompt). A pane list that can't be read leaves the pane as it is, and
 * the focus view says how to give it the keyboard.
 */
async function askForKeyboard($: EngineInterface): Promise<void> {
  try {
    if ((await $.ui.panes()).some(pane => pane.id === PANE_ID && !pane.isFocused)) {
      await $.ui.open(OPEN_PANE_ASKED)
      notePaneOpened(OPEN_PANE_ASKED)
    }
  } catch {}
}

/** Notes where the pane's focus ring landed, redrawing the Redirect box's hint when it changes. */
function noteRing($: EngineInterface, element: string | undefined): void {
  const wasOnRedirect = ringOn === REDIRECT_BOX_KEY
  ringOn = element
  if (wasOnRedirect !== (element === REDIRECT_BOX_KEY)) $.ui.invalidate('ui.render')
}

/**
 * Back to the roster, disarming Stop and clearing the latest redirect's
 * delivery on the way. The mark of a redirect's run goes too once its agent
 * shows ended, as when the run never started; one still running keeps
 * filling its feed.
 */
async function leaveFocus($: EngineInterface): Promise<void> {
  ringOn = undefined
  const id = await read($, focusedAgentId)
  if (id !== null && (await read($, agents)).some(agent => agent.id === id && isEnded(agent.state))) forgetResumed(id)
  await leaveStop($)
  await update($, delivery, () => null)
  await update($, mode, () => 'roster')
}

/**
 * Disarms Stop as the focus view changes agent or mode. A stop under way
 * carries on, and says how it went if its agent's focus view opens again.
 */
async function leaveStop($: EngineInterface): Promise<void> {
  disarm?.cancel()
  await update($, stopControl, control => disarmed(control))
}

/** Arms Stop for an agent, from now; its note is drawn away once no second press can come. */
async function arm($: EngineInterface, agentId: string): Promise<void> {
  disarm?.cancel()
  const armedAt = await $.clock.now()
  await update($, stopControl, () => ({ agentId, armedAt }))
  disarm = $.clock.after(STOP_CONFIRM_MS, () => $.ui.invalidate('ui.render'))
}

/**
 * Stops an agent through TaskStop, whose call the agent tracker sees (its
 * squishy is Squished once the agent list shows it ended). When TaskStop is
 * refused, fails, leaves the agent running by the agent list, or gives no
 * answer within STOP_WAIT_MS, the tracker holds the agent back instead.
 */
async function stop($: EngineInterface, agent: Agent): Promise<void> {
  disarm?.cancel()
  askingTaskStop(agent.id, true)
  await update($, stopControl, control => disarmed(control))
  const taskId = taskIdOf(agent.id, await agentList($))
  let timer: Timer | undefined
  const tooSlow = new Promise<undefined>(resolve => {
    timer = $.clock.after(STOP_WAIT_MS, () => resolve(undefined))
  })
  const taskStop = $.tool.call({ tool: 'TaskStop', task_id: taskId }).then(
    result => ({ refusal: refusalOf(result) }),
    (error: unknown) => ({ refusal: failureOf(error) }),
  )
  const outcome = await Promise.race([taskStop, tooSlow])
  timer?.cancel()
  askingTaskStop(agent.id, false)
  if (outcome !== undefined && outcome.refusal === undefined && hasEnded(agent.id, await agentList($))) {
    await addActivity($, agent.id, { kind: 'stopped' })
  } else {
    holdBack(agent.id, outcome?.refusal)
  }
  $.ui.invalidate('ui.render')
}

/** A refusal (TaskStop's, a focus move's) as one printable line, cut short past REFUSAL_LIMIT. */
function refusalLine(refusal: string): string {
  const line = printable(refusal).replace(/\s+/g, ' ').trim()
  return line.length > REFUSAL_LIMIT ? `${cut(line, REFUSAL_LIMIT - 1)}…` : line
}

/** The agent list, or none when it can't be read. */
async function agentList($: EngineInterface): Promise<readonly AgentInfo[]> {
  try {
    return await $.agent.list()
  } catch {
    return []
  }
}

/** Whether the agent list shows this agent ended. */
function hasEnded(agentId: string, listed: readonly AgentInfo[]): boolean {
  const status = listed.find(each => each.id === agentId)?.status
  return status !== undefined && endedState(status) !== undefined
}
