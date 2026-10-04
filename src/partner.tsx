// The partner: the user's own squishy, which stands for the orchestrator.
// The user picks it from the kit's three starters the first time the pane
// opens (the pane's starter mode, drawn here), and it's kept in the store,
// so it stays the same from session to session. The roster pins it in its
// first slot (src/pane.tsx).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Squishy } from '../types'
import { stillPixels } from './composer'
import { KIT } from './kit'
import { halfBlocks } from './raster'
import type { RasterCells } from './raster'
import { speciesSquishy } from './roller'
import type { AssembledSquishy } from './roller'
import { SLOT_COLUMN_GAP, SLOT_COLUMNS, SLOT_ROW_GAP, slotsThatFit } from './slots'

/**
 * Where the store keeps the partner: its species (`body`, `face`), so it can
 * later become any species the user has met (the Squishydex), and the
 * palette it was picked in, so a change to the kit's palettes doesn't
 * recolor or rename it.
 */
export const PARTNER_KEY = 'partner'

/** What the pane's Button that picks the partner is keyed. */
export const PARTNER_BUTTON = 'partner'

/** What the Raster showing the partner's still picture is keyed. */
export const PARTNER_PICTURE = 'partner-picture'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')

/**
 * The partner a stored value names, in its palette (the kit's first once the
 * kit no longer has it); undefined for none, or a species the kit can no
 * longer make.
 */
export function partnerFrom(stored: unknown): Squishy | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined
  const { body, face, palette } = stored as Record<string, unknown>
  if (typeof body !== 'string' || typeof face !== 'string') return undefined
  return speciesSquishy(KIT, { body, face }, typeof palette === 'string' ? palette : undefined)
}

/**
 * The partner's picture, or a starter's: still, since the partner is no
 * agent and never animates.
 */
export function stillPicture(squishy: Squishy): RasterCells {
  return halfBlocks(stillPixels(KIT, squishy))
}

export function registerPartner(on: On): void {
  // A new user picks their partner first: the pane opens on the starters.
  // The pane's own session.start hook is the unmatched one, so this one
  // matches every session.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await pickWithoutPartner($)
    return next(e)
  })

  // /clear, /resume and a branch put the pane back on the roster; compaction
  // keeps $.state.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await pickWithoutPartner($)
    return next(e)
  })

  // The starter mode of the pane: the three starters and nothing else, until
  // one is picked. The pane's id is spelled out, since the engine reads a
  // matcher off this file alone.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'starter') return next(e)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const starters = KIT.starters.flatMap(species => speciesSquishy(KIT, species) ?? [])
    // As many across as fit the pane, so a narrow one wraps them
    const across = Math.max(1, slotsThatFit(e.props.bodyColumns))
    const rows = Array.from({ length: Math.ceil(starters.length / across) }, (_, row) => starters.slice(row * across, (row + 1) * across))
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>Pick your partner, the squishy that stands for the orchestrator.</Text>
        <Box key="starters" flexDirection="column" rowGap={SLOT_ROW_GAP}>
          {rows.map((row, rowIndex) => (
            <Box key={`starter-row-${rowIndex}`} flexDirection="row" columnGap={SLOT_COLUMN_GAP}>
              {row.map((squishy, column) => {
                const number = rowIndex * across + column + 1
                return (
                  <Box key={`starter-slot-${number}`} flexDirection="column" alignItems="center" width={SLOT_COLUMNS}>
                    <Raster key={`starter-picture-${number}`} {...stillPicture(squishy)} />
                    <Button
                      key={`starter-${number}`}
                      hotkey={String(number)}
                      plain
                      label={squishy.name}
                      onPress={() => void choosePartner($, squishy)}
                    />
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

/** Puts the pane on the starters when no partner is saved; a store that can't be read leaves it be. */
async function pickWithoutPartner($: EngineInterface): Promise<void> {
  let stored: unknown
  try {
    stored = await $.store.get(PARTNER_KEY)
  } catch {
    return // a pick that couldn't be saved would only come back next time
  }
  if (partnerFrom(stored) === undefined) await update($, mode, () => 'starter')
}

/**
 * Saves a starter as the partner (its species and the palette it shows),
 * and shows the roster. A store that can't be written still lets the user
 * on: they pick again next time.
 */
async function choosePartner($: EngineInterface, { body, face, palette }: AssembledSquishy): Promise<void> {
  try {
    await $.store.set(PARTNER_KEY, { body, face, palette })
  } catch {}
  await update($, mode, () => 'roster')
}
