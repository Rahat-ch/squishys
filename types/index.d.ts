// The squishys mod's $.state contract: every value the hooks module keeps
// in the session's state, declared under the plugin's name. The module
// imports these types from '../types'; `claude plugin validate` holds each
// $.state key it names to this file.

/**
 * The squishy assigned to one agent. A placeholder for now: the roller
 * adds its identity (species, variant, shiny, rarity) later.
 */
export type Squishy = {
  /** The squishy's Name, shown on its button under its picture. */
  name: string
}

/** One agent the orchestrator started, with the squishy that stands for it. */
export type Agent = {
  /**
   * The agent's id: what agent.spawn's result, tool.call's `agentId` and
   * `$.agent.list()` all call it.
   */
  id: string
  squishy: Squishy
}

declare module 'claude-code' {
  interface PluginState {
    squishys: {
      /** Every agent seen this session, in the order they were first seen. */
      agents: Agent[]
    }
  }
}
