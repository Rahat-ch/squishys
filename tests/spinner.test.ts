import { expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { SQUISHY_VERBS } from '../src/verbs'
import { PARTNERED, spawnOf, stubSessionStart, stubSpawns, stubStore } from './fixtures'

// The spinner's props as Claude Code passes them as a turn starts
const SPINNER: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: null, suffix: '…', mode: 'requesting' }

// The orchestrator's spinner, by a spinner id no agent has
const ORCHESTRATOR_SPINNER = 'orchestrator'

// The terminal's width
const COLUMNS = 120

// A spinner on a surface, by its spinner id (the engine's requestId), on a
// terminal `columns` wide
function spinnerOn<S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>(surface: S, spinnerId = ORCHESTRATOR_SPINNER, columns = COLUMNS) {
  return { plugin: 'squishys', surface, component: 'Spinner', requestId: spinnerId, viewport: { columns, rows: 40 }, props: SPINNER } as const
}

// What Claude Code's stats say after the suffix
const STATS = ' (4s · ↓ 344 tokens)'

// The spinner line Claude Code draws for these props: its glyph, the word
// (or message) and suffix, then the stats
function spinnerLineOf(props: RenderPropsOf['Spinner']): string {
  return `✶ ${props.message ?? props.word}${props.suffix}${STATS}`
}

// What Claude Code draws for its spinner, given these props
function spinnerOf(props: RenderPropsOf['Spinner']) {
  return { type: 'Text' as const, props: {}, children: [spinnerLineOf(props)] }
}

// Stands in for Claude Code drawing its spinner beneath the mod, keeping
// the word it was asked to draw each time
function stubSpinner(on: On, asked: RenderPropsOf['Spinner'][] = []): string[] {
  const words: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    words.push(e.props.word)
    asked.push(e.props)
    return spinnerOf(e.props)
  })
  return words
}

// A word Claude Code might sample for each of `turns` turns
function turnWords(turns: number): string[] {
  return Array.from({ length: turns }, (_, turn) => `Sauteing${turn}`)
}

const VERBS: readonly string[] = SQUISHY_VERBS

// Terminal widths from too narrow for any spinner line to far wider than one
const WIDTHS = [40, 70, COLUMNS, 400]

test('with a partner saved, the orchestrator’s spinner is Claude Code’s own drawing at any width, squishy verb aside', async ($, on) => {
  stubStore(on, PARTNERED)
  const asked: RenderPropsOf['Spinner'][] = []
  const words = stubSpinner(on, asked)

  for (const columns of WIDTHS) {
    const ui = await $.ui.mount(spinnerOn('terminal', `${ORCHESTRATOR_SPINNER}-${columns}`, columns))
    for (const word of turnWords(10)) {
      await ui.redraw({ ...SPINNER, word })
      // Claude Code is asked for its spinner as it was, the word aside
      // (suffix and all), and what it draws is all that's drawn
      expect(asked.at(-1)).toEqual({ ...SPINNER, word: words.at(-1) })
      expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
    }
  }
})

test('a message that ends in an ellipsis reaches Claude Code as it was', async ($, on) => {
  stubStore(on, PARTNERED)
  const asked: RenderPropsOf['Spinner'][] = []
  stubSpinner(on, asked)

  const message = 'Compacting conversation…'
  await $.ui.mount({ ...spinnerOn('terminal'), props: { ...SPINNER, message } })

  expect(asked.at(-1)).toMatchObject({ message, suffix: SPINNER.suffix })
})

test('a terminal that hasn’t measured its width gets Claude Code’s spinner, squishy verb aside', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  const ui = await $.ui.mount({ plugin: 'squishys', surface: 'terminal', component: 'Spinner', requestId: 'orchestrator-unmeasured', props: SPINNER })

  expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
})

test('with no store answered, the spinner still shows squishy verbs some turns', async ($, on) => {
  const words = stubSpinner(on)

  const ui = await $.ui.mount(spinnerOn('terminal'))
  const shown: string[] = []
  for (const word of turnWords(60)) {
    await ui.redraw({ ...SPINNER, word })
    expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
    shown.push(words.at(-1) ?? '')
  }
  expect(shown.some(word => VERBS.includes(word))).toBe(true)
})

test('some turns, the spinner shows a squishy verb in place of Claude Code’s word, and otherwise leaves the word alone', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  const turns = turnWords(60)
  const ui = await $.ui.mount(spinnerOn('terminal'))
  for (const word of turns) await ui.redraw({ ...SPINNER, word })

  const shown = words.slice(-turns.length)
  shown.forEach((word, turn) => expect(word === turns[turn] || VERBS.includes(word)).toBe(true))
  expect(shown.some(word => VERBS.includes(word))).toBe(true)
  expect(shown.some((word, turn) => word === turns[turn])).toBe(true)
})

test('a turn keeps its word, or its squishy verb, however often the spinner draws again', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  const ui = await $.ui.mount(spinnerOn('terminal'))
  for (const word of turnWords(30)) {
    const drawnBefore = words.length
    for (const mode of ['requesting', 'thinking', 'responding', 'tool-input', 'tool-use'] as const) {
      await ui.redraw({ ...SPINNER, word, mode })
      await ui.redraw({ ...SPINNER, word, mode, message: 'Compacting conversation' })
    }
    expect(new Set(words.slice(drawnBefore)).size).toBe(1)
  }
})

test('an agent’s spinner gets squishy verbs too, and is otherwise Claude Code’s', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  const words = stubSpinner(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  const turns = turnWords(60)
  const ui = await $.ui.mount(spinnerOn('terminal', 'agent-1'))
  for (const word of turns) await ui.redraw({ ...SPINNER, word })

  expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
  expect(words.slice(-turns.length).some(word => VERBS.includes(word))).toBe(true)
})

for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
  test(`on ${surface}, the spinner is Claude Code’s alone: no squishy verbs`, async ($, on) => {
    stubStore(on, PARTNERED)
    const words = stubSpinner(on)

    const turns = turnWords(30)
    const ui = await $.ui.mount(spinnerOn(surface))
    for (const word of turns) {
      await ui.redraw({ ...SPINNER, word })
      expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word }))
    }

    expect(words.slice(-turns.length)).toEqual(turns)
  })
}

test('a claude -p run, which draws nowhere, asks for no spinner', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  stubSessionStart(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('settings.read', () => ({ value: {} }))
  const words = stubSpinner(on)

  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await $.agent.spawn(spawnOf('toolu_1'))

  expect(words).toEqual([])
})
