import { expect, mock, test } from 'claude-code/testing'

import { PANE_ID } from '../src/pane'
import { PANE, SQUISHYS_COMMAND, spawnOf, stubPanes, stubSpawns } from './fixtures'

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
  const { panes, opens } = stubPanes(on)

  await $.command.run(SQUISHYS_COMMAND)
  expect(opens.map(open => open.focus)).toEqual([true])
  expect([...panes.keys()]).toEqual([PANE_ID])

  // Typing the command handed the keyboard back to the prompt
  panes.set(PANE_ID, { isPlaced: true, isFocused: false })
  await $.command.run(SQUISHYS_COMMAND)
  expect([...panes.keys()]).toEqual([])
})

test('/squishys gives the keyboard to a pane that opened unasked rather than closing it, and closes it the next time', async ($, on) => {
  mock.store(on)
  stubSpawns(on)
  const { panes, opens } = stubPanes(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  expect(opens.map(open => open.focus)).toEqual([undefined])
  expect(panes.get(PANE_ID)?.isFocused).toBe(false)

  await $.command.run(SQUISHYS_COMMAND)
  expect(opens.map(open => open.focus)).toEqual([undefined, true])
  expect(panes.get(PANE_ID)?.isFocused).toBe(true)

  panes.set(PANE_ID, { isPlaced: true, isFocused: false })
  await $.command.run(SQUISHYS_COMMAND)
  expect([...panes.keys()]).toEqual([])
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
