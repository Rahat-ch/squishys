// What the mod's pictures should be, from the pure composer: tests that
// drive the mod read which squishy a slot shows, then check its pictures
// against the poses the composer's own tests pin down. Nothing here walks
// every squishy the kit can make, so no test slows as the kit grows.

import type { Engine, Mounted } from 'claude-code/testing'

import { compose } from '../src/composer'
import type { Size } from '../src/composer'
import { KIT } from '../src/kit'
import type { Kit } from '../src/kit'
import { halfBlocks } from '../src/raster'
import { SHINY_MARK } from '../src/roller'
import type { Squishy } from '../src/roller'
import { SQUISHY_STATES, moves } from '../src/states'
import type { SquishyState } from '../src/states'
import { PANE, spawnOf } from './fixtures'

/**
 * Squishys that between them use every part of the kit, plain and shiny,
 * and every legendary: each part once, beside the first of the other kinds.
 */
export function eachPart(kit: Kit = KIT): Squishy[] {
  const [body, face, palette, accessory] = [kit.bodies[0], kit.faces[0], kit.palettes[0], kit.accessories[0]]
  if (!body || !face || !palette || !accessory) throw new Error('The kit is missing a kind of part')
  const first = { body: body.id, face: face.id, palette: palette.id, accessory: accessory.id }
  const assembled = [
    ...kit.bodies.map(part => ({ ...first, body: part.id })),
    ...kit.faces.map(part => ({ ...first, face: part.id })),
    ...kit.palettes.map(part => ({ ...first, palette: part.id })),
    ...kit.accessories.map(part => ({ ...first, accessory: part.id })),
  ]
  return [false, true].flatMap(shiny => [
    ...kit.legendaries.map(({ id, name }): Squishy => ({ kind: 'legendary', legendary: id, shiny, name, key: id })),
    ...assembled.map((parts): Squishy => ({ kind: 'assembled', ...parts, rarity: 'common', shiny, name: '', key: '' })),
  ])
}

/**
 * The cells of a Raster showing this squishy in this pose: a slot's, or at
 * `double`, a focus view's; with `sparkle`, a shiny's or legendary's glints.
 */
export function cellsOf(squishy: Squishy, state: SquishyState, frame = 0, size: Size = 'full', sparkle = false): string {
  return halfBlocks(compose(KIT, squishy, { state, frame, size, sparkle })).cells
}

/**
 * Which state a picture of this squishy shows, at whichever frame the
 * animation is on; undefined if it shows none.
 */
export function stateIn(cells: unknown, squishy: Squishy): SquishyState | undefined {
  const frames = (state: SquishyState) => (moves(state) ? [0, 1, 2, 3] : [0])
  return SQUISHY_STATES.find(state => frames(state).some(frame => cellsOf(squishy, state, frame) === cells))
}

/**
 * Which squishy a picture shows in this pose at frame 0 (a newly spawned
 * squishy's is Working), among those the Name on its button fits: the whole
 * Name, or its start when the button cut it to fit its slot (ending in …).
 * A Name is its parts' syllables, so only parts whose syllable comes next in
 * it are tried.
 */
export function squishyIn(cells: unknown, label: string, state: SquishyState = 'working'): Squishy {
  // A shiny's Name starts with SHINY_MARK
  const shiny = label.startsWith(SHINY_MARK)
  const cut = label.endsWith('…')
  const bare = (shiny ? label.slice(SHINY_MARK.length) : label).replace(/…$/, '').toLowerCase()
  const whole = (name: string) => (cut ? name.startsWith(bare) : name === bare)
  // Whether a Name that starts with `sofar` can still be the one the label shows
  const fits = (sofar: string) => (cut ? sofar.startsWith(bare) || bare.startsWith(sofar) : bare.startsWith(sofar))
  const named = (name: string) => (shiny ? SHINY_MARK : '') + name.charAt(0).toUpperCase() + name.slice(1)
  const candidates: Squishy[] = []
  for (const legendary of KIT.legendaries.filter(each => whole(each.name.toLowerCase()))) {
    candidates.push({ kind: 'legendary', legendary: legendary.id, shiny, name: named(legendary.name), key: legendary.id })
  }
  for (const body of KIT.bodies.filter(part => fits(part.syllable))) {
    const b = body.syllable
    for (const face of KIT.faces.filter(part => fits(b + part.syllable))) {
      const bf = b + face.syllable
      for (const palette of KIT.palettes.filter(part => fits(bf + part.syllable))) {
        const bfp = bf + palette.syllable
        for (const accessory of KIT.accessories.filter(part => whole(bfp + part.syllable))) {
          const parts = { body: body.id, face: face.id, palette: palette.id, accessory: accessory.id }
          candidates.push({ kind: 'assembled', ...parts, rarity: 'common', shiny, name: named(bfp + accessory.syllable), key: '' })
        }
      }
    }
  }
  const squishy = candidates.find(each => cellsOf(each, state) === cells)
  if (squishy === undefined) throw new Error(`No squishy named ${label} draws that picture ${state}`)
  return squishy
}

/**
 * Watches one agent's slot in the mounted roster: which squishy it shows,
 * the cells it was last drawn with (blits don't change them) and the state
 * those show. Call it while the agent is newly spawned.
 */
export async function watch(ui: Mounted<'terminal', 'Pane'>, agentId: string) {
  const picture = async () => (await ui.find({ key: `picture-${agentId}` }))?.props.cells
  const name = (await ui.find({ key: `squishy-${agentId}` }))?.props.label
  const squishy = squishyIn(await picture(), String(name))
  return { squishy, picture, state: async () => stateIn(await picture(), squishy) }
}

/** Spawns agent-1, opens the roster and watches agent-1's slot. */
export async function spawnAndWatch($: Engine) {
  await $.agent.spawn(spawnOf('toolu_1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  return { ui, ...(await watch(ui, 'agent-1')) }
}
