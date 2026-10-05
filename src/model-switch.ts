// The next run's model and effort: the focus view's model and effort
// controls pick, for one agent, what its next run uses, typically while it's
// Asleep, applied when it's resumed by rewriting that run's requests in
// turn.step. A run never changes model or effort partway: a pick made while
// the agent works waits for its next run. The focus view draws the controls;
// this module keeps the picks.
//
// What the spike for #65 found (Claude Code 2.1.289): a resumed run's
// requests come in on the model the agent started on, every run, so a pick
// is applied to every request of every run after it. A request rewritten to
// a bare alias fails (404 model_not_found, the agent Squished), and nothing
// on $ resolves an alias, so a pick is sent as the full id the session's own
// requests named for that model. A run a redirect resumes (the mod's own
// $.session.send) never reaches the mod's turn.step, so a redirect to an
// Asleep agent with a pick goes through Claude instead (src/focus.tsx).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, On, TurnStepInput } from 'claude-code'

import type { Agent, Effort, Model, NextRun, RunChoice } from '../types'
import type { Hold } from './held'
import { cycleLabel, nextOf } from './keys'
import { MODELS, isModel, modelCycle } from './settings'

/** The model control's element key: this, then the agent id. */
export const MODEL_SWITCH_PREFIX = 'model-switch-'

/** The effort control's element key: this, then the agent id. */
export const EFFORT_SWITCH_PREFIX = 'effort-switch-'

/** The model and effort controls' choice of what the agent started on. */
export const AS_STARTED = 'as-started'

/** What the model control's label starts with, and the effort control's. */
export const MODEL_CONTROL_NAME = 'next run'
export const EFFORT_CONTROL_NAME = 'next run effort'

/**
 * What the focus view says while a pick is set, by whether the agent has
 * ended. A redirect to a running agent joins the run it's on (an append),
 * which keeps its model. A run the mod's own $.session.send resumes never
 * reaches the mod's turn.step, so a redirect to an ended agent with a pick
 * goes through Claude, whose SendMessage resumes it on the pick.
 */
export const NEXT_RUN_NOTE_RUNNING = 'Applies from its next run. A redirect now joins the run it’s on, on its current model.'
export const NEXT_RUN_NOTE_ENDED = 'Applies from its next run. A redirect from here goes through Claude, so the pick applies.'

/** Why the model control is held: nothing but as started to pick. */
export const NO_OTHER_MODEL: Hold = {
  why: 'nothing else yet',
  reason:
    'no other model to pick yet. A model can be picked once this session runs on it (Claude, or an agent), since only its full id works for a request, and only while your availableModels setting allows it.',
}

/** Why the effort control is held: the model the next run uses takes none. */
export const NO_EFFORT_TAKEN: Hold = { why: 'n/a', reason: 'no effort to pick. The model its next run uses takes none.' }

/** What the model control is on for an agent, whether the allowlist still names it, and what its next press picks. */
export type ModelStep = { on: string; isAllowed: boolean; next: string }

/**
 * The model control's step for an agent with `picked` (none: as started),
 * among the models `offered`: the label and the press both resolve it so.
 * From a model no longer offered, the next is the first offered after it in
 * MODELS order, else as started.
 */
export function modelStep(offered: readonly Model[], picked: Model | undefined): ModelStep {
  const cycle = modelCycle(AS_STARTED, offered)
  const on = picked ?? AS_STARTED
  return { on, isAllowed: cycle.includes(on), next: nextOf(cycle, on, modelCycle(AS_STARTED)) ?? AS_STARTED }
}

/** The model control's label: the model it's on (said to be no longer allowed), then what the next press picks, if anything else. */
export function modelControlLabel({ on, isAllowed, next }: ModelStep): string {
  const now = isAllowed ? choiceName(on) : `${on} (not allowed)`
  return next === on ? `${MODEL_CONTROL_NAME}  ${now}` : cycleLabel(MODEL_CONTROL_NAME, now, choiceName(next))
}

function choiceName(choice: string): string {
  return choice === AS_STARTED ? 'as started' : choice
}

