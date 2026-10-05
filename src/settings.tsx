// Settings: the user's lasting options, kept in the mod's store so they
// carry over from session to session, and the pane's settings mode that
// changes them.

import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, On } from 'claude-code'

import { heldButton } from './held'
import type { Hold } from './held'
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
   * Experimental: the focus view can switch a running agent's model and
   * effort from its next request. Off when absent.
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

/** The model default control's choice of no default. */
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

/**
 * What a model control steps through: `first` (no model of its own), then
 * each of `allowed` in MODELS order. Every model control (the default for
 * new agents, the live switch) orders models so.
 */
export function modelCycle<First extends string>(first: First, allowed: readonly Model[] = MODELS): (First | Model)[] {
  return [first, ...MODELS.filter(model => allowed.includes(model))]
}

/** The on-off settings, each `true` or absent. */
type Toggle = 'liveModelSwitch' | 'chime'

/** Settings with an on-off setting turned the other way. */
export function toggled(settings: Settings, name: Toggle): Settings {
  const { [name]: was, ...rest } = settings
  return was === true ? rest : { ...rest, [name]: true }
}

export function registerSettings(on: On): void {
  // The settings mode of the pane. Each mode's hook draws only while the
  // pane is in that mode and passes the drawing on otherwise. The pane's id
  // is spelled out, since the engine reads a matcher off this file alone.
  // Each setting is a control whose hotkey steps it to its next choice
  // (AGENTS.md, "Keys"). Saves queue (saveSettings), so two presses before
  // a redraw step a setting twice.
  on('ui.render', { component: 'Pane', requestId: 'squishys' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, mode)) !== 'settings') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const settings = await readSettings($)
    const chimes = await chimePlays($)
    const model = settings.model ?? LET_CLAUDE_CHOOSE
    const toggle = (name: Toggle, hotkey: string, label: string) => (
      <Button
        key={name}
        hotkey={hotkey}
        plain
        label={cycleLabel(label, onOff(settings[name]), onOff(settings[name] !== true))}
        onPress={() => void saveSettings($, current => toggled(current, name))}
      />
    )
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>Settings</Text>
        <Button
          key="model"
          hotkey="m"
          plain
          label={cycleLabel(MODEL_DEFAULT_LABEL, modelName(model), modelName(nextOf(MODEL_DEFAULTS, model) ?? LET_CLAUDE_CHOOSE))}
          onPress={() => void saveSettings($, withNextModel)}
        />
        <Button
          key="slotCap"
          hotkey="s"
          plain
          label={cycleLabel(SLOT_CAP_LABEL, String(settings.slotCap), String(nextSlotCap(settings.slotCap)))}
          onPress={() => void saveSettings($, current => ({ ...current, slotCap: nextSlotCap(current.slotCap) }))}
        />
        {toggle('liveModelSwitch', 'l', LIVE_MODEL_SWITCH_LABEL)}
        {/* Where no chime plays, held: src/held.tsx answers its press, so c never reaches the prompt */}
        {chimes ? (
          toggle('chime', 'c', CHIME_LABEL)
        ) : (
          heldButton(Button, 'chime', 'c', CHIME_LABEL, NO_CHIME)
        )}
        <Button key="back" hotkey="r" plain label="Back to the roster" onPress={() => void update($, mode, () => 'roster')} />
      </Box>
    )
  })
}

/** What each setting's control is labeled, before what it's on. */
export const MODEL_DEFAULT_LABEL = 'Model for new agents'
export const SLOT_CAP_LABEL = 'Roster slots, at most'
export const LIVE_MODEL_SWITCH_LABEL = "Experimental: switch a running agent's model and effort from its focus view"
export const CHIME_LABEL = 'Chime on a shiny or legendary'

/** Why the chime setting is held where `$.audio` makes no sound (chimePlays). */
const NO_CHIME: Hold = { why: 'macOS only', reason: 'no chime plays here: Claude Code plays sounds only on macOS.' }

/** The model default's choices, in the order its control steps through them. */
const MODEL_DEFAULTS = modelCycle(LET_CLAUDE_CHOOSE)

/** How a model default's choice reads. */
export function modelName(choice: string): string {
  return choice === LET_CLAUDE_CHOOSE ? 'Let Claude choose' : choice
}

/** Settings with the model default stepped to its next choice. */
function withNextModel({ model, ...rest }: Settings): Settings {
  const stepped = nextOf(MODEL_DEFAULTS, model ?? LET_CLAUDE_CHOOSE)
  return isModel(stepped) ? { ...rest, model: stepped } : rest
}

/** The slot cap after `cap`: one more, and 1 after the most. */
function nextSlotCap(cap: number): number {
  return (cap % MAX_SLOTS) + 1
}

/** How an on-off setting reads. */
export function onOff(on: boolean | undefined): string {
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

/**
 * The saves under way, one after another, so each reads what the one
 * before it wrote: two quick presses step a setting twice. Kept here, never
 * in $.state.
 */
let saving: Promise<void> = Promise.resolve()

/**
 * Saves an edit to the settings, validated like a stored value is on
 * reading, after every save already under way. A save that fails leaves
 * the settings as they were and the queue going.
 */
function saveSettings($: EngineInterface, edit: (settings: Settings) => Settings): Promise<void> {
  saving = saving.then(async () => {
    try {
      await $.store.set(SETTINGS_KEY, settingsFrom(edit(await readSettings($))))
    } catch {}
    // The store isn't $.state, so nothing redraws the pane on its own.
    $.ui.invalidate('ui.render')
  })
  return saving
}
