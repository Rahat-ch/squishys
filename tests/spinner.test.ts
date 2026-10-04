import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { tinyFace } from '../src/face'
import { KIT } from '../src/kit'
import { PARTNER_KEY, partnerFrom } from '../src/partner'
import { PARTNER_FACE } from '../src/spinner'
import { SQUISHY_VERBS } from '../src/verbs'
import { PARTNERED, spawnOf, stubSessionStart, stubSpawns, stubStore } from './fixtures'

// The spinner's props as Claude Code passes them as a turn starts
const SPINNER: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: null, suffix: '…', mode: 'requesting' }

// The orchestrator's spinner, by a spinner id no agent has
const ORCHESTRATOR_SPINNER = 'orchestrator'

// A spinner on a surface, by its spinner id (the engine's requestId)
function spinnerOn<S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>(surface: S, spinnerId = ORCHESTRATOR_SPINNER) {
  return { plugin: 'squishys', surface, component: 'Spinner', requestId: spinnerId, props: SPINNER } as const
}

// What Claude Code draws for its spinner, given these props
function spinnerOf(props: RenderPropsOf['Spinner']) {
  return { type: 'Text' as const, props: {}, children: [`${props.message ?? props.word}${props.suffix}`] }
}

// Stands in for Claude Code drawing its spinner beneath the mod, keeping
// the word it was asked to draw each time
function stubSpinner(on: On): string[] {
  const words: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    words.push(e.props.word)
    return spinnerOf(e.props)
  })
  return words
}

// A word Claude Code might sample for each of `turns` turns
function turnWords(turns: number): string[] {
  return Array.from({ length: turns }, (_, turn) => `Sauteing${turn}`)
}

const VERBS: readonly string[] = SQUISHY_VERBS

// The cells of a drawn tiny face: each row's Texts, glyph and colors
function cellsIn(face: { children: unknown[] } | undefined): unknown[] {
  const rows = (face?.children ?? []) as { children: { props: object; children: string[] }[] }[]
  return rows.flatMap(row => row.children.map(cell => ({ glyph: cell.children.join(''), ...cell.props })))
}

const PARTNER = partnerFrom(PARTNERED[PARTNER_KEY])

test('the partner’s tiny face is drawn beside the orchestrator’s spinner, which is otherwise Claude Code’s', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  const ui = await $.ui.mount(spinnerOn('terminal'))

  if (PARTNER === undefined) throw new Error('PARTNERED names no partner the kit can make')
  const face = tinyFace(KIT, PARTNER)
  expect(face.length).toBeGreaterThan(0)
  expect(cellsIn(await ui.find({ key: PARTNER_FACE }))).toEqual(face.flat())
  const drawn = await ui.drawn()
  expect(drawn).toMatchObject({ type: 'Box', props: { flexDirection: 'row' } })
  expect('children' in drawn ? drawn.children?.[1] : undefined).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
})

test('with no partner saved, no face is drawn', async ($, on) => {
  mock.store(on)
  const words = stubSpinner(on)

  const ui = await $.ui.mount(spinnerOn('terminal'))

  expect(await ui.find({ key: PARTNER_FACE })).toBeUndefined()
  expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
})

test('a store that can’t be read leaves Claude Code’s spinner as it drew it, squishy verbs and all', async ($, on) => {
  on('store.get', () => {
    throw new Error('The store is locked')
  })
  const words = stubSpinner(on)

  const ui = await $.ui.mount(spinnerOn('terminal'))
  const shown: unknown[] = []
  for (const word of turnWords(60)) {
    await ui.redraw({ ...SPINNER, word })
    const drawn = await ui.drawn()
    expect(drawn).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
    shown.push(words.at(-1))
  }
  expect(shown.some(word => VERBS.includes(String(word)))).toBe(true)
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

test('an agent’s spinner gets squishy verbs too, but no face: the partner stands for the orchestrator', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  const words = stubSpinner(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  const turns = turnWords(60)
  const ui = await $.ui.mount(spinnerOn('terminal', 'agent-1'))
  for (const word of turns) await ui.redraw({ ...SPINNER, word })

  expect(await ui.find({ key: PARTNER_FACE })).toBeUndefined()
  expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
  expect(words.slice(-turns.length).some(word => VERBS.includes(word))).toBe(true)
  // The orchestrator's spinner still carries the face
  const orchestrator = await $.ui.mount(spinnerOn('terminal'))
  expect(await orchestrator.find({ key: PARTNER_FACE })).toBeDefined()
})

for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
  test(`on ${surface}, the spinner is Claude Code’s alone: no squishy verbs and no face`, async ($, on) => {
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