/** The efforts the effort control steps through, after as started: the levels `turn.step` names, least first. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly Effort[]

// `Effort` is written out in types/index.d.ts, which `claude plugin
// validate` wants import-free, so it mirrors the engine's ModelEffort
// rather than naming it: this fails to typecheck once the two drift.
const EFFORT_MIRRORS_ENGINE: [Effort, ModelEffort] extends [ModelEffort, Effort] ? true : false = true
void EFFORT_MIRRORS_ENGINE

/** What the effort control steps through. */
const EFFORT_CYCLE = [AS_STARTED, ...EFFORTS]

function isEffort(value: unknown): value is Effort {
  return EFFORTS.includes(value as Effort)
}

/**
 * The models a request of this session has named, by id, and whether it
 * carried an effort (`seenModels` in $.state).
 */
export type SeenModels = Readonly<Record<string, boolean>>

/**
 * Where an agent's pick finds a model's full id: the model the agent started
 * on (`own`), the session's main model (`main`, `$.session.model()`), and the
 * models the other agents started on, as agent.spawn's results named them.
 * Never a request's model alone, which may be a fallback's.
 */
export type ModelSources = { own?: string; main?: string; others: readonly string[] }

/** An agent's ModelSources, from the agents known and the session's main model. */
export function modelSources(known: readonly Agent[], agentId: string, main: string | undefined): ModelSources {
  return {
    own: known.find(agent => agent.id === agentId)?.model,
    main,
    others: known.flatMap(agent => (agent.id === agentId || agent.model === undefined ? [] : [agent.model])),
  }
}

/**
 * The model alias a full model id is of: the one a whole segment of it names
 * (`claude-opus-5-5[1m]` is opus), else the one it holds anywhere.
 */
export function familyOf(modelId: string): Model | undefined {
  const name = modelId.toLowerCase()
  const segments = name.split(/[^a-z0-9]+/)
  return MODELS.find(model => segments.includes(model)) ?? MODELS.find(model => name.includes(model))
}

/**
 * The full id an agent's pick of each model alias is sent as: the model the
 * agent started on, when it's that alias, else the session's main model,
 * else the latest other agent's.
 */
export function modelIds({ own, main, others }: ModelSources): Partial<Record<Model, string>> {
  const ids: Partial<Record<Model, string>> = {}
  // Least preferred first, so a preferred one takes its alias over
  for (const id of [...others, ...(main === undefined ? [] : [main]), ...(own === undefined ? [] : [own])]) {
    const family = familyOf(id)
    if (family !== undefined) ids[family] = id
  }
  return ids
}

/**
 * Whether Claude Code's `availableModels` setting lets an agent run on the
 * model `family` by the full id `id`: always when it isn't set, else when it
 * names the alias or the id.
 */
function isAllowed(availableModels: unknown, family: Model, id: string): boolean {
  if (!Array.isArray(availableModels)) return true
  const named = availableModels.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim().toLowerCase())
  return named.includes(family) || named.includes(id.toLowerCase())
}

/**
 * The models the model control offers: each one with a full id from its
 * sources, that `availableModels` allows, but the one the agent started on,
 * which is as started.
 */
export function offeredModels(sources: ModelSources, availableModels: unknown): Model[] {
  const ids = modelIds(sources)
  const startedOn = sources.own === undefined ? undefined : familyOf(sources.own)
  return MODELS.filter(family => {
    const id = ids[family]
    return family !== startedOn && id !== undefined && isAllowed(availableModels, family, id)
  })
}

/**
 * The effort control's step for an agent: what it's on (as started, or the
 * effort picked) and what its next press picks, and whether the model its
 * next run uses takes an effort (`isTaken`), without which the control is
 * n/a.
 */
export type EffortStep = { isTaken: boolean; on: string; next: string }

/** What the effort control's step is worked out from: `$.state` values and the agent's ModelSources. */
export type EffortState = {
  nextRuns: Readonly<Record<string, NextRun>>
  seenModels: SeenModels
  sources: ModelSources
}

/** An agent's effort step: the label and the press both resolve it so. */
export function effortStep(agentId: string, { nextRuns, seenModels, sources }: EffortState): EffortStep {
  const picked = nextRuns[agentId]
  const on = picked?.effort ?? AS_STARTED
  return { isTaken: takesEffort(picked?.model, seenModels, sources), on, next: nextOf(EFFORT_CYCLE, on) ?? AS_STARTED }
}

/** The effort control's label while the model its next run uses takes an effort: the effort it's on, then what the next press picks. */
export function effortControlLabel({ on, next }: EffortStep): string {
  return cycleLabel(EFFORT_CONTROL_NAME, choiceName(on), choiceName(next))
}

