// Stop's rules, and the agents it is stopping, as plain data. The focus
// view's Stop control (src/focus.tsx) and the agent tracker's hooks
// (src/agents.ts) make every `$` call themselves and ask this module what
// to do.
//
// The fallback, for an agent TaskStop didn't stop: the agent is held back,
// so the tracker refuses its tool calls and answers its next model request
// with the end of its run, without the model. Once the run has ended, the
// agent is remembered as stopped by the user (its squishy is Squished,
// whatever the end says) until it resumes. A reload forgets all of it, so
// whatever the focus view draws from it can't go stale.

import type { AgentInfo, ToolCallResult } from 'claude-code'

import type { StopControl } from '../types'

/** What the tool calls of an agent held back get, and the answer that ends its run. */
export const STOPPED_BY_USER = 'Stopped by the user'

/** How long, in milliseconds, a first press of Stop waits for the second. */
export const STOP_CONFIRM_MS = 3000

/**
 * How long, in milliseconds, Stop waits for TaskStop to answer before it
 * holds the agent back instead.
 */
export const STOP_WAIT_MS = 2000

/**
 * The agents Stop is dealing with: held back until their run ends (with
 * TaskStop's refusal, if it gave one), or stopped by the user since then.
 */
const marks = new Map<string, { held: true; refusal?: string } | { held: false }>()

/** The agents whose TaskStop call is under way. */
const asking = new Set<string>()

/** Whether a press of Stop now, for this agent, is the second within STOP_CONFIRM_MS. */
export function isArmed(control: StopControl | null, agentId: string, now: number): boolean {
  return control?.agentId === agentId && now - control.armedAt < STOP_CONFIRM_MS
}

/** A Stop control with this agent's arming taken off. */
export function disarmed(control: StopControl | null, agentId?: string): StopControl | null {
  return agentId === undefined || control?.agentId === agentId ? null : control
}

/** TaskStop is under way for this agent, or no longer is. */
export function askingTaskStop(agentId: string, under: boolean): void {
  if (under) asking.add(agentId)
  else asking.delete(agentId)
}

/** Holds an agent back: the fallback for when TaskStop didn't stop it. */
export function holdBack(agentId: string, refusal?: string): void {
  marks.set(agentId, { held: true, ...(refusal === undefined ? {} : { refusal }) })
}

/** Whether the tracker holds this agent back. */
export function isHeldBack(agentId: string): boolean {
  return marks.get(agentId)?.held === true
}

/** Whether the user stopped this agent's run (held back now, or since): its squishy is Squished. */
export function wasStoppedByUser(agentId: string): boolean {
  return marks.has(agentId)
}

/** An agent's run has ended: no longer held back, and remembered as stopped by the user if it was. */
export function runEnded(agentId: string): void {
  if (marks.has(agentId)) marks.set(agentId, { held: false })
}

/** An ended agent resumed: Stop has nothing on it. */
export function resumed(agentId: string): void {
  marks.delete(agentId)
}

/** A rebuilt session (/clear, /resume, a branch): Stop has nothing on any agent. */
export function forgetStops(): void {
  marks.clear()
}

/**
 * The stop of this agent under way, if any: TaskStop's call, or the agent
 * held back, with TaskStop's refusal if it gave one.
 */
export function stopUnderWay(agentId: string): { by: 'taskStop' } | { by: 'holdingBack'; refusal?: string } | undefined {
  if (asking.has(agentId)) return { by: 'taskStop' }
  const mark = marks.get(agentId)
  if (mark?.held !== true) return undefined
  return { by: 'holdingBack', ...(mark.refusal === undefined ? {} : { refusal: mark.refusal }) }
}

/**
 * The id TaskStop takes for an agent, by its agent list entry: a teammate's
 * address (`teammateId`) or its name, any other agent's id.
 */
export function taskIdOf(agentId: string, listed: readonly AgentInfo[]): string {
  const entry = listed.find(each => each.id === agentId)
  return entry?.teammateId ?? (entry?.type === 'teammate' ? entry.name : undefined) ?? agentId
}

/** The agent list entry a TaskStop `task_id` names: by id, a teammate's address, or name. */
export function entryNamed(taskId: string, listed: readonly AgentInfo[]): AgentInfo | undefined {
  return (
    listed.find(each => each.id === taskId) ?? listed.find(each => each.teammateId === taskId) ?? listed.find(each => each.name === taskId)
  )
}

/** Why TaskStop didn't stop the agent, by its result; undefined when it answered that it did. */
export function refusalOf(result: ToolCallResult): string | undefined {
  return result.deny ?? (result.isError === true ? (result.text ?? String(result.result)) : undefined)
}

/** Why TaskStop didn't stop the agent, when its call rejected. */
export function failureOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
