// The focus view: the pane mode given over to one agent, reached by picking
// its squishy. It shows the squishy at 2×, who the agent is, and the agent's
// live activity.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On, Timer } from 'claude-code'

import type { ActivityRow, Agent, Model, Squishy, SquishyState } from '../types'
import { AS_STARTED, MODEL_SWITCH_PREFIX, allowedModels } from './model-switch'
import { OPEN_PANE, PANE_ID, PICK_PREFIX, animatedPicture, openRefused, pictureKey } from './pane'
import { PARTNER_BUTTON, PARTNER_KEY, partnerFrom } from './partner'
import { SETTINGS_KEY, modelOptions, settingsFrom } from './settings'
import { endedState, isEnded } from './states'
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

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const focusedAgentId = atom({ plugin: 'squishys', key: 'focusedAgentId' } as const, null)
const fedAgentIds = atom({ plugin: 'squishys', key: 'fedAgentIds' } as const, [])
const switchedModels = atom({ plugin: 'squishys', key: 'switchedModels' } as const, {})
const stopControl = atom({ plugin: 'squishys', key: 'stopControl' } as const, null)
/** The feeds, one member per agent id, each read as `atom({ ...activity, id }, [])`. */
const activity = { plugin: 'squishys', key: 'activity' } as const

/** How many of its latest rows each agent's feed keeps. */
export const FEED_ROWS = 50

/** The most characters a Markdown draws. */
export const MARKDOWN_LIMIT = 10_000

/** What ends an answer cut to fit a Markdown. */
const CUT_SHORT = '\n\n… (cut short)'

/** The longest a tool call's summary runs, in characters. */
const SUMMARY_LIMIT = 80

/** The arguments that say most about a tool call, the most telling first. */
const TELLING_ARGUMENTS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill']

/** The fields of a tool call's input that aren't the tool's arguments. */
const ENVELOPE_FIELDS = ['tool', 'tool_use_id', 'agentId']

/** The longest TaskStop's refusal runs in the focus view, in characters. */
const REFUSAL_LIMIT = 200

/** The timer that redraws an armed Stop's note away once no second press can come. */
let disarm: Timer | undefined

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

/**
 * Text with every control character but tab and newline taken out: terminal
 * escape sequences whole, then any other C0 or C1 character (`\r` too). A
 * Text or Markdown holding one is refused, and the whole tree with it.
 */
function printable(text: string): string {
  return (
    text
      // CSI sequences (colors, cursor moves), OSC sequences (titles, links), then lone escapes
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, '')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
  )
}

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
  const line = printable((telling ?? strings[0])?.[1] ?? '').replace(/\s+/g, ' ').trim()
  return line.length > SUMMARY_LIMIT ? `${cut(line, SUMMARY_LIMIT - 1)}…` : line
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

