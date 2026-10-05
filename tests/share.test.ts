// Share: the pixel card saved and copied (or shown where it can't be), then
// X's compose page opened with the share text and a reminder to paste the
// card, from the focus view of an agent whose squishy is Asleep and from a
// met species' card in the Squishydex.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'

import { shareCard } from '../src/card'
import { KIT, everySpecies } from '../src/kit'
import { REMEMBERED_KEY } from '../src/rebuild'
import type { Remembered } from '../src/rebuild'
import { legendaryKey, speciesSquishy, squishyOf } from '../src/roller'
import type { Squishy } from '../src/roller'
import { COPIED_NOTE, REPO_URL, SHARE_LINK_LABEL, agentShareKey, cardFileName, pasteReminder, speciesShareKey } from '../src/share'
import { speciesKey } from '../src/squishydex-record'
import { DEX_COLUMN_GAP, DEX_PLACE_COLUMNS, DEX_PLACE_ROWS } from '../src/squishydex'
import { PANE, PARTNERED, finishOf, paneSized, spawnOf, stubAgentList, stubSessionStart, stubSpawns, stubStore, stubTurns } from './fixtures'
import { decodePng } from './png-reader'

/** A command run, and how many runs had finished when it started. */
type Run = { argv: readonly string[]; init?: ProcessRunInit; finishedBefore: number }

/** What a process does when run: its result, or a refusal to start it. */
type Outcome = Partial<ProcessRunResult> | { deny: string }

/**
 * Stands in for the host running processes, as on `os` (what `uname -s`
 * says): the card's save prints the system's name and the path it wrote;
 * every other command succeeds. Each takes a few turns of the event loop to
 * finish, so a command started without waiting for the one before shows in
 * `finishedBefore`. `answers` overrides a command's outcome, by the command
 * (`argv[0]`, or for a script run through sh: `sh` for the save, `xdg-open`
 * for a Linux open and `clipboard` for the Linux copy). Reads back every run.
 */