/**
 * Whether the model an agent's next run uses takes an effort, as far as the
 * session's requests tell: the engine leaves a request's effort out for a
 * model that takes none. A model picked that no request has named yet
 * counts as taking none. One the agent started on that no request has named
 * yet counts as taking one; its own requests still decide (`withRunChoice`).
 */
function takesEffort(picked: Model | undefined, seen: SeenModels, sources: ModelSources): boolean {
  const { own } = sources
  if (picked !== undefined) {
    const id = modelIds(sources)[picked]
    return id !== undefined && seen[id] === true
  }
  return own === undefined || seen[own] !== false
}

/**
 * A request of a run as its RunChoice has it: on the model picked, carrying
 * the effort picked (else the request's own) only while that model takes
 * one; on the model it started on, the effort picked only where the request
 * carries one.
 */
function withRunChoice(e: TurnStepInput, run: RunChoice | undefined, seen: SeenModels): TurnStepInput {
  if (run?.model !== undefined) {
    const { effort: own, ...request } = e
    const effort = run.effort ?? own
    return seen[run.model] === true && effort !== undefined ? { ...request, model: run.model, effort } : { ...request, model: run.model }
  }
  if (run?.effort !== undefined && e.effort !== undefined) return { ...e, effort: run.effort }
  return e
}

/**
 * The step each agent's controls last drew, so a press does what its label
 * said: kept here (a drawing never writes $.state), and used only while the
 * agent is still on what the label was drawn from.
 */
const drawnModelSteps = new Map<string, ModelStep>()
const drawnEffortSteps = new Map<string, EffortStep>()

/** Notes the step an agent's model control was drawn with. */
export function noteModelStep(agentId: string, step: ModelStep): void {
  drawnModelSteps.set(agentId, step)
}

/** Notes the step an agent's effort control was drawn with. */
export function noteEffortStep(agentId: string, step: EffortStep): void {
  drawnEffortSteps.set(agentId, step)
}

// The engine reads each $.state reference off the file that uses it, so
// every file declares its own atom for the values it reads or writes.
const nextRuns = atom({ plugin: 'squishys', key: 'nextRuns' } as const, {})
const runChoices = atom({ plugin: 'squishys', key: 'runChoices' } as const, {})
const seenModels = atom({ plugin: 'squishys', key: 'seenModels' } as const, {})
const agents = atom({ plugin: 'squishys', key: 'agents' } as const, [])

export function registerModelSwitch(on: On): void {
  // Every request (the matcher fits them all, the orchestrator's included)
  // notes its model id and whether it carried an effort, written only as
  // something new is learned. An agent's request goes as its run's choice
  // has it, settled at the run's first request.
  on('turn.step', { model: /./ }, async function* ($, e, next) {
    const carries = e.effort !== undefined
    const before = await read($, seenModels)
    // Every read of one dispatch reads one moment, so later code here uses this, not a read
    const seen = before[e.model] === carries ? before : { ...before, [e.model]: carries }
    if (seen !== before) await update($, seenModels, all => ({ ...all, [e.model]: carries }))
    const { agentId } = e
    if (agentId === undefined) return yield* next(e)
    return yield* next(withRunChoice(e, await runChoiceOf($, agentId, e.turnId), seen))
  })

  // A press of the focus view's model control (m) picks what its label
  // offered for the agent's next run: the next model offered, after the
  // last back to the one it started on. A model the allowlist stopped
  // naming since is refused, saying why. Its own onPress does nothing.
  on('ui.press', { plugin: 'squishys', element: /^model-switch-/ }, async ($, e, next) => {
    const agentId = e.element.slice(MODEL_SWITCH_PREFIX.length)
    let offered: Model[]
    try {
      offered = offeredModels(await sourcesOf($, agentId), (await $.settings.read()).availableModels)
    } catch {
      $.ui.toast('Squishys: nothing picked. Claude Code’s settings can’t be read, so the model allowlist can’t be checked.')
      return next(e)
    }
    const step = modelStep(offered, (await read($, nextRuns))[agentId]?.model)
    const drawn = drawnModelSteps.get(agentId)
    const picked = drawn?.on === step.on ? drawn.next : step.next
    if (picked === step.on) $.ui.toast(`Squishys: ${NO_OTHER_MODEL.reason}`)
    else if (picked === AS_STARTED) await pickFor($, agentId, { model: undefined })
    else if (isModel(picked)) {
      if (offered.includes(picked)) await pickFor($, agentId, { model: picked })
      else $.ui.toast(`Squishys: ${picked} not picked. Your availableModels setting doesn’t name it.`)
    }
    return next(e)
  })

  // A press of the focus view's effort control (e) picks the next effort
  // for the agent's next run, after max back to the one it started on,
  // while the model that run uses takes one. Its own onPress does nothing.
  on('ui.press', { plugin: 'squishys', element: /^effort-switch-/ }, async ($, e, next) => {
    const agentId = e.element.slice(EFFORT_SWITCH_PREFIX.length)
    const current = effortStep(agentId, {
      nextRuns: await read($, nextRuns),
      seenModels: await read($, seenModels),
      sources: await sourcesOf($, agentId),
    })
    const drawn = drawnEffortSteps.get(agentId)
    const step = drawn?.on === current.on && drawn.isTaken === current.isTaken ? drawn : current
    if (!step.isTaken) $.ui.toast(`Squishys: ${NO_EFFORT_TAKEN.reason}`)
    else if (step.next === AS_STARTED) await pickFor($, agentId, { effort: undefined })
    else if (isEffort(step.next)) await pickFor($, agentId, { effort: step.next })
    return next(e)
  })

  // Picks last one session: /clear, /resume and a branch end them all.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await update($, nextRuns, () => ({}))
    await update($, runChoices, () => ({}))
    await update($, seenModels, () => ({}))
    return next(e)
  })
}

