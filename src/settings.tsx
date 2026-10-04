// Settings: the user's lasting options, kept in the mod's store so they
// carry over from session to session, and the pane's settings mode that
// changes them.

import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, On } from 'claude-code'

import { cycleLabel, nextOf } from './keys'

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
  /**
   * Experimental: the focus view can switch a running agent's model from
   * its next request. Off when absent.
   */
  liveModelSwitch?: true
  /**
   * A chime plays when a shiny or legendary squishy is rolled. Off when
   * absent. Offered only where `$.audio` makes a sound (macOS).
   */
  chime?: true
}

/** Where the settings live in the mod's store. */
export const SETTINGS_KEY = 'settings'

/** The model key's choice of no default. */
const LET_CLAUDE_CHOOSE = 'let-claude-choose'

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const mode = atom({ plugin: 'squishys', key: 'mode' } as const, 'roster')

/** The settings a stored value holds, with defaults for anything missing or no longer valid. */
export function settingsFrom(stored: unknown): Settings {
  const { model, slotCap, liveModelSwitch, chime } = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>
  return {
    ...(isModel(model) ? { model } : {}),
    slotCap: isSlotCap(slotCap) ? slotCap : MAX_SLOTS,
    ...(liveModelSwitch === true ? { liveModelSwitch } : {}),
    ...(chime === true ? { chime } : {}),
  }
}

/**
 * The spawn as it should start: on the default model when one is set.
 * A fork always inherits the model of the agent or orchestrator it forked
 * from, so it's left alone.
 */
export function withModelDefault(spawn: AgentSpawnInput, settings: Settings): AgentSpawnInput {
  if (spawn.fork || settings.model === undefined) return spawn
  return { ...spawn, model: settings.model }
}

export function isModel(value: unknown): value is Model {
  return MODELS.includes(value as Model)
}

function isSlotCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SLOTS
}

export function registerSettings(on: On): void {
  // The settings mode of the pane. Each mode's hook draws only while the
  // pane is in that mode and passes the drawing on otherwise. The pane's id
  // is spelled out, since the engine reads a matcher off this file alone.
  // Each setting is a Button whose hotkey steps it to its next choice
  // (AGENTS.md, "Keys"); each press edits the setting as stored, so two
  // presses before a redraw step it twice.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'settings') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const settings = await readSettings($)
    const chimes = await chimePlays($)
    const model = settings.model ?? LET_CLAUDE_CHOOSE
    const nextModel = nextOf(MODEL_CYCLE, model) ?? LET_CLAUDE_CHOOSE
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>Settings</Text>
        <Button
          key="model"
          hotkey="m"
          plain
          label={cycleLabel('Model for new agents', modelName(model), modelName(nextModel))}
          onPress={() => void saveSettings($, withNextModel)}
        />
        <Button
          key="slotCap"
          hotkey="s"
          plain
          label={cycleLabel('Roster slots, at most', String(settings.slotCap), String(nextSlotCap(settings.slotCap)))}
          onPress={() => void saveSettings($, current => ({ ...current, slotCap: nextSlotCap(current.slotCap) }))}
        />
        <Button
          key="liveModelSwitch"
          hotkey="l"
          plain
          label={cycleLabel("Experimental: switch a running agent's model from its focus view", onOff(settings.liveModelSwitch), onOff(settings.liveModelSwitch !== true))}
          onPress={() => void saveSettings($, ({ liveModelSwitch, ...rest }) => (liveModelSwitch === true ? rest : { ...rest, liveModelSwitch: true }))}
        />
        {chimes ? (
          <Button
            key="chime"
            hotkey="c"
            plain
            label={cycleLabel('Chime on a shiny or legendary', onOff(settings.chime), onOff(settings.chime !== true))}
            onPress={() => void saveSettings($, ({ chime, ...rest }) => (chime === true ? rest : { ...rest, chime: true }))}
          />
        ) : null}
        <Button key="back" hotkey="r" plain label="Back to the roster" onPress={() => void update($, mode, () => 'roster')} />
      </Box>
    )
  })
}

/** The model default's choices, in the order its key steps through them. */
const MODEL_CYCLE = [LET_CLAUDE_CHOOSE, ...MODELS]

/** How a model default's choice reads. */
function modelName(choice: string): string {
  return choice === LET_CLAUDE_CHOOSE ? 'Let Claude choose' : choice
}

/** Settings with the model default stepped to its next choice. */
function withNextModel({ model, ...rest }: Settings): Settings {
  const stepped = nextOf(MODEL_CYCLE, model ?? LET_CLAUDE_CHOOSE)
  return isModel(stepped) ? { ...rest, model: stepped } : rest
}

/** The slot cap after `cap`: one more, and 1 after the most. */
function nextSlotCap(cap: number): number {
  return (cap % MAX_SLOTS) + 1
}

/** How an on-off setting reads. */
function onOff(on: boolean | undefined): string {
  return on === true ? 'On' : 'Off'
}

/**
 * Whether `$.audio` makes a sound here, so the chime setting is worth
 * offering. Nothing on `$` names the platform; `$.audio` plays a clip with
 * `afplay` on macOS and plays nothing on Linux or Windows, which have no
 * player, so the chime is offered wherever afplay is. A check that fails
 * hides it.
 */
async function chimePlays($: EngineInterface): Promise<boolean> {
  try {
    return await $.fs.exists('/usr/bin/afplay')
  } catch {
    return false
  }
}

async function readSettings($: EngineInterface): Promise<Settings> {
  return settingsFrom(await $.store.get(SETTINGS_KEY))
}

/** Saves an edit to the settings, validated like a stored value is on reading. */
async function saveSettings($: EngineInterface, edit: (settings: Settings) => Settings): Promise<void> {
  await $.store.set(SETTINGS_KEY, settingsFrom(edit(await readSettings($))))
  // The store isn't $.state, so nothing redraws the pane on its own.
  $.ui.invalidate('ui.render')
}