function stubProcesses(on: On, os = 'Darwin', answers: Record<string, Outcome> = {}): Run[] {
  const runs: Run[] = []
  let finished = 0
  on('process.run', async ($, e) => {
    runs.push({ argv: e.argv, finishedBefore: finished, ...(e.init === undefined ? {} : { init: e.init }) })
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    finished += 1
    const command = commandOf(e.argv)
    const answer = answers[command]
    if (answer !== undefined && 'deny' in answer) return { deny: answer.deny }
    const stdout = command === 'sh' ? `${os}\n${savedPath(e.argv)}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })
  return runs
}

/** What a run runs: the command, or for one through sh, what its script does (the save, `sh`, unless it opens or copies). */
function commandOf(argv: readonly string[]): string {
  if (argv[0] !== 'sh') return argv[0] ?? ''
  const script = argv[2] ?? ''
  if (/xdg-open/.test(script)) return 'xdg-open'
  if (/wl-copy|xclip/.test(script)) return 'clipboard'
  return 'sh'
}

/** The share text's last line on macOS, and on Linux. */
const MAC_REMINDER = pasteReminder('⌘V')
const CTRL_REMINDER = pasteReminder('Ctrl+V')

/**
 * A post's length as X counts it, or a little over: two for each code point
 * outside the ranges X counts as one (so an emoji sequence counts more than
 * X's two), and the link as 23 plus the space X puts before it.
 */
function postLength(text: string): number {
  const counted = [...text].reduce((sum, character) => {
    const code = character.codePointAt(0) ?? 0
    const single = code <= 0x10ff || (code >= 0x2000 && code <= 0x200d) || (code >= 0x2010 && code <= 0x201f) || (code >= 0x2032 && code <= 0x2037)
    return sum + (single ? 1 : 2)
  }, 0)
  return counted + 1 + 23
}

/** The longest a post on X may be. */
const POST_LIMIT = 280

/** Where the stub says the save wrote: the file name it was given, under a folder of the user's own. */
function savedPath(argv: readonly string[]): string {
  return `/home/me/.cache/squishys/share/${argv.at(-1) ?? ''}`
}

function stubToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

/** The share text and link of an X compose URL, or undefined for any other URL. */
function composed(url: string | undefined): { text: string | null; url: string | null } | undefined {
  if (url === undefined || !url.startsWith('https://x.com/intent/post?')) return undefined
  const params = new URL(url).searchParams
  return { text: params.get('text'), url: params.get('url') }
}

/** The compose URL the runs opened, by `open` or `xdg-open`. */
function openedUrl(runs: readonly Run[]): string | undefined {
  return runs.map(run => run.argv.at(-1)).find(arg => arg?.startsWith('https://'))
}

/** The PNG the save was handed, as base64 on its standard input. */
function savedPng(runs: readonly Run[]): Uint8Array {
  const stdin = runs.find(run => commandOf(run.argv) === 'sh')?.init?.stdin ?? ''
  return Uint8Array.from(atob(stdin), character => character.charCodeAt(0))
}

/** The squishy the store keeps for an agent. */
function squishyOfAgent(stored: Map<string, unknown>, agentId: string): Squishy {
  const key = new Map(stored.get(REMEMBERED_KEY) as Remembered).get(agentId)
  const squishy = key === undefined ? undefined : squishyOf(KIT, key)
  if (squishy === undefined) throw new Error(`${agentId} has no squishy in the store`)
  return squishy
}

/** Spawns agent-1 with this description, finishes its run and opens its focus view. */
async function finishedAgent($: Engine, on: On, description = 'Find config parser') {
  const stored = stubStore(on)
  stubSpawns(on)
  stubTurns(on)
  await $.agent.spawn({ ...spawnOf('toolu_1'), description })
  await $.turn.complete(finishOf('agent-1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  return { ui, squishy: squishyOfAgent(stored, 'agent-1') }
}

test('Share works in the focus view, on x, only once the agent’s squishy is Asleep; before, it’s held', async ($, on) => {
  stubStore(on)
  stubSpawns(on)
  stubTurns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })
  expect(await ui.find({ type: 'Button', key: agentShareKey('agent-1') })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: `held-${agentShareKey('agent-1')}` }))?.props).toMatchObject({ label: 'Share (once Asleep)', hotkey: 'x', dimColor: true })

  await $.turn.complete(finishOf('agent-1'))

  const share = await ui.find({ type: 'Button', key: agentShareKey('agent-1') })
  expect(share?.props).toMatchObject({ label: 'Share', hotkey: 'x' })
})

test('a Squished squishy has no Share: x is held', async ($, on) => {
  stubStore(on)
  stubSpawns(on)
  stubTurns(on)
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-1' })

  await $.turn.complete(finishOf('agent-1', 'error'))

  expect(await ui.find({ type: 'Text', text: 'Squished' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: agentShareKey('agent-1') })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: `held-${agentShareKey('agent-1')}` }))?.props).toMatchObject({ label: 'Share (Squished)', hotkey: 'x', dimColor: true })
})

test('on macOS, one press saves the squishy’s card, copies it to the clipboard, then opens X’s compose page with what it finished and a paste reminder', async ($, on) => {
  const runs = stubProcesses(on, 'Darwin')
  const toasts = stubToasts(on)
  const { ui, squishy } = await finishedAgent($, on)
  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  // The card, written as a PNG of the squishy's own card
  const card = shareCard(KIT, squishy)
  const png = decodePng(savedPng(runs))
  expect(png).toMatchObject({ width: card.width, height: card.height })
  expect([...png.pixels]).toEqual([...card.pixels])
  // Copied from where it was saved, then, once the copy finished, the compose page opened, and nothing else
  const path = savedPath(runs[0]?.argv ?? [])
  expect(runs[1]?.argv[0]).toBe('osascript')
  expect(runs[1]?.argv).toContain(path)
  expect(runs[2]?.argv).toEqual(['open', openedUrl(runs)])
  expect(runs[2]?.finishedBefore).toBe(2)
  expect(runs).toHaveLength(3)
  expect(composed(openedUrl(runs))).toEqual({ text: `My squishy ${squishy.name} just finished: Find config parser 🥟${MAC_REMINDER}`, url: REPO_URL })
  expect(openedUrl(runs)).not.toMatch(/[\s⌘]/)
  expect(toasts).toEqual([COPIED_NOTE])
  // The browser opened, so no link is offered
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
})

test('on Linux, one press copies the card with wl-copy or xclip, then opens the compose page through xdg-open', async ($, on) => {
  const runs = stubProcesses(on, 'Linux')
  const toasts = stubToasts(on)
  const { ui, squishy } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  const path = savedPath(runs[0]?.argv ?? [])
  expect(runs.some(run => run.argv[0] === 'osascript')).toBe(false)
  // The copy, handed the card's path, tries Wayland's clipboard, then X11's
  const copy = runs[1]
  expect(commandOf(copy?.argv ?? [])).toBe('clipboard')
  expect(copy?.argv[2]).toContain('wl-copy --type image/png')
  expect(copy?.argv[2]).toContain('xclip -selection clipboard -t image/png')
  expect(copy?.argv.at(-1)).toBe(path)
  // Once the copy finished, the compose page, and nothing else
  expect(commandOf(runs[2]?.argv ?? [])).toBe('xdg-open')
  expect(runs[2]?.finishedBefore).toBe(2)
  expect(runs).toHaveLength(3)
  expect(composed(openedUrl(runs))).toEqual({ text: `My squishy ${squishy.name} just finished: Find config parser 🥟${CTRL_REMINDER}`, url: REPO_URL })
  expect(toasts).toEqual([COPIED_NOTE])
  // xdg-open runs in the background, so whether X opened is never known: the link is always offered
  const link = await ui.find({ type: 'Link' })
  expect(link?.props).toMatchObject({ href: openedUrl(runs), label: SHARE_LINK_LABEL })
})

test('on Linux without wl-copy or xclip, Share shows the card’s folder and path instead, and still opens the compose page', async ($, on) => {
  const runs = stubProcesses(on, 'Linux', { clipboard: { exitCode: 127, stderr: 'neither wl-copy nor xclip is installed' } })
  const toasts = stubToasts(on)
  await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  const path = savedPath(runs[0]?.argv ?? [])
  const folder = path.slice(0, path.lastIndexOf('/'))
  expect(commandOf(runs[2]?.argv ?? [])).toBe('xdg-open')
  expect(runs[2]?.argv.at(-1)).toBe(folder)
  expect(composed(openedUrl(runs))?.url).toBe(REPO_URL)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain(path)
  expect(toasts[0]).not.toContain(COPIED_NOTE)
  // Nothing was copied, so there's nothing to paste
  expect(composed(openedUrl(runs))?.text?.endsWith(' 🥟')).toBe(true)
})

test('the card is saved under a file name made from the squishy’s key', async ($, on) => {
  const runs = stubProcesses(on)
  stubToasts(on)
  const { squishy } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(runs[0]?.argv.at(-1)).toBe(cardFileName(squishy))
  expect(cardFileName(squishy)).toMatch(/^[a-z0-9-]+\.png$/i)
})

test('a long description is cut short in the share text', async ($, on) => {
  const runs = stubProcesses(on)
  stubToasts(on)
  const long = `Refactor the payment service ${'and its secrets '.repeat(20)}`
  const { ui, squishy } = await finishedAgent($, on, long)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  const text = composed(openedUrl(runs))?.text ?? ''
  expect(text.startsWith(`My squishy ${squishy.name} just finished: Refactor the payment service`)).toBe(true)
  expect(text).toContain('…')
  expect(text.endsWith(` 🥟${MAC_REMINDER}`)).toBe(true)
  expect(text.length).toBeLessThan(`My squishy ${squishy.name} just finished:  🥟${MAC_REMINDER}`.length + 80)
})

test('the longest share text, reminder and link included, fits in a post on X', async ($, on) => {
  // The longest-named legendary, shiny, with a description of characters X counts twice
  const legendary = [...KIT.legendaries].sort((a, b) => b.name.length - a.name.length)[0]
  if (legendary === undefined) throw new Error('The kit needs a legendary')
  const runs = stubProcesses(on)
  stubToasts(on)
  stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: [['agent-b', legendaryKey(legendary.id, true)]] })
  stubSessionStart(on)
  stubAgentList(on, [{ id: 'agent-b', description: '設定'.repeat(100), status: 'completed' }])
  await $.classic.SessionStart({ source: 'clear' })
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-b' })

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-b') })

  const text = composed(openedUrl(runs))?.text ?? ''
  expect(text).toContain(legendary.name)
  expect(text.endsWith(MAC_REMINDER)).toBe(true)
  expect(postLength(text)).toBeLessThanOrEqual(POST_LIMIT)
})

test('a description with a lone surrogate half still makes a compose page, the half replaced', async ($, on) => {
  const runs = stubProcesses(on)
  stubToasts(on)
  const { squishy } = await finishedAgent($, on, 'Fix \ud83d the build')

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(composed(openedUrl(runs))?.text).toBe(`My squishy ${squishy.name} just finished: Fix \ufffd the build 🥟${MAC_REMINDER}`)
})

test('a browser that won’t open on macOS still toasts the copied card, and offers the compose page as a link', async ($, on) => {
  stubProcesses(on, 'Darwin', { open: { exitCode: 1, stderr: 'No application knows how to open URL' } })
  const toasts = stubToasts(on)
  const { ui } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(toasts).toHaveLength(2)
  expect(toasts[0]).toBe(COPIED_NOTE)
  expect(toasts[1]).toContain('No application knows how to open URL')
  expect((await ui.find({ type: 'Link' }))?.props.label).toBe(SHARE_LINK_LABEL)
})

test('a card that can’t be saved says why in a toast, and the compose page still opens', async ($, on) => {
  const runs = stubProcesses(on, 'Darwin', { sh: { exitCode: 1, stdout: 'Darwin\n', stderr: 'No space left on device' } })
  const toasts = stubToasts(on)
  const { ui } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(runs.some(run => run.argv[0] === 'osascript')).toBe(false)
  expect(composed(openedUrl(runs))).toBeDefined()
  expect(toasts.join('\n')).toContain('No space left on device')
  expect(composed(openedUrl(runs))?.text?.endsWith(' 🥟')).toBe(true)
})

test('a card that wasn’t copied leaves the paste reminder out of the share text', async ($, on) => {
  const runs = stubProcesses(on, 'Darwin', { osascript: { exitCode: 1, stderr: 'Not authorized' } })
  stubToasts(on)
  const { squishy } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(composed(openedUrl(runs))?.text).toBe(`My squishy ${squishy.name} just finished: Find config parser 🥟`)
})

test('on a system Share has no clipboard step for, the card is saved and the share text has no paste reminder', async ($, on) => {
  stubProcesses(on, 'FreeBSD')
  const toasts = stubToasts(on)
  const { ui, squishy } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(toasts.join('\n')).toContain('Card saved to')
  const link = await ui.find({ type: 'Link' })
  expect(composed(String(link?.props.href))?.text).toBe(`My squishy ${squishy.name} just finished: Find config parser 🥟`)
})

test('a clipboard that refuses the card on macOS shows the card in Finder instead, and says where it is', async ($, on) => {
  const runs = stubProcesses(on, 'Darwin', { osascript: { exitCode: 1, stderr: 'Not authorized' } })
  const toasts = stubToasts(on)
  const { ui } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  const path = savedPath(runs[0]?.argv ?? [])
  expect(runs[2]?.argv).toEqual(['open', '-R', path])
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain(path)
})

test('where no process can run, Share says so in a toast and offers the compose page as a link', async ($, on) => {
  stubProcesses(on, 'Darwin', { sh: { deny: 'process.run is CLI only' }, open: { deny: 'process.run is CLI only' } })
  const toasts = stubToasts(on)
  const { ui, squishy } = await finishedAgent($, on)

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-1') })

  expect(toasts.join('\n')).toContain('CLI only')
  const link = await ui.find({ type: 'Link' })
  // No card was saved or copied, so the text has no paste reminder
  expect(composed(String(link?.props.href))?.text).toBe(`My squishy ${squishy.name} just finished: Find config parser 🥟`)
})

test('a shiny legendary shows its crown and sparkle in the share text', async ($, on) => {
  const [legendary] = KIT.legendaries
  if (legendary === undefined) throw new Error('The kit needs a legendary')
  const runs = stubProcesses(on)
  stubToasts(on)
  stubStore(on, { ...PARTNERED, [REMEMBERED_KEY]: [['agent-b', legendaryKey(legendary.id, true)]] })
  stubSessionStart(on)
  stubAgentList(on, [{ id: 'agent-b', description: 'Run the tests', status: 'completed' }])
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishy-agent-b' })

  await $.ui.press({ plugin: 'squishys', key: agentShareKey('agent-b') })

  const text = composed(openedUrl(runs))?.text ?? ''
  expect(text).toContain('👑')
  expect(text).toContain(`✨ ${legendary.name}`)
  expect(text).toContain('Run the tests')
})

test('a met species’ Squishydex card has Share, which shares what was met and the species count', async ($, on) => {
  const [starter] = KIT.starters
  const squishy = starter && speciesSquishy(KIT, starter, KIT.palettes[0]?.id)
  if (!squishy) throw new Error('The kit needs a starter')
  const runs = stubProcesses(on)
  stubToasts(on)
  stubStore(on, PARTNERED)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${speciesKey(squishy)}` })
  const share = await ui.find({ type: 'Button', key: speciesShareKey(squishy.key) })
  expect(share?.props).toMatchObject({ label: 'Share', hotkey: 'x' })

  await $.ui.press({ plugin: 'squishys', key: speciesShareKey(squishy.key) })

  expect(composed(openedUrl(runs))).toEqual({ text: `I met ${squishy.name} in squishys 🥟 · 1/${everySpecies(KIT).length} species${MAC_REMINDER}`, url: REPO_URL })
  expect([...decodePng(savedPng(runs)).pixels]).toEqual([...shareCard(KIT, squishy).pixels])
})

test('a legendary’s Squishydex card has no Share', async ($, on) => {
  const [legendary] = KIT.legendaries
  if (legendary === undefined) throw new Error('The kit needs a legendary')
  stubStore(on, { ...PARTNERED, squishydex: { species: {}, legendaries: { [legendary.id]: { met: 0 } } } })
  // Room for every place on one page, the legendaries after all the species
  const places = everySpecies(KIT).length + KIT.legendaries.length
  const roomy = paneSized({ placement: 'dock', bodyColumns: places * (DEX_PLACE_COLUMNS + DEX_COLUMN_GAP), bodyRows: places * DEX_PLACE_ROWS })
  const ui = await $.ui.mount({ ...roomy, surface: 'terminal' })
  await $.ui.press({ plugin: 'squishys', key: 'squishydex' })
  await $.ui.press({ plugin: 'squishys', key: `squishydex-pick-${legendaryKey(legendary.id)}` })

  expect(await ui.find({ type: 'Text', text: 'Not met shiny yet' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label)).not.toContain('Share')
})
