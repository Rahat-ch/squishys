// The squishys mod's $.state contract: every value the hooks module keeps
// in the session's state, declared under the plugin's name. The module
// imports these types from '../types'; `claude plugin validate` holds each
// $.state key it names to this file.
//
// `claude plugin validate` wants this file self-contained (no imports), so
// a type the pure modules also define is written out again here. The mod
// hands values both ways between the two, so the typecheck fails if they
// drift apart.

/** How seldom a part or squishy turns up. Mirrors `Rarity` in src/kit.ts. */
export type Rarity = 'common' | 'uncommon' | 'rare'

/**
 * A squishy's identity, as the roller decides it. Mirrors `Squishy` in
 * src/roller.ts.
 */
export type Squishy =
  | {
      kind: 'assembled'
      /** The species: body and face part ids. */
      body: string
      face: string
      /** The variant: palette and accessory part ids. */
      palette: string
      accessory: string
      /** The rarity of its rarest part. */
      rarity: Rarity
      shiny: boolean
      /** The squishy's Name, shown on its button under its picture. */
      name: string
      /** Stable identity: the same parts and shininess always give the same key. */
      key: string
    }
  | {
      kind: 'legendary'
      legendary: string
      shiny: boolean
      /** The legendary's fixed Name. */
      name: string
      key: string
    }

/** One agent the orchestrator started, with the squishy that stands for it. */
export type Agent = {
  /**
   * The agent's id: what agent.spawn's result, tool.call's `agentId` and
   * `$.agent.list()` all call it.
   */
  id: string
  /** What the agent was asked to do, shown under its squishy's name. */
  description: string
  squishy: Squishy
}

/**
 * What the pane is showing. Later modes (starter pick, focus view,
 * Squishydex) join this union.
 */
export type PaneMode = 'roster' | 'settings'

declare module 'claude-code' {
  interface PluginState {
    squishys: {
      /** Every agent seen this session, in the order they were first seen. */
      agents: Agent[]
      /** What the pane is showing; the roster until the user picks another. */
      mode: PaneMode
    }
  }
}
