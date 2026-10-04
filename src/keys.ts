// Hotkeys: which hotkey each pane control answers to, and how a control
// that steps through a few choices moves on, as plain functions. Pure: it
// never touches Claude Code. A Button's hotkey is one digit or one
// lowercase letter (AGENTS.md, "A `Button` `hotkey`").

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz']

/**
 * The hotkeys of `count` picks in a row (squishys, places): the digits in
 * order, then the letters the mode's other controls leave free (`taken`).
 * Past those, a pick has no hotkey (`undefined`): it is reached by Tab and
 * Enter, or a click under fullscreen rendering.
 */
export function pickKeys(count: number, taken: readonly string[]): (string | undefined)[] {
  const free = [...DIGITS, ...LETTERS.filter(letter => !taken.includes(letter))]
  return Array.from({ length: Math.max(0, count) }, (_, index) => free[index])
}

/**
 * What a control that steps through `cycle` moves to from `current`: the
 * choice after it, and the first after the last. From a choice the cycle no
 * longer offers, the first choice after it in `order` (every choice there
 * could be, in cycle order), else the first. Nothing when there are none.
 */
export function nextOf<T>(cycle: readonly T[], current: T, order: readonly T[] = cycle): T | undefined {
  const at = cycle.indexOf(current)
  if (at >= 0) return cycle[(at + 1) % cycle.length]
  const rank = order.indexOf(current)
  return cycle.find(choice => order.indexOf(choice) > rank) ?? cycle[0]
}

/** A stepping control's label: what it is, what it's on, and what the next press picks. */
export function cycleLabel(name: string, current: string, next: string): string {
  return `${name}  ${current} ▸ ${next}`
}
