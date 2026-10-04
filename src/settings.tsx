// Settings: the user's lasting options, kept in the mod's store so they
// carry over from session to session, and the pane's settings mode that
// changes them.

import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, On } from 'claude-code'

/** The Agent tool's model aliases a default can name. */
export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const
export type Model = (typeof MODELS)[number]

/** The most roster slots the cap allows: one per digit hotkey. */
export const MAX_SLOTS = 9

export type Settings = {
  /** The model every new agent starts on; absent lets Claude choose. */
  model?: Model
  /** The most slots the roster shows. */
  slotCap: number
}

/** Where the settings live in the mod's store. */
export const SETTINGS_KEY = 'settings'

/** The model Select's value for no default. */
const LET_CLAUDE_CHOOSE = 'let-claude-choose'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')

/** The settings a stored value holds, with defaults for anything missing or no longer valid. */
export function settingsFrom(stored: unknown): Settings {
  const { model, slotCap } = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>
  return {
    ...(isModel(model) ? { model } : {}),
    slotCap: isSlotCap(slotCap) ? slotCap : MAX_SLOTS,
  }
}

/**
 * The spawn as it should start: on the default model when one is set.
 * Forks always inherit their parent's model, so they're left alone.
 */
export function withModelDefault(spawn: AgentSpawnInput, settings: Settings): AgentSpawnInput {
  if (spawn.fork || settings.model === undefined) return spawn
  return { ...spawn, model: settings.model }
}

function isModel(value: unknown): value is Model {
  return MODELS.includes(value as Model)
}

function isSlotCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SLOTS
}

export function registerSettings(on: On): void {
  // The settings mode of the pane. Each mode's hook draws only while the
  // pane is in that mode and passes the drawing on otherwise. The pane's id
  // is spelled out, since the engine reads a matcher off this file alone.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'settings') return next(e)
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    const settings = settingsFrom(await $.store.get(SETTINGS_KEY))
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>Settings</Text>
        <Select
          key="model"
          label="Model for new agents: "
          options={[
            { value: LET_CLAUDE_CHOOSE, label: 'Let Claude choose' },
            ...MODELS.map(model => ({ value: model, label: model })),
          ]}
          value={settings.model ?? LET_CLAUDE_CHOOSE}
          onSelect={value => void change($, ({ model: _, ...rest }) => (isModel(value) ? { ...rest, model: value } : rest))}
        />
        <Select
          key="slotCap"
          label="Roster slots, at most: "
          options={Array.from({ length: MAX_SLOTS }, (_, at) => ({ value: String(at + 1) }))}
          value={String(settings.slotCap)}
          onSelect={value => void change($, current => ({ ...current, slotCap: Number(value) }))}
        />
        <Button key="back" hotkey="r" plain label="Back to the roster" onPress={() => void update($, mode, () => 'roster')} />
      </Box>
    )
  })
}

async function change($: EngineInterface, edit: (settings: Settings) => Settings): Promise<void> {
  await $.store.set(SETTINGS_KEY, edit(settingsFrom(await $.store.get(SETTINGS_KEY))))
  // The store isn't $.state, so nothing redraws the pane on its own.
  $.ui.invalidate('ui.render')
}
