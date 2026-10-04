// The focus view: the pane mode given over to one agent, reached by picking
// its squishy. It shows the squishy at 2×, who the agent is, and the agent's
// live activity.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { ActivityRow, Agent, Model, SquishyState, StopControl } from '../types'
import { isStoppingAtNextStep, stopAtNextStep } from './agents'
import { AS_STARTED, MODEL_SWITCH_PREFIX, allowedModels } from './model-switch'
import { PANE_ID, PICK_PREFIX, animatedPicture, pictureKey } from './pane'
import { SETTINGS_KEY, modelOptions, settingsFrom } from './settings'
import { endedState, isEnded } from './states'

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

/** How long, in milliseconds, a first press of Stop waits for the second. */
export const STOP_CONFIRM_MS = 3000

/**
 * How long, in milliseconds, Stop waits for TaskStop to answer before it
 * stops the agent at its next step instead.
 */
export const STOP_WAIT_MS = 2000

/** The longest TaskStop's refusal runs in the focus view, in characters. */
const REFUSAL_LIMIT = 200

/** The timer that disarms Stop when no second press comes. */
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
    const stoppedByUser = isStoppingAtNextStep(agentId)
    const row = stoppedByUser ? { kind: 'stopped' as const } : rowAfterRun(e.reason, e.answer)
    if (row !== undefined) await addActivity($, agentId, row)
    if (stoppedByUser) await update($, stopControl, control => (control?.agentId === agentId ? null : control))
    return completed
  })

  // The pick: a press on any Button keyed `squishy-<agent id>` (PICK_PREFIX:
  // a roster slot's, by click or digit) opens that agent's focus view. One
  // handler for every place a squishy can be picked from.
  on('ui.press', { plugin: 'squishys', element: /^squishy-/ }, async ($, e, next) => {
    const agentId = e.element.slice(PICK_PREFIX.length)
    await leaveStop($)
    await update($, focusedAgentId, () => agentId)
    await update($, mode, () => 'focus')
    return next(e)
  })

  // Stop takes two presses: the first arms it, and a second within
  // STOP_CONFIRM_MS stops the agent. Only a running agent that isn't
  // already being stopped can be.
  on('ui.press', { plugin: 'squishys', element: 'stop' }, async ($, e, next) => {
    const pressed = await next(e)
    const id = await read($, focusedAgentId)
    const agent = (await read($, agents)).find(each => each.id === id)
    const control = await read($, stopControl)
    if (agent === undefined || !canStop(agent, control)) return pressed
    // Awaited, so the agent tracker's hook sees the TaskStop call: the press
    // takes at most STOP_WAIT_MS more
    if (control?.agentId === agent.id && control.step === 'armed') await stop($, agent)
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
    const switched = switchable !== undefined ? (await read($, switchedModels))[agent.id] : undefined
    const shownModel = switched === undefined ? agent.model : switched.sent ? `${switched.model} (switched)` : `switching to ${switched.model}…`
    const shownStop = await read($, stopControl)
    const note = stopNote(shownStop, agent)
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
          {canStop(agent, shownStop) ? <Button key="stop" hotkey="s" plain label="Stop" onPress={() => {}} /> : null}
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
function canStop(agent: Agent, control: StopControl | null): boolean {
  return !isEnded(agent.state) && (control?.agentId !== agent.id || control.step === 'armed')
}

/** What the Stop control says about this agent, if anything. */
function stopNote(control: StopControl | null, agent: Agent): string | undefined {
  if (control?.agentId !== agent.id) return undefined
  const { name } = agent.squishy
  if (control.step === 'armed') return `press s again to stop ${name}`
  // Once the agent has ended, its state and feed say how it went
  if (isEnded(agent.state)) return undefined
  if (control.step === 'stopping') return `Stopping ${name}…`
  const why = control.refusal === undefined ? '' : ` TaskStop didn't stop it: ${control.refusal}`
  return `Stopping ${name} at its next step: its tool calls are refused.${why}`
}

/** Back to the roster, leaving Stop as it was before the focus view opened. */
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
  await update($, stopControl, control => (control?.step === 'armed' ? null : control))
}

/** Arms Stop for an agent, until a second press or STOP_CONFIRM_MS. */
async function arm($: EngineInterface, agentId: string): Promise<void> {
  disarm?.cancel()
  await update($, stopControl, () => ({ agentId, step: 'armed' }))
  disarm = $.clock.after(STOP_CONFIRM_MS, () => {
    void update($, stopControl, control => (control?.agentId === agentId && control.step === 'armed' ? null : control))
  })
}

/**
 * Stops an agent through TaskStop, whose call the agent tracker sees, and
 * squishes the agent's squishy for. When TaskStop is refused, fails, or
 * leaves the agent running by the agent list, or gives no answer within
 * STOP_WAIT_MS, the tracker stops the agent at its next step instead.
 */
async function stop($: EngineInterface, agent: Agent): Promise<void> {
  disarm?.cancel()
  await update($, stopControl, () => ({ agentId: agent.id, step: 'stopping' }))
  let timer: Timer | undefined
  const late = new Promise<{ late: true }>(resolve => {
    timer = $.clock.after(STOP_WAIT_MS, () => resolve({ late: true }))
  })
  const asked = $.tool.call({ tool: 'TaskStop', task_id: agent.id }).then(
    result => ({ refusal: result.deny ?? (result.isError === true ? (result.text ?? String(result.result)) : undefined) }),
    (error: unknown) => ({ refusal: error instanceof Error ? error.message : String(error) }),
  )
  const answer = await Promise.race([asked, late])
  timer?.cancel()
  const refusal = 'refusal' in answer && answer.refusal !== undefined ? refusalLine(answer.refusal) : undefined
  if ('refusal' in answer && refusal === undefined && (await hasEnded($, agent.id))) {
    await addActivity($, agent.id, { kind: 'stopped' })
    await update($, stopControl, control => (control?.agentId === agent.id ? null : control))
    return
  }
  stopAtNextStep(agent.id)
  const atNextStep: StopControl = { agentId: agent.id, step: 'atNextStep', ...(refusal === undefined ? {} : { refusal }) }
  await update($, stopControl, () => atNextStep)
}

/** TaskStop's refusal as one printable line, cut short past REFUSAL_LIMIT. */
function refusalLine(refusal: string): string {
  const line = printable(refusal).replace(/\s+/g, ' ').trim()
  return line.length > REFUSAL_LIMIT ? `${cut(line, REFUSAL_LIMIT - 1)}…` : line
}

/** Whether the agent list says this agent has ended; no answer says it hasn't. */
async function hasEnded($: EngineInterface, agentId: string): Promise<boolean> {
  try {
    const status = (await $.agent.list()).find(each => each.id === agentId)?.status
    return status !== undefined && endedState(status) !== undefined
  } catch {
    return false
  }
}
