// The focus view: the pane mode given over to one agent, reached by picking
// its squishy. It shows the squishy at 2×, who the agent is, and the agent's
// live activity.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ActivityRow, SquishyState } from '../types'
import { animatedPicture } from './pane'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')
const focusedAgentId = atom({ plugin: 'squishys', key: 'focusedAgentId' } as const, null)
const activity = atom({ plugin: 'squishys', key: 'activity' } as const, {})

/** How many of its latest rows each agent's feed keeps. */
export const FEED_ROWS = 50

/** The most characters a Markdown draws. */
const MARKDOWN_LIMIT = 10_000

/** What ends an answer cut to fit a Markdown. */
const CUT_SHORT = '\n\n… (cut short)'

/** The longest a tool call's summary runs, in characters. */
const SUMMARY_LIMIT = 80

/** The arguments that say most about a tool call, the most telling first. */
const TELLING_ARGUMENTS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill']

/**
 * What a Button that picks a squishy is keyed: this, then its agent's id.
 * Any Button in the pane keyed so picks that agent.
 */
export const PICK_PREFIX = 'squishy-'

/** How each state reads in the focus view. */
const STATE_NAMES: Record<SquishyState, string> = {
  working: 'Working',
  thinking: 'Thinking',
  needsYou: 'Needs you',
  asleep: 'Asleep',
  squished: 'Squished',
}

/**
 * A short line of what a tool was called on: its most telling argument
 * (a command, a path, a pattern), else its first string argument.
 */
export function summaryOf(call: Record<string, unknown>): string {
  const strings = Object.entries(call).filter(
    (entry): entry is [string, string] => !['tool', 'tool_use_id', 'agentId'].includes(entry[0]) && typeof entry[1] === 'string',
  )
  const telling = TELLING_ARGUMENTS.map(name => strings.find(([key]) => key === name)).find(found => found !== undefined)
  const line = (telling ?? strings[0])?.[1].replace(/\s+/g, ' ').trim() ?? ''
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT - 1)}…` : line
}

/** An answer as a Markdown can draw it: cut short, and saying so, past its limit. */
function drawable(answer: string): string {
  return answer.length > MARKDOWN_LIMIT ? answer.slice(0, MARKDOWN_LIMIT - CUT_SHORT.length) + CUT_SHORT : answer
}

export function registerFocus(on: On): void {
  // The agent tracker's hooks on these events are the unmatched ones, so
  // the feed's hooks match agents' events alone. The tracker's run first,
  // so an agent first seen through this tool call already has its squishy.
  on('tool.call', { agentId: /./ }, async ($, e, next) => {
    if (e.agentId !== undefined) await addActivity($, e.agentId, { kind: 'tool', tool: e.tool, summary: summaryOf({ ...e }) })
    return next(e)
  })

  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined && e.answer.trim() !== '') {
      await addActivity($, e.agentId, { kind: 'answer', text: drawable(e.answer) })
    }
    return completed
  })

  // The pick: a press on any Button keyed `squishy-<agent id>` (a roster
  // slot's, by click or digit) opens that agent's focus view. One handler
  // for every place a squishy can be picked from.
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
    const feed = (await read($, activity))[agent.id] ?? []
    return (
      <Box key="focus" flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2}>
          <Raster key={`focus-picture-${agent.id}`} {...animatedPicture(agent, `focus-picture-${agent.id}`, 'double')} />
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
          {feed.map((row, index) =>
            row.kind === 'tool' ? (
              <Box key={`activity-${index}`} flexDirection="row" columnGap={1}>
                <Text bold>{row.tool}</Text>
                <Text dimColor wrap="truncate-end">
                  {row.summary}
                </Text>
              </Box>
            ) : (
              <Markdown key={`activity-${index}`} text={row.text} />
            ),
          )}
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

/** Adds a row to an agent's feed, dropping its oldest past FEED_ROWS; agents without a squishy are left out. */
async function addActivity($: EngineInterface, agentId: string, row: ActivityRow): Promise<void> {
  if (!(await read($, agents)).some(agent => agent.id === agentId)) return
  await update($, activity, feeds => ({ ...feeds, [agentId]: [...(feeds[agentId] ?? []), row].slice(-FEED_ROWS) }))
}
