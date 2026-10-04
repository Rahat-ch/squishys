import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { AGENT_CHECK_MS } from '../src/agents'
import { FRAME_MS } from '../src/pane'
import { PANE, PARTNERED, finishOf, spawnOf, stepOf, stubAgentList, stubBlits, stubSpawns, stubTurns } from './fixtures'
import { cellsOf, spawnAndWatch, watch } from './pictures'

test('a Working squishy wiggles on a timer, repainted by blits and never redrawn for a frame', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  const blits = stubBlits(on)
  const { picture, squishy } = await spawnAndWatch($)

  await clock.advance(FRAME_MS * 4)

  // Each wiggle frame holds for two ticks, and each change is one blit
  expect(blits).toEqual([
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'working', 2) },
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'working', 0) },
  ])
  expect(cellsOf(squishy, 'working', 2)).not.toBe(cellsOf(squishy, 'working', 0))
  // The drawing still holds the picture it was first drawn with
  expect(await picture()).toBe(cellsOf(squishy, 'working', 0))
})

// The kit waits out a stream left open before each act, so this test acts
// as little as it can while the response streams
test('a Thinking squishy bounces faster, changing every frame', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const blits = stubBlits(on)
  const { squishy } = await spawnAndWatch($)

  const response = $.turn.step(stepOf('agent-1'))
  await response.next()
  await clock.advance(FRAME_MS * 2)
  for await (const _ of response);

  expect(blits).toEqual([
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'thinking', 1) },
    { key: 'picture-agent-1', cells: cellsOf(squishy, 'thinking', 2) },
  ])
})

// Stands in for Claude Code's settings, its Reduce motion setting as
// `motion.reduced` says when the mod reads them, and for the session start
// and /config around them
function stubSettings(on: On, motion: { reduced: boolean }): void {
  on('settings.read', () => ({ value: { prefersReducedMotion: motion.reduced } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('config.set', ($, e) => ({ value: e.value }))
}

const SESSION_START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

// The user flipping Reduce motion in /config
function reduceMotion(value: boolean) {
  return {
    key: 'prefersReducedMotion',
    value,
    previous: !value,
    provider: { plugin: 'engine', tier: 'core' },
    origin: { kind: 'composer' },
  } as const
}

test('with Reduce motion on when the session starts, nothing animates', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, PARTNERED)
  stubSpawns(on)
  stubSettings(on, { reduced: true })
  const blits = stubBlits(on)
  await $.session.start(SESSION_START)
  const { picture, squishy } = await spawnAndWatch($)

  await clock.advance(FRAME_MS * 8)

  expect(blits).toEqual([])
  expect(await picture()).toBe(cellsOf(squishy, 'working', 0))
})

test('turning Reduce motion on in /config stops the animation at rest, and turning it off starts it again, with no restart', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, PARTNERED)
  stubSpawns(on)
  const motion = { reduced: false }
  stubSettings(on, motion)
  const blits = stubBlits(on)
  await $.session.start(SESSION_START)
  const { picture, squishy } = await spawnAndWatch($)
  await clock.advance(FRAME_MS * 2)
  expect(blits).toHaveLength(1)

  motion.reduced = true
  await $.config.set(reduceMotion(true))
  await clock.advance(FRAME_MS * 8)
  expect(blits).toHaveLength(1)
  expect(await picture()).toBe(cellsOf(squishy, 'working', 0))

  motion.reduced = false
  await $.config.set(reduceMotion(false))
  await clock.advance(FRAME_MS * 2)
  expect(blits).toHaveLength(2)
})

// The kit can't count a timer's periods beside mock.clock, so this checks
// what the timers do: repaint squishys and check the agent list
test('once no squishy is Working or Thinking, nothing repaints and the agent list is left alone', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  stubTurns(on)
  const checks = stubAgentList(on, new Map([['agent-1', 'running']]))
  const blits = stubBlits(on)
  await spawnAndWatch($)
  await clock.advance(AGENT_CHECK_MS)
  expect(blits.length).toBeGreaterThan(0)
  expect(checks()).toBe(1)

  await $.turn.complete(finishOf('agent-1'))
  const [blitsBefore, checksBefore] = [blits.length, checks()]
  await clock.advance(AGENT_CHECK_MS * 10)

  expect(blits).toHaveLength(blitsBefore)
  expect(checks()).toBe(checksBefore)
})

test('a squishy whose repaint is refused is left alone, and the others keep moving', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  stubSpawns(on)
  const blits = stubBlits(on, ['picture-agent-1'])
  await $.agent.spawn(spawnOf('toolu_1'))
  await $.agent.spawn(spawnOf('toolu_2'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const { squishy } = await watch(ui, 'agent-2')

  await clock.advance(FRAME_MS * 4)

  expect(blits).toEqual([
    { key: 'picture-agent-2', cells: cellsOf(squishy, 'working', 2) },
    { key: 'picture-agent-2', cells: cellsOf(squishy, 'working', 0) },
  ])
})