export function registerFocus(on: On): void {
  // The feed's hooks fit agents' events alone. They must run after the
  // agent tracker's hooks on the same events, which record an agent first
  // seen through this very tool call: hooks/register.tsx registers the
  // tracker first, and a plugin's registrations nest in order, first
  // outermost.
  on('tool.call', { agentId: /./ }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      await addActivity($, e.agentId, { kind: 'tool', tool: printable(e.tool), summary: summaryOf({ ...e }) })
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
    return completed
  })

  // The pick: a press on any Button keyed `squishy-<agent id>` (PICK_PREFIX:
  // a roster slot's, by click or digit) opens that agent's focus view. One
  // handler for every place a squishy can be picked from. Picked outside the
  // pane (from the band, while the pane is unplaced), it opens the pane too:
  // asked for by the press, it's placed at any width, and the band is drawn
  // again to step aside.
  on('ui.press', { plugin: 'squishys', element: /^squishy-/ }, async ($, e, next) => {
    const agentId = e.element.slice(PICK_PREFIX.length)
    await leaveStop($)
    await update($, focusedAgentId, () => agentId)
    await update($, mode, () => 'focus')
    if (pickedOutsidePane(e)) {
      try {
        await $.ui.open(OPEN_PANE)
      } catch (error) {
        $.ui.toast(openRefused(error))
      }
      $.ui.invalidate('ui.render')
    }
    return next(e)
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
    const { Box, Button, Markdown, Raster, Select, Text } = $.ui.resolve(e)
    const id = await read($, focusedAgentId)
    const agent = (await read($, agents)).find(each => each.id === id)
    const back = <Button key="back" hotkey="r" plain label="Back to the roster" onPress={() => void leaveFocus($)} />
    if (agent === undefined) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text dimColor>That agent is no longer here.</Text>
          {back}
        </Box>
      )
    }
    // Only this agent's feed: another agent's activity doesn't redraw it
    const feed = await read($, atom({ ...activity, id: agent.id }, []))
    // Experimental: the models the live model switch may name, while it's on
    // (src/model-switch.ts keeps the switches and answers the picker)
    let switchable: Model[] | undefined
    try {
      if (settingsFrom(await $.store.get(SETTINGS_KEY)).liveModelSwitch === true) {
        switchable = []
        switchable = allowedModels((await $.settings.read()).availableModels)
      }
    } catch {}
    // The partner stands for the orchestrator: picking it returns to the
    // roster, like the slot's digit there
    let partner: Squishy | undefined
    try {
      partner = partnerFrom(await $.store.get(PARTNER_KEY))
    } catch {}
    const switched = switchable !== undefined ? (await read($, switchedModels))[agent.id] : undefined
    const shownModel = switched === undefined ? agent.model : switched.sent ? `${switched.model} (switched)` : `switching to ${switched.model}…`
    const control = await read($, stopControl)
    const note = stopNote(agent, control?.agentId === agent.id && isArmed(control, agent.id, await $.clock.now()))
    return (
      <Box key="focus" flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2}>
          <Raster key={pictureKey(agent.id, 'double')} {...animatedPicture(agent, 'double')} />
          <Box flexDirection="column">
            <Text bold>{agent.squishy.name}</Text>
            <Text>{STATE_NAMES[agent.state]}</Text>
            {shownModel !== undefined ? <Text dimColor>{shownModel}</Text> : null}
            {switchable === undefined || isEnded(agent.state) ? null : switchable.length === 0 ? (
              <Text dimColor>Experimental: no model can be switched to, by your availableModels setting.</Text>
            ) : (
              // Its pick is answered by the ui.select hook in model-switch.ts
              <Select
                key={`${MODEL_SWITCH_PREFIX}${agent.id}`}
                label="Experimental: switch model: "
                options={[{ value: AS_STARTED, label: 'As started' }, ...modelOptions(switchable)]}
                value={switched !== undefined && switchable.includes(switched.model) ? switched.model : AS_STARTED}
                onSelect={() => {}}
              />
            )}
            <Text>{agent.description}</Text>
          </Box>
        </Box>
        {/* Redirect (#13) joins the controls here. */}
        <Box key="controls" flexDirection="row" columnGap={2}>
          {back}
          {canStop(agent) ? <Button key="stop" hotkey="s" plain label="Stop" onPress={() => {}} /> : null}
          {partner !== undefined ? (
            <Button key={PARTNER_BUTTON} hotkey="1" plain dimColor label={partner.name} onPress={() => void update($, mode, () => 'roster')} />
          ) : null}
        </Box>
        {note === undefined ? null : (
          <Box key="stop-note">
            <Text color="yellow">{note}</Text>
          </Box>
        )}
        <Box key="activity" flexDirection="column">
          {feed.length === 0 && agent.state !== 'thinking' ? <Text dimColor>No activity yet.</Text> : null}
          {feed.map((row, index) => {
            const key = `activity-${index}`
            if (row.kind === 'answer') return <Markdown key={key} text={row.text} />
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

/** Back to the roster, disarming Stop on the way. */
async function leaveFocus($: EngineInterface): Promise<void> {
  await leaveStop($)
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

/** TaskStop's refusal as one printable line, cut short past REFUSAL_LIMIT. */
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
