// Share: posts a squishy to X, by the user's own hand. A press of Share (in
// the focus view of an agent whose squishy is Asleep, or on a met species'
// Squishydex card) saves the squishy's pixel card (src/card.ts) as a PNG,
// copies it to the clipboard on macOS or shows where it is elsewhere, and
// opens X's compose page with the share text filled in. Nothing is ever
// posted: the user reviews the text, attaches the card and posts it.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Squishy } from '../types'
import { shareCard } from './card'
import { KIT } from './kit'
import { encodePng } from './png'
import { base64Of } from './raster'
import { SHINY_MARK, squishyOf } from './roller'
import { SQUISHYDEX_KEY, progressOf, squishydexFrom } from './squishydex-record'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

/** The hotkey of Share, wherever it shows. */
export const SHARE_HOTKEY = 'x'

/** What every Share Button is keyed with, then `agent-<agent id>` or `species-<squishy key>`. */
const SHARE_PREFIX = 'share-'
const AGENT_SHARE = `${SHARE_PREFIX}agent-`
const SPECIES_SHARE = `${SHARE_PREFIX}species-`

/** The key of the Share Button in an agent's focus view. */
export function agentShareKey(agentId: string): string {
  return AGENT_SHARE + agentId
}

/** The key of the Share Button on a species' Squishydex card, for the squishy the card draws. */
export function speciesShareKey(squishyKey: string): string {
  return SPECIES_SHARE + squishyKey
}

/** Where a share's link goes: the mod's own repository. */
export const REPO_URL = 'https://github.com/Rahat-ch/squishys'

/**
 * The longest a task description runs in the share text, in characters: it
 * can hold private project details, so only its start goes in the compose
 * box, for the user to review.
 */
const TASK_LIMIT = 60

/** How long each command Share runs may take. */
const RUN_TIMEOUT_MS = 10_000

/**
 * Saves the card, its PNG arriving as base64 on standard input, under
 * `squishys-share` in the temp dir, named by `$1`. It prints the system's
 * name first (`uname -s`: macOS is Darwin), then the path written once it
 * is. macOS's base64 decodes with `-D` (old releases know no `-d`), GNU's
 * and BusyBox's with `-d`.
 */
const SAVE_SCRIPT = [
  'os=$(uname -s)',
  'printf "%s\\n" "$os"',
  'dir="${TMPDIR:-/tmp}"',
  'dir="${dir%/}/squishys-share"',
  'case "$os" in Darwin) flag=-D ;; *) flag=-d ;; esac',
  'mkdir -p "$dir" && base64 "$flag" > "$dir/$1" && printf "%s\\n" "$dir/$1"',
].join('\n')

/**
 * Opens `$1` with xdg-open, left running in the background with its output
 * dropped: a browser it starts would otherwise hold the output open, and
 * `$.process.run` with it, until the timeout.
 */
const XDG_OPEN_SCRIPT = 'command -v xdg-open >/dev/null 2>&1 || { echo "xdg-open is not installed" >&2; exit 127; }\nxdg-open "$1" >/dev/null 2>&1 &'

/** Sets the clipboard to the PNG at the path given (macOS). */
const CLIPBOARD_SCRIPT = ['on run argv', 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)', 'end run']

/**
 * The compose URL of each Share whose browser didn't open, by its Button's
 * key, which the views draw as a link beside it. Kept here, not in $.state,
 * so a reload leaves no stale link.
 */
const unopened = new Map<string, string>()

/** The compose page a Share couldn't open in the browser, to offer as a link; none once it did. */
export function unopenedShare(buttonKey: string): string | undefined {
  return unopened.get(buttonKey)
}

/** Whether a share is under way, so a second press while it runs does nothing. */
let sharing = false

/** What a share sends: the squishy, and the text for the compose box. */
type Shared = { squishy: Squishy; text: string }

/** A squishy's Name as the share text gives it: crowned for a legendary, with its sparkle for a shiny. */
function marked(squishy: Squishy): string {
  const name = squishy.shiny && !squishy.name.startsWith(SHINY_MARK) ? SHINY_MARK + squishy.name : squishy.name
  return squishy.kind === 'legendary' ? `👑 ${name}` : name
}

