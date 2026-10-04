// The focus view: the pane mode given over to one agent, reached by picking
// its squishy. It shows the squishy at 2×, who the agent is, and the agent's
// live activity.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ActivityRow, SquishyState } from '../types'
import { PANE_ID, PICK_PREFIX, animatedPicture, pictureKey } from './pane'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const focusedAgentId = atom({ plugin: 'squishys', key: 'focusedAgentId' } as const, null)
const fedAgentIds = atom({ plugin: 'squishys', key: 'fedAgentIds' } as const, [])
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

/** How each state reads in the focus view. */
const STATE_NAMES: Record<SquishyState, string> = {
  working: 'Working',
  thinking: 'Thinking',
  needsYou: 'Needs you',
  asleep: 'Asleep',
  squished: 'Squished',
}

/** How each run that ended without an answer reads in the feed. */
const ENDED_ROWS = { interrupted: 'Interrupted', failed: 'Failed' } as const

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

/** A feed with a row added: only the latest answer kept, and only the latest FEED_ROWS rows. */
function withRow(feed: readonly ActivityRow[], row: ActivityRow): ActivityRow[] {
  const kept = row.kind === 'answer' ? feed.filter(each => each.kind !== 'answer') : feed
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

  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    const completed = await next(e)
    const row = rowAfterRun(e.reason, e.answer)
    if (e.agentId !== undefined && row !== undefined) await addActivity($, e.agentId, row)
    return completed
  })

  // The pick: a press on any Button keyed `squishy-<agent id>` (PICK_PREFIX:
  // a roster slot's, by click or digit) opens that agent's focus view. One
  // handler for every place a squishy can be picked from.
  on('ui.press', { plugin: 'squishys', element: /^squishy-/ }, async ($, e, next) => {
    const agentId = e.element.slice(PICK_PREFIX.length)
    await update($, focusedAgentId, () => agentId)
    await update($, mode, () => 'focus')
    return next(e)
  })

  // The focus view. Each mode's hook draws only while the pane is in that
  // mode and passes the drawing on otherwise; the pane's id is spelled out,
  // since the engine reads a matcher off this file alone.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'focus') return next(e)
    const { Box, Button, Markdown, Raster, Text } = $.ui.resolve(e)
    const id = await read($, focusedAgentId)
    const agent = (await read($, agents)).find(each => each.id === id)
    const back = <Button key="back" hotkey="r" plain label="Back to the roster" onPress={() => void update($, mode, () => 'roster')} />
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
    return (
      <Box key="focus" flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2}>
          <Raster key={pictureKey(agent.id, 'double')} {...animatedPicture(agent, 'double')} />
          <Box flexDirection="column">
            <Text bold>{agent.squishy.name}</Text>
            <Text>{STATE_NAMES[agent.state]}</Text>
            {agent.model !== undefined ? <Text dimColor>{agent.model}</Text> : null}
            <Text>{agent.description}</Text>
          </Box>
        </Box>
        {/* Stop (#12) and Redirect (#13) join the controls here. */}
        <Box key="controls" flexDirection="row" columnGap={2}>
          {back}
        </Box>
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
