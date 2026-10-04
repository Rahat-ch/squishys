// Experimental: the live model switch. Behind an off-by-default setting, the
// focus view's model control switches a running agent to another model from
// its next request on, by rewriting that agent's requests in turn.step. The
// focus view draws the control; this module keeps the switches.
//
// Claude Code exposes no way to resolve an alias to a model id or to check
// a model against the organization's allowlist for a turn.step request
// (TurnStepInput.model promises neither, unlike agent.spawn and
// $.model.complete). So a switch names an alias, and only an alias that
// the `availableModels` setting names when it is set.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Model } from '../types'
import { cycleLabel, nextOf } from './keys'
import { MODELS, SETTINGS_KEY, isModel, modelCycle, settingsFrom } from './settings'
import { isEnded } from './states'

/** The model control's element key: this, then the agent id. */
export const MODEL_SWITCH_PREFIX = 'model-switch-'

/** The model control's choice of the model the agent started on. */
export const AS_STARTED = 'as-started'

/** What the model control is on for an agent, whether the allowlist still names it, and what its next press picks. */
export type ModelStep = { on: string; isAllowed: boolean; next: string }

/**
 * The model control's step for an agent switched to `switched` (none: as
 * started), among the models `allowed`: the label and the press both
 * resolve it so. From a model the allowlist no longer names, the next is
 * the first allowed after it in MODELS order, else as started.
 */
export function modelStep(allowed: readonly Model[], switched: Model | undefined): ModelStep {
  const cycle = modelCycle(AS_STARTED, allowed)
  const on = switched ?? AS_STARTED
  return { on, isAllowed: cycle.includes(on), next: nextOf(cycle, on, modelCycle(AS_STARTED)) ?? AS_STARTED }
}

/** The model control's label: the model it's on (said to be no longer allowed), then what the next press picks. */
export function modelControlLabel({ on, isAllowed, next }: ModelStep): string {
  return cycleLabel('model', isAllowed ? choiceName(on) : `${on} (not allowed)`, choiceName(next))
}

function choiceName(choice: string): string {
  return choice === AS_STARTED ? 'as started' : choice
}

/**
 * The step each agent's model control last drew, so a press does what its
 * label said, or says why not: kept here (a drawing never writes $.state),
 * and used only while the agent is still on what the label was drawn from.
 */
const drawnSteps = new Map<string, ModelStep>()

/** Notes the step an agent's model control was drawn with. */
export function noteModelStep(agentId: string, step: ModelStep): void {
  drawnSteps.set(agentId, step)
}

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const switchedModels = atom({ plugin: 'squishys', key: 'switchedModels' } as const, {})
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

/**
 * The models a switch may name, by Claude Code's `availableModels` setting:
 * every alias when it isn't set, else only the aliases it names. An entry
 * naming a full model id allows no alias, since nothing says which id an
 * alias resolves to.
 */
export function allowedModels(availableModels: unknown): Model[] {
  if (!Array.isArray(availableModels)) return [...MODELS]
  const named = availableModels.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim().toLowerCase())
  return MODELS.filter(model => named.includes(model))
}

export function registerModelSwitch(on: On): void {
  // A switched agent's requests go to its model. Only that agent's change,
  // and only while the setting is on, the agent runs and the allowlist
  // names the model; otherwise the switch ends. The request's effort is
  // left out: nothing says the new model takes the one the engine chose.
  on('turn.step', { agentId: /./ }, async function* ($, e, next) {
    const { agentId } = e
    const switched = agentId !== undefined ? (await read($, switchedModels))[agentId] : undefined
    if (agentId === undefined || switched === undefined) return yield* next(e)
    const refusal = await refusalOf($, agentId, switched.model)
    if (refusal !== undefined) {
      await endSwitch($, agentId)
      if (refusal !== ENDED) $.ui.toast(`Squishys: back to the model it started on. ${refusal}`)
      return yield* next(e)
    }
    const { effort: _, ...request } = e
    const response = next({ ...request, model: switched.model })
    let sent = switched.sent
    for await (const chunk of response) {
      if (!sent) {
        sent = true
        await update($, switchedModels, all => {
          const current = all[agentId]
          return current?.model === switched.model ? { ...all, [agentId]: { ...current, sent: true } } : all
        })
      }
      yield chunk
    }
    return await response.result
  })

  // A press of the focus view's model control (m) switches the agent to
  // what its label offered: the next model the allowlist names, after the
  // last back to the one it started on. A model the allowlist stopped
  // naming since is refused, saying why. Its own onPress does nothing.
  on('ui.press', { plugin: 'squishys', element: /^model-switch-/ }, async ($, e, next) => {
    const agentId = e.element.slice(MODEL_SWITCH_PREFIX.length)
    let allowed: Model[]
    try {
      allowed = allowedModels((await $.settings.read()).availableModels)
    } catch {
      $.ui.toast('Squishys: not switched. Claude Code’s settings can’t be read, so the model allowlist can’t be checked.')
      return next(e)
    }
    const step = modelStep(allowed, (await read($, switchedModels))[agentId]?.model)
    const drawn = drawnSteps.get(agentId)
    const picked = drawn?.on === step.on ? drawn.next : step.next
    if (picked === AS_STARTED) await endSwitch($, agentId)
    else if (isModel(picked)) {
      const refusal = await refusalOf($, agentId, picked)
      if (refusal !== undefined) $.ui.toast(`Squishys: not switched to ${picked}. ${refusal}`)
      else await update($, switchedModels, all => ({ ...all, [agentId]: { model: picked, sent: false } }))
    }
    return next(e)
  })

  // The setting turned off ends every switch: a press of its control while it's on.
  on('ui.press', { plugin: 'squishys', element: 'liveModelSwitch' }, async ($, e, next) => {
    let wasOn = false
    try {
      wasOn = settingsFrom(await $.store.get(SETTINGS_KEY)).liveModelSwitch === true
    } catch {}
    const pressed = await next(e)
    if (wasOn) await update($, switchedModels, () => ({}))
    return pressed
  })

  // An agent's switch ends with its run, however it ended.
  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) await endSwitch($, e.agentId)
    return completed
  })

  // A switch lasts one session: /clear, /resume and a branch end them all.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await update($, switchedModels, () => ({}))
    return next(e)
  })
}

/** The refusal for an agent that has ended, which needs no telling. */
const ENDED = 'That agent has ended.'

/** Why the agent can't be on `model` now, or nothing when it can. */
async function refusalOf($: EngineInterface, agentId: string, model: Model): Promise<string | undefined> {
  try {
    if (settingsFrom(await $.store.get(SETTINGS_KEY)).liveModelSwitch !== true) return 'The live model switch is off.'
  } catch {
    return 'Squishys’ settings can’t be read.'
  }
  const agent = (await read($, agents)).find(each => each.id === agentId)
  if (agent === undefined || isEnded(agent.state)) return ENDED
  try {
    if (!allowedModels((await $.settings.read()).availableModels).includes(model)) {
      return `Your availableModels setting doesn’t name ${model}.`
    }
  } catch {
    return 'Claude Code’s settings can’t be read, so the model allowlist can’t be checked.'
  }
  return undefined
}

/** Ends an agent's switch: its requests go to the model the engine picks again. */
async function endSwitch($: EngineInterface, agentId: string): Promise<void> {
  if ((await read($, switchedModels))[agentId] === undefined) return
  await update($, switchedModels, ({ [agentId]: _, ...rest }) => rest)
}
