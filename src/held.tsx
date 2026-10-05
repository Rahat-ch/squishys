// Held controls: a control a mode can show stays drawn while it doesn't
// apply, dimmed, so its hotkey is still held. Without it, the pane hands
// the key to the prompt, which types it there (AGENTS.md, "The keyboard in
// a pane"). Its press toasts why and does nothing else: a held control is
// keyed apart from the live one (HELD_PREFIX), so no hook that acts on the
// live control ever sees it.

import type { ButtonProps, ElementConstructor, On, RenderElement } from 'claude-code'

import { buttonColumns } from './slots'

/** What a held control's element key starts with, before the live control's key. */
export const HELD_PREFIX = 'held-'

/**
 * Why a control is held: `why`, a few words after its label (none where
 * the label keeps the live one's width), and `reason`, what its press toasts.
 */
export type Hold = { why?: string; reason: string }

/** A held control's element key, for the live control keyed `key`. */
export function heldKey(key: string): string {
  return `${HELD_PREFIX}${key}`
}

/** A held control's label: the live control's, then why it's held. */
export function heldLabel(label: string, why: string | undefined): string {
  return why === undefined ? label : `${label} (${why})`
}

/**
 * The columns a control is budgeted in a lined-up row: its widest, live or
 * held for any of `whys`, so the rows don't change as it's held or let go.
 */
export function controlColumns(label: string, hotkey: string, whys: readonly string[] = []): number {
  return Math.max(buttonColumns(label, hotkey), ...whys.map(why => buttonColumns(heldLabel(label, why), hotkey)))
}

/**
 * Each held control's reason, by its element key, as it was last drawn:
 * kept here (a drawing never writes $.state). A press that finds none (the
 * module reloaded since) toasts FALLBACK.
 */
const reasons = new Map<string, string>()

/** What a held control's press toasts when its reason isn't known. */
const FALLBACK = 'that control doesn’t apply right now.'

/**
 * Draws the control keyed `key` held: its hotkey, dimmed, its label followed
 * by why, keyed heldKey(key). Notes the reason its press toasts.
 */
export function heldButton(Button: ElementConstructor<ButtonProps>, key: string, hotkey: string, label: string, hold: Hold): RenderElement {
  reasons.set(heldKey(key), hold.reason)
  return <Button key={heldKey(key)} hotkey={hotkey} plain dimColor label={heldLabel(label, hold.why)} onPress={() => {}} />
}

export function registerHeld(on: On): void {
  // A press of any held control says why it doesn't apply. Its own onPress
  // does nothing.
  on('ui.press', { plugin: 'squishys', element: /^held-/ }, async ($, e, next) => {
    $.ui.toast(`Squishys: ${reasons.get(e.element) ?? FALLBACK}`)
    return next(e)
  })
}
