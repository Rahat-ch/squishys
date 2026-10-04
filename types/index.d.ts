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

/**
 * What a squishy shows about its agent. Mirrors `SquishyState` in
 * src/states.ts.
 */
export type SquishyState = 'working' | 'thinking' | 'needsYou' | 'asleep' | 'squished'

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
  /** What the agent is doing now, which its squishy's pose shows. */
  state: SquishyState
  /**
   * The model the agent runs on, as agent.spawn's result names it; absent
   * for an agent first seen through its tool call.
   */
  model?: string
}

/** A model alias the Agent tool takes. Mirrors `Model` in src/settings.tsx. */
export type Model = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** Experimental: the model an agent was switched to in its focus view. */
export type ModelSwitch = {
  model: Model
  /** Whether a request has gone out on it yet; until then it's still switching. */
  sent: boolean
}

/** One row of an agent's activity feed in its focus view. */
export type ActivityRow =
  | {
      kind: 'tool'
      /** The tool the agent called. */
      tool: string
      /** A short line of the call's arguments: the command, path or pattern. */
      summary: string
    }
  | {
      kind: 'answer'
      /**
       * The agent's final answer, as markdown a Markdown can draw. A feed
       * keeps only its latest.
       */
      text: string
    }
  | {
      /**
       * A run that ended without a final answer: interrupted, failed, or
       * stopped by the user through the focus view's Stop control.
       */
      kind: 'interrupted' | 'failed' | 'stopped'
    }
  | {
      /** A message the user redirected the agent with, once it was delivered. */
      kind: 'redirect'
      /** The message, as the user typed it. */
      text: string
    }

/** The latest redirect: being sent, or what became of it. Its agent's focus view shows it until it's cleared. */
export type Delivery = {
  /** The agent the message was for. */
  agentId: string
  /** Whether the agent had ended when the message went: once that changes, the delivery no longer shows. */
  wasEnded: boolean
  /** What became of it; absent while it's being sent. */
  outcome?: RedirectOutcome
}

/** What became of a redirect. */
export type RedirectOutcome =
  | {
      isDelivered: true
      /** Sent to an agent that had ended, which the message resumed. */
      viaResume: boolean
    }
  | {
      isDelivered: false
      /** Why not, as Claude Code or the refusing plugin said. */
      reason: string
    }

/**
 * The focus view's Stop control armed by a first press, for one agent: a
 * second press within STOP_CONFIRM_MS of `armedAt` (`$.clock.now()`) stops
 * the agent.
 */
export type StopControl = { agentId: string; armedAt: number }

/**
 * What the pane is showing: `starter` is the starter pick, while no partner
 * is saved; `squishydex` is the Squishydex.
 */
export type PaneMode = 'roster' | 'settings' | 'focus' | 'starter' | 'squishydex'

declare module 'claude-code' {
  interface PluginState {
    squishys: {
      /** Every agent seen this session, in the order they were first seen. */
      agents: Agent[]
      /** What the pane is showing; the roster until the user picks another. */
      mode: PaneMode
      /** The agent whose focus view the pane shows, once one is picked. */
      focusedAgentId: string | null
      /**
       * Each agent's feed, one member per agent id: its latest activity,
       * oldest first, kept after the agent ends.
       */
      activity: StateFamily<ActivityRow[]>
      /** The focus view's Stop control, while a first press has armed it for an agent. */
      stopControl: StopControl | null
      /** The agents that have a feed, so feeds of agents no longer known can be emptied. */
      fedAgentIds: string[]
      /** The latest redirect, being sent or what became of it; null when there's none to show. */
      delivery: Delivery | null
      /**
       * Experimental: the model each agent was switched to in its focus view,
       * by agent id, which its requests use from then on. An agent's switch
       * ends with its run; all end when the live model switch is turned off.
       */
      switchedModels: Record<string, ModelSwitch>
      /**
       * Claude Code's `prefersReducedMotion` setting, read at session start
       * and after each /config change: while it's on, nothing animates.
       */
      reducedMotion: boolean
      /** Whether the roster shows its overflow list in place of its slots. */
      overflowOpen: boolean
      /** Which page of its species the Squishydex shows, from 0. */
      squishydexPage: number
      /**
       * The species or legendary whose card the Squishydex shows, by its
       * place's key (a species key, or a legendary's squishy key); none for
       * its pages.
       */
      squishydexPicked: string | null
      /** The palette picked on a species' card for making it the partner; none for the first met. */
      squishydexPalette: string | null
    }
  }
}
