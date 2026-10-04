import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, SQUISHYS_COMMAND, spawnOf } from './fixtures'

// Stands in for Claude Code's panes: which ids are open right now
function stubPanes(on: On): Set<string> {
  const open = new Set<string>()
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  return open
}

test('/squishys is registered when the session starts', async ($, on) => {
  const registered: string[] = []
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(registered).toContain('squishys')
})

test('/squishys opens the pane and running it again closes it', async ($, on) => {
  const open = stubPanes(on)

  await $.command.run(SQUISHYS_COMMAND)
  expect([...open]).toEqual(['squishys'])

  await $.command.run(SQUISHYS_COMMAND)
  expect([...open]).toEqual([])
})

test('off the terminal, the pane is Claude Code’s own drawing', async ($, on) => {
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-1' }))
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
