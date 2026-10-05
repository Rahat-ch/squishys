// Held controls: a control a mode can show stays drawn while it doesn't
// apply, dimmed and saying why, so its hotkey is still held. Without it,
// the pane hands the key to the prompt, which types it there (AGENTS.md,
// "The keyboard in a pane"). Its press toasts the reason and does nothing
// else: a held control is keyed apart from the live one (HELD_PREFIX), so
// no hook that acts on the live control ever sees it.

import type { On } from 'claude-code'

/** What a held control's element key starts with, before the live control's key. */
export const HELD_PREFIX = 'held-'

/**
 * Why a control is held: `why`, a few words after its label (none where
 * the label must keep its width), and `reason`, what its press toasts.
 */
export type Hold = { why?: string; reason: string }

/**
 * Each held control's reason, by its element key, as it was last drawn:
 * kept here (a drawing never writes $.state). A press that finds none (the
 * module reloaded since) toasts FALLBACK.
 */
const reasons = new Map<string, string>()

/** What a held control's press toasts when its reason isn't known. */
const FALLBACK = 'that control doesn’t apply right now.'

/** A held control's element key, for the live control keyed `key`, noting why it's held. */
export function heldKey(key: string, hold: Hold): string {
  const held = `${HELD_PREFIX}${key}`
  reasons.set(held, hold.reason)
  return held
}

/** A held control's label: the live control's, then why it's held. */
export function heldLabel(label: string, { why }: Hold): string {
  return why === undefined ? label : `${label} (${why})`
}

export function registerHeld(on: On): void {
  // A press of any held control says why it doesn't apply. Its own onPress
  // does nothing.
  on('ui.press', { plugin: 'squishys', element: /^held-/ }, async ($, e, next) => {
    $.ui.toast(`Squishys: ${reasons.get(e.element) ?? FALLBACK}`)
    return next(e)
  })
}
