// Inputs Claude Code would hand the mod, shared by the test files.

// What Claude Code passes to the pane's ui.render hook, apart from the surface
export const PANE = {
  plugin: 'squishys',
  component: 'Pane',
  requestId: 'squishys',
  viewport: { columns: 160, rows: 40, isFullscreen: true },
  props: {
    title: 'Squishys',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// The full agent.spawn input, as the Agent tool hands it to the hooks
export function spawnOf(toolUseId: string) {
  return {
    tool_use_id: toolUseId,
    prompt: 'Find where the config is parsed',
    description: 'Find config parser',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as const
}

// A Read the agent with this id makes from inside its own loop. The kit's
// `$.tool.call` arguments don't list `agentId` (a plugin's own call never
// sets it), but the engine carries it to the hooks as a subagent's call does.
export function readFrom(agentId: string, filePath: string) {
  return { tool: 'Read', file_path: filePath, agentId } as const
}

// The person typing /squishys at the prompt of a fullscreen terminal
export const SQUISHYS_COMMAND = {
  command: 'squishys',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const
