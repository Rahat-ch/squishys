// Share: posts a squishy to X, by the user's own hand. One press of Share
// (in the focus view of an agent whose squishy is Asleep, or on a met
// species' Squishydex card) saves the squishy's pixel card (src/card.ts) as
// a PNG, copies it to the clipboard (or shows where it is where it can't),
// and only then opens X's compose page with the share text filled in, its
// last line a reminder to paste the card once it was copied. Nothing is
// ever posted: the user reviews the text, adds the card and posts it.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Squishy } from '../types'
import { shareCard } from './card'
import { KIT } from './kit'
import { encodePng } from './png'
import { base64Of } from './raster'
import { SHINY_MARK, squishyOf, withoutShinyMark } from './roller'
import { SQUISHYDEX_KEY, progressOf, squishydexFrom } from './squishydex-record'
import { canShare } from './states'
import { printable, wellFormed } from './text'

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

/** What the link to the compose page says, where it's offered. */
export const SHARE_LINK_LABEL = 'Post on X'

/** Where a share's link goes: the mod's own repository. */
export const REPO_URL = 'https://github.com/Rahat-ch/squishys'

/**
 * The longest an agent's description runs in the share text, in
 * characters: it can hold private project details, so only its start goes
 * in the compose box, for the user to review.
 */
const DESCRIPTION_LIMIT = 60

/** How long each command Share runs may take. */
const RUN_TIMEOUT_MS = 10_000

/**
 * Saves the card, its PNG arriving as base64 on standard input, named by
 * `$1`, in a folder of the user's own: `$TMPDIR/squishys-share` on macOS
 * (a per-user temp dir there), else `${XDG_CACHE_HOME:-$HOME/.cache}/squishys/share`.
 * It refuses a folder that isn't the user's own or is a symbolic link, so
 * another user can't plant one to make Share write over a file; makes it
 * private (700); drops cards older than a day; and writes through mktemp,
 * then moves the card onto its name, which replaces whatever is there
 * rather than writing through it.
 *
 * It prints the system's name first (`uname -s`), whatever happens next,
 * then the path written once it is. macOS's base64 decodes with `-D` (old
 * releases know no `-d`), GNU's and BusyBox's with `-d`.
 */
export const SAVE_SCRIPT = [
  'os=$(uname -s)',
  'printf "%s\\n" "$os"',
  'case "$os" in',
  '  Darwin) base="${TMPDIR:-$HOME/Library/Caches}"; dir="${base%/}/squishys-share"; flag=-D ;;',
  '  *) dir="${XDG_CACHE_HOME:-$HOME/.cache}/squishys/share"; flag=-d ;;',
  'esac',
  'mkdir -p "$dir" || exit 1',
  'if [ ! -O "$dir" ] || [ -L "$dir" ]; then echo "$dir is not a folder of your own" >&2; exit 1; fi',
  'chmod 700 "$dir" || exit 1',
  'find "$dir" -maxdepth 1 -type f -name "*.png" -mtime +0 -exec rm -f {} + 2>/dev/null',
  'tmp=$(mktemp "$dir/.card.XXXXXX") || exit 1',
  'if base64 "$flag" > "$tmp" && mv -f "$tmp" "$dir/$1"; then printf "%s\\n" "$dir/$1"; else rm -f "$tmp"; exit 1; fi',
].join('\n')

/**
 * Opens `$1` with xdg-open, left running in the background with its output
 * dropped: a browser it starts would otherwise hold the output open, and
 * `$.process.run` with it, until the timeout. So it exits 0 whether or not
 * anything opened.
 */
const XDG_OPEN_SCRIPT = 'command -v xdg-open >/dev/null 2>&1 || { echo "xdg-open is not installed" >&2; exit 127; }\nxdg-open "$1" >/dev/null 2>&1 &'

/** Sets the clipboard to the PNG at the path given (macOS). */
const CLIPBOARD_SCRIPT = ['on run argv', 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)', 'end run']

/**
 * Sets the clipboard to the PNG at `$1` (Linux): with wl-copy (Wayland),
 * else xclip (X11), whichever is installed and takes it. Both stay running
 * in the background to hold the clipboard, so their output is dropped, or
 * they would hold `$.process.run` open until the timeout. Fails, saying
 * why, when neither copied it: neither is installed, or each installed one
 * refused (no display to reach, as over SSH).
 */