/** A task as the share text gives it: on one line, without control characters, cut short past TASK_LIMIT. */
function taskLine(description: string): string {
  const line = [
    ...description
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
  return line.length > TASK_LIMIT ? `${line.slice(0, TASK_LIMIT - 1).join('').trimEnd()}…` : line.join('')
}

/** The share text for an agent that finished. */
function finishedText(squishy: Squishy, description: string): string {
  const task = taskLine(description)
  return `My squishy ${marked(squishy)} just finished${task === '' ? '' : `: ${task}`} 🥟`
}

/** The share text for a species met, with the count of species met. */
function metText(squishy: Squishy, met: number, total: number): string {
  return `I met ${marked(squishy)} in squishys 🥟 · ${met}/${total} species`
}

/** X's compose page with the text and the repository's link filled in. Opening it posts nothing. */
function composeUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(REPO_URL)}`
}

/** The card's file name: the squishy's key, safe in a path. */
function cardFileName(squishy: Squishy): string {
  return `${squishy.key.replace(/[^a-z0-9]+/gi, '-')}.png`
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerShare(on: On): void {
  // A press on any Share Button: the Buttons' own onPress is a no-op. A
  // failure along the way is a toast, never a throw out of the hook.
  on('ui.press', { plugin: 'squishys', element: /^share-/ }, async ($, e, next) => {
    const pressed = await next(e)
    if (sharing) return pressed
    sharing = true
    try {
      const shared = await sharedBy($, e.element)
      if (shared !== undefined) await share($, e.element, shared)
    } catch (error) {
      $.ui.toast(`Couldn't share: ${reasonOf(error)}`)
    } finally {
      sharing = false
    }
    return pressed
  })
}

/** What a Share Button shares: an Asleep agent's squishy, or a species' squishy as its card draws it. */
async function sharedBy($: EngineInterface, element: string): Promise<Shared | undefined> {
  if (element.startsWith(AGENT_SHARE)) {
    const id = element.slice(AGENT_SHARE.length)
    const agent = (await read($, agents)).find(each => each.id === id)
    if (agent === undefined || agent.state !== 'asleep') return undefined
    return { squishy: agent.squishy, text: finishedText(agent.squishy, agent.description) }
  }
  if (element.startsWith(SPECIES_SHARE)) {
    const squishy = squishyOf(KIT, element.slice(SPECIES_SHARE.length))
    if (squishy?.kind !== 'assembled') return undefined
    let progress = progressOf(squishydexFrom(undefined), KIT)
    try {
      progress = progressOf(squishydexFrom(await $.store.get(SQUISHYDEX_KEY)), KIT)
    } catch {}
    return { squishy, text: metText(squishy, progress.species, progress.speciesTotal) }
  }
  return undefined
}

/** How a command went: whether it exited 0, what it printed, and why not. */
type Ran = { ok: boolean; stdout: string; reason: string }

/** Runs a command, never rejecting: one that can't start says why. */
async function run($: EngineInterface, argv: readonly string[], stdin?: string): Promise<Ran> {
  try {
    const ran = await $.process.run(argv, { timeoutMs: RUN_TIMEOUT_MS, ...(stdin === undefined ? {} : { stdin }) })
    const reason = ran.stderr.trim().split('\n')[0] ?? ''
    return { ok: ran.exitCode === 0, stdout: ran.stdout, reason: reason === '' ? `${argv[0] ?? 'it'} exited with ${ran.exitCode}` : reason }
  } catch (error) {
    return { ok: false, stdout: '', reason: reasonOf(error) }
  }
}

/**
 * Shares a squishy: saves its card, copies it to the clipboard on macOS
 * (shown in Finder if that fails) or shows its folder on Linux, and opens
 * X's compose page. Each step that fails says so in a toast, and the rest
 * go on; a compose page the browser didn't open is offered as a link.
 */
async function share($: EngineInterface, buttonKey: string, { squishy, text }: Shared): Promise<void> {
  const notes: string[] = []
  const saved = await run($, ['sh', '-c', SAVE_SCRIPT, 'sh', cardFileName(squishy)], base64Of(encodePng(shareCard(KIT, squishy))))
  const [os = '', written = ''] = saved.stdout.split('\n').map(line => line.trim())
  const path = saved.ok && written !== '' ? written : undefined
  if (path === undefined) notes.push(`Couldn't save the card: ${saved.reason}`)
  else if (os === 'Darwin') {
    const copied = await run($, ['osascript', ...CLIPBOARD_SCRIPT.flatMap(line => ['-e', line]), path])
    if (copied.ok) notes.push('Card copied to the clipboard: paste it into your post.')
    else {
      await run($, ['open', '-R', path])
      notes.push(`Couldn't copy the card (${copied.reason}). It's saved at ${path}`)
    }
  } else {
    if (os === 'Linux') await run($, ['sh', '-c', XDG_OPEN_SCRIPT, 'sh', path.slice(0, path.lastIndexOf('/'))])
    notes.push(`Card saved to ${path}: attach it to your post.`)
  }

  const url = composeUrl(text)
  const opened =
    os === 'Darwin'
      ? await run($, ['open', url])
      : os === 'Linux'
        ? await run($, ['sh', '-c', XDG_OPEN_SCRIPT, 'sh', url])
        : { ok: false, reason: 'no way to open a browser here' }
  if (opened.ok) unopened.delete(buttonKey)
  else {
    unopened.set(buttonKey, url)
    notes.push(`Couldn't open your browser (${opened.reason}): use the Post on X link.`)
    $.ui.invalidate('ui.render')
  }
  for (const note of notes) $.ui.toast(note)
}
