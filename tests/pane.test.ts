import { expect, mock, test } from 'claude-code/testing'
import type { On, PaneOpenArgs } from 'claude-code'

import { PANE_ID } from '../src/pane'
import { PANE, SQUISHYS_COMMAND, spawnOf, stubSpawns } from './fixtures'

// Stands in for Claude Code's panes: which ids are open right now, and
// whether each has the keyboard. An open with `focus` gives it the keyboard,
// as Claude Code does over an empty prompt; the test takes it back by
// setting it false, as the user's Esc or typing does. Reads back every open.
function stubPanes(on: On): { focused: Map<string, boolean>; opens: PaneOpenArgs[] } {
  const focused = new Map<string, boolean>()
  const opens: PaneOpenArgs[] = []
  on('ui.panes', () => ({
    value: [...focused].map(([id, isFocused]) => ({ id, title: id, isShown: true, isFocused, isPlaced: true })),
  }))
  on('ui.open', ($, e) => {
    opens.push(e)
    focused.set(e.id, e.focus === true || focused.get(e.id) === true)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    focused.delete(e.id)
    return { value: undefined }
  })
  return { focused, opens }
}

test('/squishys is registered when the session starts, to run even mid-turn', async ($, on) => {
  const registered: { name: string; immediate?: true }[] = []
  on('command.register', ($, e) => {
    registered.push({ name: e.name, immediate: e.immediate })
    return { value: { command: e.name } }
  })
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(registered).toContainEqual({ name: 'squishys', immediate: true })
})

test('/squishys opens the pane with the keyboard, and running it again closes it', async ($, on) => {
  const { focused, opens } = stubPanes(on)

  await $.command.run(SQUISHYS_COMMAND)
  expect(opens.map(open => open.focus)).toEqual([true])
  expect([...focused.keys()]).toEqual([PANE_ID])

  // Typing the command handed the keyboard back to the prompt
  focused.set(PANE_ID, false)
  await $.command.run(SQUISHYS_COMMAND)
  expect([...focused.keys()]).toEqual([])
})

test('/squishys gives the keyboard to a pane that opened unasked rather than closing it, and closes it the next time', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const { focused, opens } = stubPanes(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  expect(opens.map(open => open.focus)).toEqual([undefined])
  expect(focused.get(PANE_ID)).toBe(false)

  await $.command.run(SQUISHYS_COMMAND)
  expect(opens.map(open => open.focus)).toEqual([undefined, true])
  expect(focused.get(PANE_ID)).toBe(true)

  focused.set(PANE_ID, false)
  await $.command.run(SQUISHYS_COMMAND)
  expect([...focused.keys()]).toEqual([])
})

test('/squishys closes a pane that has the keyboard', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const { focused } = stubPanes(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  // The user gave it the keyboard themselves (ctrl+x tab, or a click)
  focused.set(PANE_ID, true)

  await $.command.run(SQUISHYS_COMMAND)

  expect([...focused.keys()]).toEqual([])
})

test('off the terminal, the pane is Claude Code’s own drawing', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  // Stands for what Claude Code would draw in the pane
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

  await $.agent.spawn(spawnOf('toolu_1'))

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})