const LINUX_CLIPBOARD_SCRIPT = [
  'wl=$(command -v wl-copy 2>/dev/null); xc=$(command -v xclip 2>/dev/null)',
  'if [ -n "$wl" ] && wl-copy --type image/png < "$1" >/dev/null 2>&1; then exit 0; fi',
  'if [ -n "$xc" ] && xclip -selection clipboard -t image/png -i "$1" >/dev/null 2>&1; then exit 0; fi',
  'if [ -n "$wl$xc" ]; then echo "the clipboard refused the card" >&2; exit 1; fi',
  'echo "neither wl-copy nor xclip is installed" >&2; exit 127',
].join('\n')

/** The one toast of a share that went through. */
export const COPIED_NOTE = 'Card copied: paste it into your post'

/** The system Share is on, by what `uname -s` says. */
type Platform = 'macos' | 'linux' | 'other'

function platformOf(uname: string): Platform {
  if (uname === 'Darwin') return 'macos'
  if (uname === 'Linux') return 'linux'
  return 'other'
}

/**
 * The compose URL of each Share whose browser may not have opened, by its
 * Button's key, which the views draw as a link beside it. Kept here, not in
 * $.state, so a reload leaves no stale link.
 */
const unopened = new Map<string, string>()

/** The compose page to offer as a link after a Share that may not have opened it; none once one surely did. */
export function unopenedShare(buttonKey: string): string | undefined {
  return unopened.get(buttonKey)
}

/** Whether a share is under way, so a second press while it runs does nothing. */
let sharing = false

/** What a share sends: the squishy, and the text for the compose box. */
type ShareContent = { squishy: Squishy; text: string }

/** A squishy's Name as the share text gives it: crowned for a legendary, with one SHINY_MARK for a shiny. */
function sharedName(squishy: Squishy): string {
  const name = squishy.shiny ? SHINY_MARK + withoutShinyMark(squishy.name) : squishy.name
  return squishy.kind === 'legendary' ? `👑 ${name}` : name
}

/** An agent's description as the share text gives it: printable, on one line, cut short past DESCRIPTION_LIMIT. */
function descriptionLine(description: string): string {
  const line = [...printable(description).replace(/\s+/g, ' ').trim()]
  return line.length > DESCRIPTION_LIMIT ? `${line.slice(0, DESCRIPTION_LIMIT - 1).join('').trimEnd()}…` : line.join('')
}

/** The share text for an agent that finished. */
function finishedText(squishy: Squishy, description: string): string {
  const line = descriptionLine(description)
  return `My squishy ${sharedName(squishy)} just finished${line === '' ? '' : `: ${line}`} 🥟`
}

/** The share text for a species met, with the count of species met. */
function metText(squishy: Squishy, met: number, total: number): string {
  return `I met ${sharedName(squishy)} in squishys 🥟 · ${met}/${total} species`
}

/**
 * The share text's last line, after a blank one, once the card is on the
 * clipboard: how to paste it, by the platform's `pasteKey`. With the
 * longest Name and description, the text, this and the link (23 as X counts
 * it) stay within a post's 280.
 */
export function pasteReminder(pasteKey: string): string {
  return `\n\n(${pasteKey} to paste your squishy, then delete this line)`
}

/** X's compose page with the text and the repository's link filled in. Opening it posts nothing. */
function composeUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(wellFormed(text))}&url=${encodeURIComponent(REPO_URL)}`
}

/** The card's file name: the squishy's key, safe in a path. */
export function cardFileName(squishy: Squishy): string {
  return `${squishy.key.replace(/[^a-z0-9]+/gi, '-')}.png`
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerShare(on: On): void {
  // A press on any Share Button: the Buttons' own onPress is a no-op. Each
  // step's outcome is a toast, including those before a step that throws;
  // nothing throws out of the hook.
  on('ui.press', { plugin: 'squishys', element: /^share-/ }, async ($, e, next) => {
    const pressed = await next(e)
    if (sharing) return pressed
    sharing = true
    const notes: string[] = []
    try {
      const content = await contentOf($, e.element)
      if (content !== undefined) await share($, e.element, content, notes)
    } catch (error) {
      notes.push(`Couldn't finish sharing: ${reasonOf(error)}`)
    } finally {
      sharing = false
      for (const note of notes) $.ui.toast(note)
    }
    return pressed
  })
}

