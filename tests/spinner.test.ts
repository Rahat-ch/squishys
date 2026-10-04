import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { tinyFace } from '../src/face'
import { KIT } from '../src/kit'
import { PARTNER_KEY, partnerFrom } from '../src/partner'
import { PARTNER_FACE, SQUISHY_VERBS } from '../src/spinner'
import { PARTNERED, stubStore } from './fixtures'

// The spinner's props as Claude Code passes them as a turn starts
const SPINNER: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: null, suffix: '…', mode: 'requesting' }

// The orchestrator's spinner (its requestId is the agent id), on a surface
function spinnerOn<S extends 'terminal' | 'desktop'>(surface: S) {
  return { plugin: 'squishys', surface, component: 'Spinner', requestId: 'orchestrator', props: SPINNER } as const
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

// The cells of a drawn tiny face: each row's Texts, glyph and colors
function cellsIn(face: { children: unknown[] } | undefined): unknown[] {
  const rows = (face?.children ?? []) as { children: { props: object; children: string[] }[] }[]
  return rows.flatMap(row => row.children.map(cell => ({ glyph: cell.children.join(''), ...cell.props })))
}

const PARTNER = partnerFrom(PARTNERED[PARTNER_KEY])

test('the partner’s tiny face is drawn beside Claude Code’s own spinner, which is otherwise unchanged', async ($, on) => {
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

test('some turns, the spinner shows a squishy verb in place of Claude Code’s word, and otherwise leaves the word alone', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  const turns = turnWords(120)
  const ui = await $.ui.mount(spinnerOn('terminal'))
  for (const word of turns) await ui.redraw({ ...SPINNER, word })

  const shown = words.slice(-turns.length)
  const verbs: readonly string[] = SQUISHY_VERBS
  shown.forEach((word, turn) => expect(word === turns[turn] || verbs.includes(word)).toBe(true))
  // A modest share: about one turn in three
  const swapped = shown.filter(word => verbs.includes(word)).length
  expect(swapped).toBeGreaterThan(turns.length / 8)
  expect(swapped).toBeLessThan(turns.length / 2)
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

test('on the desktop, the spinner is Claude Code’s alone: no squishy verbs and no face', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  const turns = turnWords(30)
  const ui = await $.ui.mount(spinnerOn('desktop'))
  for (const word of turns) {
    await ui.redraw({ ...SPINNER, word })
    expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word }))
  }

  expect(words.slice(-turns.length)).toEqual(turns)
  expect(await ui.find({ key: PARTNER_FACE })).toBeUndefined()
})