/**
 * What the agent's run `turnId` uses: settled at its first request from the
 * agent's pick and kept for the run, so a pick made meanwhile waits for the
 * next run. A model the allowlist no longer names is dropped from the pick,
 * saying why, and the run goes on the model it started on.
 */
async function runChoiceOf($: EngineInterface, agentId: string, turnId: string): Promise<RunChoice> {
  const settled = (await read($, runChoices))[agentId]
  if (settled?.turnId === turnId) return settled
  const picked = (await read($, nextRuns))[agentId]
  let model: string | undefined
  if (picked?.model !== undefined) {
    const id = modelIds(await sourcesOf($, agentId))[picked.model]
    const refusal = await refusalOf($, picked.model, id)
    if (refusal === undefined) model = id
    else {
      await pickFor($, agentId, { model: undefined })
      $.ui.toast(`Squishys: this run is on the model it started on, not ${picked.model}. ${refusal}`)
    }
  }
  const run: RunChoice = { turnId, ...(model !== undefined ? { model } : {}), ...(picked?.effort !== undefined ? { effort: picked.effort } : {}) }
  await update($, runChoices, all => ({ ...all, [agentId]: run }))
  return run
}

/** Why an agent's run can't be on `family` (by the full id `id`), or nothing when it can. */
async function refusalOf($: EngineInterface, family: Model, id: string | undefined): Promise<string | undefined> {
  if (id === undefined) return `This session no longer runs anything on ${family}.`
  try {
    if (!isAllowed((await $.settings.read()).availableModels, family, id)) return `Your availableModels setting doesn’t name ${family}.`
  } catch {
    return 'Claude Code’s settings can’t be read, so the model allowlist can’t be checked.'
  }
  return undefined
}

/** An agent's ModelSources: the agents known and the session's main model, when it can be read. */
async function sourcesOf($: EngineInterface, agentId: string): Promise<ModelSources> {
  let main: string | undefined
  try {
    main = await $.session.model()
  } catch {}
  return modelSources(await read($, agents), agentId, main)
}

/** Changes an agent's pick: a field set to undefined goes back to as started, and a pick left empty goes. */
async function pickFor($: EngineInterface, agentId: string, change: { model?: Model | undefined; effort?: Effort | undefined }): Promise<void> {
  await update($, nextRuns, all => {
    const { [agentId]: was, ...rest } = all
    const merged = { ...was, ...change }
    const kept: NextRun = {
      ...(merged.model !== undefined ? { model: merged.model } : {}),
      ...(merged.effort !== undefined ? { effort: merged.effort } : {}),
    }
    return Object.keys(kept).length === 0 ? rest : { ...rest, [agentId]: kept }
  })
}