/** What a Share Button shares: an Asleep agent's squishy, or a species' squishy as its card draws it. */
async function contentOf($: EngineInterface, element: string): Promise<ShareContent | undefined> {
  if (element.startsWith(AGENT_SHARE)) {
    const id = element.slice(AGENT_SHARE.length)
    const agent = (await read($, agents)).find(each => each.id === id)
    if (agent === undefined || !canShare(agent)) return undefined
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
type CommandOutcome = { ok: boolean; stdout: string; reason: string }

/** Runs a command, never rejecting: one that can't start says why. */
async function run($: EngineInterface, argv: readonly string[], stdin?: string): Promise<CommandOutcome> {
  try {
    const ran = await $.process.run(argv, { timeoutMs: RUN_TIMEOUT_MS, ...(stdin === undefined ? {} : { stdin }) })
    const reason = ran.stderr.trim().split('\n')[0] ?? ''
    return { ok: ran.exitCode === 0, stdout: ran.stdout, reason: reason === '' ? `${argv[0] ?? 'it'} exited with ${ran.exitCode}` : reason }
  } catch (error) {
    return { ok: false, stdout: '', reason: reasonOf(error) }
  }
}

/**
 * Shares a squishy: saves its card, then hands the card and X's compose
 * page over as the platform allows. What failed goes in `notes`, with one
 * note when the card was copied, which the hook toasts. A compose page that
 * may not have opened is offered as a link.
 */
async function share($: EngineInterface, buttonKey: string, { squishy, text }: ShareContent, notes: string[]): Promise<void> {
  const saved = await run($, ['sh', '-c', SAVE_SCRIPT, 'sh', cardFileName(squishy)], base64Of(encodePng(shareCard(KIT, squishy))))
  const [uname = '', written = ''] = saved.stdout.split('\n').map(line => line.trim())
  const path = saved.ok && written !== '' ? written : undefined
  if (path === undefined) notes.push(`Couldn't save the card: ${saved.reason}`)
  const { url, offerLink } = await runPlatformCommands($, platformCommands(platformOf(uname)), path, text, notes)
  if (offerLink) unopened.set(buttonKey, url)
  else unopened.delete(buttonKey)
  $.ui.invalidate('ui.render')
}

/**
 * How a platform hands a card and a compose page over: the commands that
 * copy the card, show it where it's saved, and open the page; whether it
 * learns that the page opened; and the shortcut that pastes.
 */
type PlatformCommands = {
  copy: (path: string) => readonly string[]
  reveal: (path: string) => readonly string[]
  open: (url: string) => readonly string[]
  knowsOpened: boolean
  pasteKey: string
}

/** The folder a path is in. */
function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * Each platform's commands, the one place that tells platforms apart: none
 * for a platform where Share knows no clipboard or browser command. On
 * Linux, a failed copy (no wl-copy or xclip, or the clipboard refused, as
 * over SSH) shows the card's folder; xdg-open runs in the background, so
 * whether X opened is never known.
 */
function platformCommands(platform: Platform): PlatformCommands | undefined {
  switch (platform) {
    case 'macos':
      return {
        copy: path => ['osascript', ...CLIPBOARD_SCRIPT.flatMap(line => ['-e', line]), path],
        reveal: path => ['open', '-R', path],
        open: url => ['open', url],
        knowsOpened: true,
        pasteKey: '⌘V',
      }
    case 'linux':
      return {
        copy: path => ['sh', '-c', LINUX_CLIPBOARD_SCRIPT, 'sh', path],
        reveal: path => ['sh', '-c', XDG_OPEN_SCRIPT, 'sh', folderOf(path)],
        open: url => ['sh', '-c', XDG_OPEN_SCRIPT, 'sh', url],
        knowsOpened: false,
        pasteKey: 'Ctrl+V',
      }
    case 'other':
      return undefined
  }
}

/**
 * Hands the saved card (if it was) and the compose page to the user: the
 * card onto the clipboard, or shown where it is when it can't be, and only
 * once that's done, the compose page, with the paste reminder only if the
 * card was copied. Gives the compose page and whether to offer it as a
 * link: wherever it may not have opened.
 */
async function runPlatformCommands(
  $: EngineInterface,
  commands: PlatformCommands | undefined,
  path: string | undefined,
  text: string,
  notes: string[],
): Promise<{ url: string; offerLink: boolean }> {
  if (commands === undefined) {
    if (path !== undefined) notes.push(`Card saved to ${path}: attach it to your post.`)
    notes.push('Use the Post on X link to write your post.')
    return { url: composeUrl(text), offerLink: true }
  }
  let copied = false
  if (path !== undefined) {
    const copy = await run($, commands.copy(path))
    copied = copy.ok
    if (copied) notes.push(COPIED_NOTE)
    else {
      await run($, commands.reveal(path))
      notes.push(`Couldn't copy the card (${copy.reason}). It's saved at ${path}`)
    }
  }
  const url = composeUrl(copied ? text + pasteReminder(commands.pasteKey) : text)
  const opened = await run($, commands.open(url))
  if (!opened.ok) notes.push(`Couldn't open your browser (${opened.reason}): use the Post on X link.`)
  return { url, offerLink: !opened.ok || !commands.knowsOpened }
}
