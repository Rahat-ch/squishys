// Experimental: the live model switch. Behind an off-by-default setting, the
// focus view's model control switches a running agent to another model, and
// its effort control to another effort, from its next request on, by
// rewriting that agent's requests in turn.step. The focus view draws the
// controls; this module keeps the switches.
//
// Claude Code exposes no way to resolve an alias to a model id or to check
// a model against the organization's allowlist for a turn.step request
// (TurnStepInput.model promises neither, unlike agent.spawn and
// $.model.complete). So a switch names an alias, and only an alias that
// the `availableModels` setting names when it is set.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, On } from 'claude-code'

import type { Effort, Model, ModelSwitch } from '../types'
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

/** The effort control's element key: this, then the agent id. */
export const EFFORT_SWITCH_PREFIX = 'effort-switch-'

/** The efforts the effort control steps through, after as started: the levels `turn.step` names, least first. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly ModelEffort[]

/** What the effort control steps through. */
const EFFORT_CYCLE = [AS_STARTED, ...EFFORTS]

function isEffort(value: unknown): value is Effort {
  return EFFORTS.includes(value as Effort)
}

/**
 * The effort control's step for an agent switched to `switched` (none: as
 * started): what it's on and what its next press picks, and whether the
 * model the agent is on takes an effort (`isTaken`), without which the
 * control is n/a.
 */
export type EffortStep = { isTaken: boolean; on: string; next: string }

export function effortStep(switched: Effort | undefined, isTaken: boolean): EffortStep {
  const on = switched ?? AS_STARTED
  return { isTaken, on, next: nextOf(EFFORT_CYCLE, on) ?? AS_STARTED }
}

/** The effort control's label: the effort it's on, then what the next press picks; n/a for a model without effort. */
export function effortControlLabel({ isTaken, on, next }: EffortStep): string {
  return isTaken ? cycleLabel('effort', choiceName(on), choiceName(next)) : 'effort n/a'
}

/**
 * Whether the model an agent is on takes an effort, as far as the mod can
 * tell: the engine leaves a request's effort out for a model that takes
 * none, so it's whether the agent's request (`effortTaken`, its latest;
 * none seen yet counts as taken) carried one. That says nothing about a
 * model the live switch moved it to, so a switched agent counts as one
 * that takes none, and is sent none.
 */
