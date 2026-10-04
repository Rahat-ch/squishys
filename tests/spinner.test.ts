import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { SIDES } from '../src/composer'
import { KIT } from '../src/kit'
import { PARTNER_KEY, partnerFrom } from '../src/partner'
import { GLYPH_COLUMNS, PARTNER_MINI, SPINNER_LINE_ROW, STATS_COLUMNS } from '../src/spinner'
import { miniRows } from '../src/spinner-mini'
import { SQUISHY_VERBS } from '../src/verbs'
import { PARTNERED, spawnOf, stubSessionStart, stubSpawns, stubStore } from './fixtures'

// The spinner's props as Claude Code passes them as a turn starts
const SPINNER: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: null, suffix: '…', mode: 'requesting' }

// The orchestrator's spinner, by a spinner id no agent has
const ORCHESTRATOR_SPINNER = 'orchestrator'

// The terminal's width, wide enough for a spinner line with the mini
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
  return `${'✶'.padEnd(GLYPH_COLUMNS)}${props.message ?? props.word}${props.suffix}${STATS}`
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

// The cells of the drawn mini, row by row: each row's Texts, glyph and colors
function rowsIn(mini: { children?: unknown[] } | undefined): unknown[][] {
  const rows = (mini?.children ?? []) as { children: { props: object; children: string[] }[] }[]
  return rows.map(row => row.children.map(cell => ({ glyph: cell.children.join(''), ...cell.props })))
}

const PARTNER = partnerFrom(PARTNERED[PARTNER_KEY])

// The mini's rows and columns: the partner's mini picture, a row of text to two pixels
const MINI_ROWS = Math.ceil(SIDES.mini / 2)
const MINI_COLUMNS = SIDES.mini

// Mounts the orchestrator's spinner with a partner saved, and takes apart
// what the mod drew: the rows above Claude Code's drawing, the drawing, the
// mini's Box over them, and the spinner line Claude Code was asked to draw
async function drawnWithMini($: Parameters<TestBody>[0], on: On, props = SPINNER) {
  stubStore(on, PARTNERED)
  const asked: RenderPropsOf['Spinner'][] = []
  stubSpinner(on, asked)
  const ui = await $.ui.mount({ ...spinnerOn('terminal'), props })
  const drawn = (await ui.drawn()) as { type: string; props: Record<string, unknown>; children: { type: string; props: Record<string, unknown>; children: unknown[] }[] }
  const claudeProps = asked.at(-1)
  if (claudeProps === undefined) throw new Error('Claude Code was never asked to draw')
  const mini = drawn.children.at(-1)
  return {
    ui,
    drawn,
    above: drawn.children.slice(0, -2),
    claudeSpinner: drawn.children.at(-2),
    claudeProps,
    mini,
    left: Number(mini?.props.left),
    line: spinnerLineOf(claudeProps),
  }
}

test('the partner’s mini stands on the orchestrator’s spinner line, right after the verb and before Claude Code’s stats', async ($, on) => {
  const { ui, drawn, above, claudeSpinner, claudeProps, mini, left, line } = await drawnWithMini($, on)

  if (PARTNER === undefined) throw new Error('PARTNERED names no partner the kit can make')
  expect(drawn).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
  // The mini is the band's picture, as colored half-block Text
  const rows = miniRows(KIT, PARTNER)
  expect(rows).toHaveLength(MINI_ROWS)
  expect(rowsIn(await ui.find({ key: PARTNER_MINI }))).toEqual(rows)
  expect(mini).toMatchObject({ type: 'Box', props: { key: PARTNER_MINI, position: 'absolute', top: 0 } })
  // Its last row is the spinner line's, so it covers no row below the line (the tip)
  expect(above.length + SPINNER_LINE_ROW).toBe(MINI_ROWS - 1)
  above.forEach(row => expect(row).toMatchObject({ type: 'Text', children: [' '] }))
  // On the line: the glyph and the verb, the mini over blank columns, then the stats
  expect(claudeSpinner).toEqual(spinnerOf(claudeProps))
  expect(line.slice(0, left)).toBe(`${'✶'.padEnd(GLYPH_COLUMNS)}${claudeProps.word}… `)
  expect(line.slice(left, left + MINI_COLUMNS)).toBe(' '.repeat(MINI_COLUMNS))
  expect(line.slice(left + MINI_COLUMNS)).toBe(STATS)
})

test('a message that ends in an ellipsis gets no second one before the mini', async ($, on) => {
  const message = 'Compacting conversation…'
  const { left, line } = await drawnWithMini($, on, { ...SPINNER, message })

  expect(line.slice(0, left)).toBe(`${'✶'.padEnd(GLYPH_COLUMNS)}${message} `)
  expect(line.slice(left).trimStart()).toBe(STATS.trimStart())
})

test('on a terminal too narrow for the line, the mini and the stats, the spinner is Claude Code’s, squishy verb aside', async ($, on) => {
  stubStore(on, PARTNERED)
  const words = stubSpinner(on)

  // One column short of the glyph, the shortest word or verb with its
  // ellipsis and a space, the mini and the stats
  const shortest = Math.min(SPINNER.word.length, ...VERBS.map(verb => verb.length))
  const narrow = GLYPH_COLUMNS + shortest + 2 + MINI_COLUMNS + STATS_COLUMNS - 1
  const ui = await $.ui.mount(spinnerOn('terminal', ORCHESTRATOR_SPINNER, narrow))
  for (const word of turnWords(10)) {
    await ui.redraw({ ...SPINNER, word })
    expect(await ui.find({ key: PARTNER_MINI })).toBeUndefined()
    expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
  }
  // A terminal without its width measured gets no mini either
  const unmeasured = await $.ui.mount({ plugin: 'squishys', surface: 'terminal', component: 'Spinner', requestId: 'orchestrator-unmeasured', props: SPINNER })
  expect(await unmeasured.find({ key: PARTNER_MINI })).toBeUndefined()
})

test('with no partner saved, no mini is drawn and Claude Code’s line is left as it was', async ($, on) => {
  mock.store(on)
  const words = stubSpinner(on)

  const ui = await $.ui.mount(spinnerOn('terminal'))

  expect(await ui.find({ key: PARTNER_MINI })).toBeUndefined()
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

test('an agent’s spinner gets squishy verbs too, but no mini: the partner stands for the orchestrator', async ($, on) => {
  stubStore(on, PARTNERED)
  stubSpawns(on)
  const words = stubSpinner(on)

  await $.agent.spawn(spawnOf('toolu_1'))
  const turns = turnWords(60)
  const ui = await $.ui.mount(spinnerOn('terminal', 'agent-1'))
  for (const word of turns) await ui.redraw({ ...SPINNER, word })

  expect(await ui.find({ key: PARTNER_MINI })).toBeUndefined()
  expect(await ui.drawn()).toEqual(spinnerOf({ ...SPINNER, word: words.at(-1) ?? '' }))
  expect(words.slice(-turns.length).some(word => VERBS.includes(word))).toBe(true)
  // The orchestrator's spinner still carries the mini
  const orchestrator = await $.ui.mount(spinnerOn('terminal'))
  expect(await orchestrator.find({ key: PARTNER_MINI })).toBeDefined()
})

for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
  test(`on ${surface}, the spinner is Claude Code’s alone: no squishy verbs and no mini`, async ($, on) => {
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
