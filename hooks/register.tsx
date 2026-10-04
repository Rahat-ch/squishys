// The squishys hooks module: wires each feature's hooks into Claude Code.
// Features live in src/ and each exports a register function taking `on`.

import type { Register } from 'claude-code'

import { registerAgentTracking } from '../src/agents'
import { registerBand } from '../src/band'
import { registerFocus } from '../src/focus'
import { registerModelSwitch } from '../src/model-switch'
import { registerPane } from '../src/pane'
import { registerRebuild } from '../src/rebuild'
import { registerSettings } from '../src/settings'

export const register: Register = on => {
  // The order matters: a plugin's registrations nest in order, first
  // outermost. The agent tracker records an agent before the focus view's
  // feed hooks look it up, and the pane's render hook wraps every other
  // mode's, so it can animate the squishys they draw. The model switch's
  // turn.step hook sits inside the tracker's, which sees requests unswitched.
  registerAgentTracking(on)
  registerPane(on)
  registerRebuild(on)
  registerSettings(on)
  registerFocus(on)
  registerModelSwitch(on)
  registerBand(on)
}