export function takesEffort(modelSwitch: ModelSwitch | undefined, effortTaken: boolean | undefined): boolean {
  return modelSwitch === undefined && effortTaken !== false
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
const switchedEfforts = atom({ plugin: 'squishys', key: 'switchedEfforts' } as const, {})
const effortTaken = atom({ plugin: 'squishys', key: 'effortTaken' } as const, {})
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
  // A switched agent's requests go to its model, or carry its effort. Only
  // that agent's change, and only while the setting is on and the agent
  // runs, and for a model while the allowlist names it; otherwise the
  // switch ends. Every agent request notes whether the engine gave it an
  // effort (effortTaken), which it leaves out for a model that takes none,
  // and a chosen effort replaces only an effort the engine gave. A request
  // on a switched model carries no effort, chosen or the engine's: nothing
  // says that model takes one (takesEffort).
  on('turn.step', { agentId: /./ }, async function* ($, e, next) {
    const { agentId } = e
    if (agentId === undefined) return yield* next(e)
    const isTaken = e.effort !== undefined
    if ((await read($, effortTaken))[agentId] !== isTaken) await update($, effortTaken, all => ({ ...all, [agentId]: isTaken }))
    let switched = (await read($, switchedModels))[agentId]
    const effort = (await read($, switchedEfforts))[agentId]
    if (switched === undefined && effort === undefined) return yield* next(e)
    const refusal = await liveRefusal($, agentId)
    if (refusal !== undefined) {
      await endSwitch($, agentId)
      await endEffort($, agentId)
      const what = [switched === undefined ? [] : ['model'], effort === undefined ? [] : ['effort']].flat().join(' and ')
      if (refusal !== ENDED) $.ui.toast(`Squishys: back to the ${what} it started on. ${refusal}`)
      return yield* next(e)
    }
    const notAllowed = switched === undefined ? undefined : await allowlistRefusal($, switched.model)
    if (notAllowed !== undefined) {
      await endSwitch($, agentId)
      $.ui.toast(`Squishys: back to the model it started on. ${notAllowed}`)
      switched = undefined
    }
    if (switched === undefined) return yield* next(effort !== undefined && isTaken ? { ...e, effort } : e)
    const { effort: _, ...request } = e
    const { model } = switched
    const response = next({ ...request, model })
    let sent = switched.sent
    for await (const chunk of response) {
      if (!sent) {
        sent = true
        await update($, switchedModels, all => {
          const current = all[agentId]
          return current?.model === model ? { ...all, [agentId]: { ...current, sent: true } } : all
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

  // A press of the focus view's effort control (e) switches the agent to the
  // next effort, after max back to the one it started on, while the model
  // it's on takes one. Its own onPress does nothing.
  on('ui.press', { plugin: 'squishys', element: /^effort-switch-/ }, async ($, e, next) => {
    const agentId = e.element.slice(EFFORT_SWITCH_PREFIX.length)
    const modelSwitch = (await read($, switchedModels))[agentId]
    const step = effortStep((await read($, switchedEfforts))[agentId], takesEffort(modelSwitch, (await read($, effortTaken))[agentId]))
    if (!step.isTaken) {
      $.ui.toast(
        modelSwitch === undefined
          ? 'Squishys: no effort set. This agent’s model takes none.'
          : `Squishys: no effort set. Nothing says whether ${modelSwitch.model} takes one, so it’s sent none.`,
      )
    } else if (step.next === AS_STARTED) await endEffort($, agentId)
    else if (isEffort(step.next)) {
      const picked = step.next
      const refusal = await liveRefusal($, agentId)
      if (refusal !== undefined) $.ui.toast(`Squishys: effort not set to ${picked}. ${refusal}`)
      else await update($, switchedEfforts, all => ({ ...all, [agentId]: picked }))
    }
    return next(e)
  })

  // The setting turned off ends every switch, of model and effort: a press of its control while it's on.
  on('ui.press', { plugin: 'squishys', element: 'liveModelSwitch' }, async ($, e, next) => {
    let wasOn = false
    try {
      wasOn = settingsFrom(await $.store.get(SETTINGS_KEY)).liveModelSwitch === true
    } catch {}
    const pressed = await next(e)
    if (wasOn) {
      await update($, switchedModels, () => ({}))
      await update($, switchedEfforts, () => ({}))
    }
    return pressed
  })

  // An agent's switch ends with its run, however it ended.
  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) {
      await endSwitch($, e.agentId)
      await endEffort($, e.agentId)
    }
    return completed
  })

  // A switch lasts one session: /clear, /resume and a branch end them all.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await update($, switchedModels, () => ({}))
    await update($, switchedEfforts, () => ({}))
    return next(e)
  })
}

/** The refusal for an agent that has ended, which needs no telling. */
const ENDED = 'That agent has ended.'

/** Why the agent can't be on `model` now, or nothing when it can. */
async function refusalOf($: EngineInterface, agentId: string, model: Model): Promise<string | undefined> {
  return (await liveRefusal($, agentId)) ?? (await allowlistRefusal($, model))
}

/** Why the agent can't be switched now, to any model or effort, or nothing when it can: the setting is off or it has ended. */
async function liveRefusal($: EngineInterface, agentId: string): Promise<string | undefined> {
  try {
    if (settingsFrom(await $.store.get(SETTINGS_KEY)).liveModelSwitch !== true) return 'The live model switch is off.'
  } catch {
    return 'Squishys’ settings can’t be read.'
  }
  const agent = (await read($, agents)).find(each => each.id === agentId)
  if (agent === undefined || isEnded(agent.state)) return ENDED
  return undefined
}

/** Why the allowlist keeps an agent off `model`, or nothing when it names it. */
async function allowlistRefusal($: EngineInterface, model: Model): Promise<string | undefined> {
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

/** Ends an agent's effort switch: its requests carry the effort the engine picks again. */
async function endEffort($: EngineInterface, agentId: string): Promise<void> {
  if ((await read($, switchedEfforts))[agentId] === undefined) return
  await update($, switchedEfforts, ({ [agentId]: _, ...rest }) => rest)
}
