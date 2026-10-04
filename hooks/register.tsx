// The squishys hooks module: wires each feature's hooks into Claude Code.
// Features live in src/ and each exports a register function taking `on`.

import type { Register } from 'claude-code'

import { registerAgentTracking } from '../src/agents'
import { registerPane } from '../src/pane'
import { registerSettings } from '../src/settings'

export const register: Register = on => {
  registerAgentTracking(on)
  registerPane(on)
  registerSettings(on)
}
