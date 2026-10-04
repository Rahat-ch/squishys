// Hotkeys: which key each pane control answers to, as plain functions on
// strings. Pure: it never touches Claude Code. A Button's hotkey is one
// digit or one lowercase letter (AGENTS.md, "A `Button` `hotkey`").

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz']

/**
 * The hotkeys of `count` picks in a row (squishys, places): the digits in
 * order, then the letters a mode's other controls leave free (`taken`), then
 * none once both run out.
 */
export function pickKeys(count: number, taken: readonly string[]): (string | undefined)[] {
  const free = [...DIGITS, ...LETTERS.filter(letter => !taken.includes(letter))]
  return Array.from({ length: Math.max(0, count) }, (_, index) => free[index])
}

/**
 * What a cycling control steps to from `current`: the choice after it,
 * the first after the last, and the first when `current` is no longer one
 * of them. Nothing when there are no choices.
 */
export function nextOf<T>(cycle: readonly T[], current: T): T | undefined {
  const at = cycle.indexOf(current)
  return cycle[at < 0 ? 0 : (at + 1) % cycle.length]
}

/** A cycling control's label: what it is, what it's on, and what the next press picks. */
export function cycleLabel(name: string, current: string, next: string): string {
  return `${name}  ${current} ▸ ${next}`
}
