# Claude Code mods: can they build "squishys"?

Research date: 2026-10-03. Docs read as published on code.claude.com (the mods reference says it describes v2.1.287). The type declarations quoted below were written by Claude Code 2.1.288; the installed CLI on this machine is 2.1.289. The mods API is labeled **early access** and "may change between releases without notice" (T:4), so re-check anything load-bearing against the types for your build before you build on it.

## Sources and citation keys

Every claim below carries an inline link or one of these keys:

| Key | Source |
| :- | :- |
| `T:<line>` | `/private/tmp/claude-501/bundled-skills/2.1.288/51421f3d76d6ed9e41de973c786f0a94/plugin-authoring/types/claude-code.d.ts`: the engine-written TypeScript declarations for this build (20,198 lines). Per the docs this is the authoritative API reference, and it wins over the web copy when the two disagree ([reference](https://code.claude.com/docs/en/plugins/mods/reference)). It sits in a temp folder that gets regenerated: each time the skill loads, Claude Code writes a fresh copy, and a mod loaded from disk gets its own copy in `.claude-plugin/types/` ([create](https://code.claude.com/docs/en/plugins/mods/create)). |
| `SKREF` | `/private/tmp/claude-501/bundled-skills/2.1.288/51421f3d76d6ed9e41de973c786f0a94/plugin-authoring/reference.md`: the long form of the first-party `plugin-authoring` skill |
| `SKILL` | The `plugin-authoring` skill's SKILL.md. It was loaded through the Skill tool. **It is not on disk** at `/Users/rahat-clawd/.claude/skills/plugin-authoring/SKILL.md`, the path the brief gave. It is the built-in `cc-plugin-plugin-authoring` skill ([overview, built-in mods](https://code.claude.com/docs/en/plugins/mods/overview#mods-built-into-claude-code)), and its folder holds only `reference.md`, `types/` and `examples/`. |
| `EX/<file>` | `/private/tmp/claude-501/bundled-skills/2.1.288/51421f3d76d6ed9e41de973c786f0a94/plugin-authoring/examples/<file>` |

Anything marked **(inferred)** is my reading and not stated in a source. When I write "not documented", I looked and found nothing.

---

## 1. TL;DR feasibility verdict

**Overall:** most of squishys can be built as a single mod in the terminal. The roster pane, random sprites, the wiggle, live activity, redirect and model override are all supported by documented APIs. Three parts are weak. **Swapping a subagent into the main panel** is a host feature that mods can read but not drive. **Stop** has no dedicated API, only indirect routes. **The Desktop Code tab** can't draw `Raster`/`Image`, so sprites there need a different renderer.

| Feature | Verdict | Why (details in §3) |
| :- | :- | :- |
| Tiny pixel sprite per subagent (terminal) | **Feasible** | `Raster` element: a cell grid where each cell carries a code point plus 24-bit fg and bg. Half-blocks and braille are allowed, but colors are rounded to a smaller palette ([interface](https://code.claude.com/docs/en/plugins/mods/interface#draw-a-grid-of-colored-cells), T:8617, [gallery](https://code.claude.com/docs/en/plugins/mods/gallery)) |
| Same sprites in Desktop Code tab | **Partially** | The Desktop app has no `Raster` or `Image` but does have `Svg`, and `Client` works in both apps ([reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements)) |
| 2-frame wiggle animation | **Feasible** | `$.ui.blit` repaints a `Raster` with no render pass (up to 120 a second taken) (T:2179). `$.clock.every` provides timers, and `Client` modules have a frame clock (T:1377) |
| Lots of variants, random pick per spawn | **Feasible** | The `agent.spawn` hook fires before every subagent starts, and the mod picks a variant there with plain JS ([reference#subagents](https://code.claude.com/docs/en/plugins/mods/reference#subagents), T:239) |
| Squishys in a side panel | **Feasible, with caveats** | A `Pane` docks beside the transcript only in fullscreen at 110+ columns. Otherwise it sits inline above the prompt, and only one pane shows at a time (the rest become tabs) (T:9632) |
| Limited number of visible slots | **Feasible** | This is the mod's own layout logic. No engine feature is needed |
| Click a squishy | **Partially** | `Button`s accept clicks and hotkeys, but a `Raster` can't be pressed. For click-anywhere-on-the-sprite, use a `Client` with `onPointer` (T:900, T:1277) |
| Show a subagent's live activity | **Feasible** | `tool.call`, `turn.step`, `turn.complete` and `session.append` all carry `agentId`. `$.session.messages({ agentId })` reads an agent's transcript (T:11961, T:12628, T:12478, SKREF, T:10449) |
| Redirect (send new instructions) | **Feasible** | `$.session.send({ to: { agentId }, text })` does the same delivery as SendMessage ([api](https://code.claude.com/docs/en/plugins/mods/api#send-and-receive-messages-between-sessions)). `$.session.append({ agentId, ... })` adds a user-role row to a running subagent (SKREF) |
| Stop a subagent | **Partially / unverified** | There is no `$.agent.stop`. Candidates: `$.tool.call({ tool: 'TaskStop', task_id })` (inferred), or denying that agent's tool calls (inferred). `$.turn.abort` only cancels the main turn (T:2716, T:12478) |
| Change model before it starts | **Feasible** | An `agent.spawn` hook rewrites `model` (T:239) |
| Change model of a running subagent | **Partially** | A `turn.step` hook can rewrite `model` per request, and the input carries `agentId` (T:12628). Side effects aren't documented: `/tasks` display, prompt cache, thinking blocks |
| Swap subagent into the main panel | **Not possible from a mod** | Which transcript is in view is "the person's to switch, the plugin's to read" (T:11178). The host already has this feature: the agent panel below the prompt (↑/↓, Enter) and `/tasks` ([sub-agents](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks)) |
| Hide or replace the host's own agent panel | **Unknown** | The panel isn't listed as a render site ([reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference#render-sites)), so a mod probably can't restyle it (inferred) |

---

## 2. Mods primer

### What a mod is

- A mod is a plugin made of JavaScript or TypeScript event handlers. Claude Code calls a handler when an event happens, and the handler can watch, change or take over that event ([overview](https://code.claude.com/docs/en/plugins/mods/overview)). The docs call these handlers "hooks". The older shell-command kind is a "settings hook".
- The handlers run **inside** Claude Code, so a mod can draw an interactive UI and redraw Claude Code's own interface. Settings hooks, skills and MCP servers can't do either ([overview](https://code.claude.com/docs/en/plugins/mods/overview#what-a-mod-can-do)).
- **Runtime:** each hooks module runs in its own environment, with no DOM and no Node. It has no `require`, no `import()`, no `setTimeout`, and no fs or network of its own. Everything external goes through `$` (T:13-26, [api](https://code.claude.com/docs/en/plugins/mods/api#reach-files-processes-and-the-network)). Standard web APIs (`URL`, `TextEncoder`, `AbortController`, `crypto.subtle`) are available (same source). Files may be `.js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx`, and all are treated as ES modules ([reference#files](https://code.claude.com/docs/en/plugins/mods/reference#files)). JSX compiles against a global `h` (SKILL).
- All installed mods **share one worker thread**. A hook that blocks the thread gets its mod unloaded, and three untraceable crashes unload every user mod ([troubleshoot](https://code.claude.com/docs/en/plugins/mods/troubleshoot)).
- Mods need Claude Code v2.1.287+ and are on by default ([overview](https://code.claude.com/docs/en/plugins/mods/overview#turn-mods-on-or-off)).

### Packaging

```text
squishys/
├── .claude-plugin/plugin.json      # manifest; add "types": "./types/index.d.ts" if using $.state
├── hooks/hooks.json                # { "modules": ["./register.tsx"] }
├── hooks/register.tsx              # export const register: Register = (on, options) => { ... }
└── types/index.d.ts                # PluginState contract for $.state values
```

Sources: [reference#files](https://code.claude.com/docs/en/plugins/mods/reference#files), SKILL. A mod installs like any plugin, from a marketplace (`/plugin install name@marketplace`), or loads from disk for one session with `claude --plugin-dir <dir>`, which hot-reloads the module on save ([overview](https://code.claude.com/docs/en/plugins/mods/overview#install-or-update-a-mod), [reference#commands](https://code.claude.com/docs/en/plugins/mods/reference#commands)). `claude plugin validate <dir>` lists the hooks and calls a mod makes, and `claude plugin test <dir>` runs `*.test.ts` files with no session ([reference#commands](https://code.claude.com/docs/en/plugins/mods/reference#commands)).

### Where mods run

| Where | Hooks run | Drawing shows |
| :- | :- | :- |
| `claude` in a terminal (incl. editor terminals, JetBrains) | Yes | Yes |
| Desktop app, Code tab (not WSL) | Yes | Yes, except terminal-only elements |
| VS Code extension chat panel | Yes | **No** |
| `claude -p` / Agent SDK | Yes | **No** |
| Remote Control | Yes, on your machine | In your local terminal |
| Cloud session | Yes, if the plugin reaches it | **No** |

Source: [overview#where-mods-run](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run). `e.surface` is `terminal`, `desktop`, `vscode` or `mobile`, so a mod can branch per surface (SKREF).

### The hook model

Every hook has the signature `($, e, next)`. `$` is the mods API, `e` is the frozen event input, and `next(e)` continues the middleware chain to other mods and then Claude Code's own behavior. A hook observes by returning `next(e)`, rewrites with `next({ ...e, x })`, or answers by returning without calling `next` ([events](https://code.claude.com/docs/en/plugins/mods/events#how-a-hook-handles-an-event)). This example comes straight from the docs:

```javascript
let calls = 0
export function register(on) {
  on('tool.call', async ($, e, next) => {
    calls += 1
    $.ui.invalidate('ui.render')
    return next(e)
  })
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    return next({ ...e, props: { ...e.props, suffix: ' · tool calls: ' + calls + '…' } })
  })
}
```

([overview#how-a-mod-works](https://code.claude.com/docs/en/plugins/mods/overview#how-a-mod-works))

### API surface relevant to squishys

From [reference#mods-api-methods](https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods):

- `$.ui`: `resolve, invalidate, open, close, panes, focus, scroll, toast, status, log, notice, ask, copy, blit`
- `$.agent`: `register, spawn, list`
- `$.session`: `messages, send, append, model, id, usage, ...`
- `$.turn`: `abort`
- `$.tool`: `register, call, check, list`
- `$.command`: `register, run, list`
- `$.state` (reactive, lasts the session), `$.store` (persists across sessions, 4 MiB total), `$.clock` (`now, sleep, after, every`), `$.fs`, `$.process`, `$.http`, `$.model`, `$.audio`

Events relevant to squishys ([reference#events](https://code.claude.com/docs/en/plugins/mods/reference#events)):

- `agent.spawn` (a subagent is about to start; a hook can return `{ model }` or `{ deny }`), `agent.offer`
- `tool.call` (includes calls a subagent makes, [events](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call))
- `turn.start` / `turn.step` / `turn.complete`
- `session.append`, `session.send` / `session.receive`
- `ui.render`, `ui.press` / `ui.input` / `ui.select` / `ui.focus` / `ui.close` / `ui.message`
- `classic.SubagentStart` / `classic.SubagentStop`. Every settings-hook event is also available as `classic.<Event>`.

### UI surfaces

| Surface | How | Size / placement | Pixel art? | Animation |
| :- | :- | :- | :- | :- |
| **Pane** | `$.ui.open({ id, title, focus?, closeOnEscape?, rows?, columns? })` + `ui.render` on `{ component: 'Pane' }` | Docked beside the transcript in fullscreen from 110 cols, otherwise inline above the prompt (default a third of the space). Width is `e.props.bodyColumns`. Docked height is `e.props.scroll.bodyRows`. A pane opened unasked needs 144 cols (110 once the user has opened it). One pane shows at a time, the others become tabs ([interface](https://code.claude.com/docs/en/plugins/mods/interface#open-a-pane-at-the-right-time), [reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference#render-sites), [reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits), T:9632) | Yes: `Raster`/`Image` (terminal), `Svg` (desktop), `Client` (both) | Yes |
| **Band** (`AbovePrompt`) | `ui.render` on `{ component: 'AbovePrompt' }`; return a tree or `next(e)` | Always present and shared by all mods. Height capped at `maxRows`; in fullscreen the bottom slot is capped at half the terminal rows (T:9578) | Same elements as a pane (inferred: the reference lists elements per app, not per site) | Yes |
| **Status line** | `$.ui.status(text)` | One text line under the prompt, prefixed with `⚠` and the mod's name ([api](https://code.claude.com/docs/en/plugins/mods/api#show-something-without-starting-a-turn)) | No (text only) | Re-set from a timer |
| **Toast** | `$.ui.toast(text)` | Top right, 4 s default (`timeoutMs`) ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)) | No (text only) | No |
| **Log line** | `$.ui.log(text)` | Dim transcript line, which Claude doesn't read | No | No |
| **Existing sites** | `ui.render` on `Spinner`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`, `AskUserQuestion`, `PromptHint`, `SessionMode`, plus `ToolProgress`, `TurnDuration`, `InfoNotice` (terminal only) | Restyle via props, replace the drawing, or wrap the engine's drawing ([interface](https://code.claude.com/docs/en/plugins/mods/interface#change-what-claude-code-already-draws)). The permission prompt is **not** a site | Possible: return any tree (inferred) | Yes |

**Elements:** `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg` (desktop only), `Client`, `Raster` (terminal only), `Image` (terminal only) ([reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements)).

**Redraw limits:** `$.ui.invalidate('ui.render')` is throttled to 10 redraws a second, or 30 in the terminal for the visible pane, the expanded band and the hint line, and faster calls are coalesced ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)). `$.ui.blit` takes up to 120 a second and shows about 60 (T:2179). A redraw happens only when props change, the width changes, or the mod asks; there is no timer redraw unless the mod sets one up ([interface](https://code.claude.com/docs/en/plugins/mods/interface#redraw-when-something-changes)).

### Input

- **The mod never reads the keyboard directly.** Keys reach a mod's controls only while its pane or band has focus. A pane gets focus from `focus: true` on a user-initiated open, from Ctrl+X Tab, or from a click ([interface#keyboard-focus](https://code.claude.com/docs/en/plugins/mods/interface#know-which-keys-your-mod-can-receive)).
- Tab and arrows move between controls and can't be rebound. Enter presses. A `Button` `hotkey` is one digit or one lowercase letter. Ctrl+X plus an arrow resizes the pane, and Ctrl+X X closes it (same source).
- **Mouse:** "a click, a `hotkey`, the chord for its `action`, or Enter under the focus raises `ui.press`" on a `Button` (T:892-899). Clicks are reported in the fullscreen terminal (T:5408-5410; [fullscreen](https://code.claude.com/docs/en/fullscreen#use-the-mouse) says fullscreen rendering "captures mouse events"). Classic, non-fullscreen rendering probably reports no clicks (inferred).
- **Hover:** a keyed `Box` can carry `hover` style overrides and reveal hidden cards. No hook runs on hover (T:716, T:740-770).
- **Raw pointer:** a `Client` element runs a second module of yours on the drawing thread. That module gets `onPointer` events (`down/move/up/enter/leave`, cell x/y, sub-cell `fine` where the terminal reports pixels), `onKey`, `every(ms)` frame timers, local `setState`, and `post()` back to the hooks module as a `ui.message` event. It has no `$` and can't use `Raster`/`Image` (T:1236, T:1267, T:1277-1320, T:1377-1430).

### State and hot reload

| Where | Lifetime |
| :- | :- |
| Module variable | Until reload |
| `$.state` (declared in `types/index.d.ts`; `atom`/`read`/`update`) | The session. Reset by `/clear`, `/resume` and `/branch`. Writing a value redraws its readers |
| `$.store` | Across sessions |

Source: [interface#keep-state](https://code.claude.com/docs/en/plugins/mods/interface#keep-state). A reload runs `register` again and fires `session.start` again. Timers are dropped, and `$.state`/`$.store` survive (SKILL, SKREF). Render hooks can read state but **can't write it**. Write from handlers or other events instead ([interface](https://code.claude.com/docs/en/plugins/mods/interface#define-read-and-write-a-value)).

---

## 3. Mapping each product feature to concrete APIs

### 3.1 Spawn detection and random squishy assignment

- **`agent.spawn`** fires when "a subagent is about to start" ([reference#subagents](https://code.claude.com/docs/en/plugins/mods/reference#subagents)). Its input includes `tool_use_id`, `prompt`, `description`, `subagentType`, `model` (the Agent tool's parameter; rewritable), `parentModel`, `parentAgentId`, `background`, `fork`, `name`, `cwd` (T:239-318). `next(e)` resolves to `{ model, agentId }` once the subagent has started (T:331-345). That makes it the natural place to assign a squishy and key it by `agentId`.
- `$.agent.list()` returns `AgentInfo[]`: `id`, `description`, `type` (`general-purpose`, `Explore`, ... or `teammate`), `status` (`running`, `completed`, `failed`, `killed`, ...), `parentId`, `spawnedBy`, `name` (T:125-160). It covers subagents and in-process teammates.
- Backup lifecycle signals: `classic.SubagentStart` (`agent_id`, `agent_type`) and `classic.SubagentStop` (`agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`) ([hooks#subagentstart](https://code.claude.com/docs/en/hooks#subagentstart), [hooks#subagentstop](https://code.claude.com/docs/en/hooks#subagentstop)). Classic events are hookable from a mod as `classic.<Event>` ([events](https://code.claude.com/docs/en/plugins/mods/events#hook-the-settings-hook-events)). SubagentStart also fires on resume and for each new message an in-process teammate handles, and SubagentStop also fires for internal agents (prompt suggestions, `/btw`) with an empty `agent_type`, so filter on those (same hooks pages).
- `turn.complete` with `e.agentId` marks the end of a subagent's run. `e.reason` is `answer | aborted | refusal | error` (T:12478-12528).
- **Random-pick precedent:** the spinner shows "a rotating verb such as 'Accomplishing', 'Architecting', or 'Baking'". Users can append to that list or replace it with the `spinnerVerbs` setting (`{ mode: 'append' | 'replace', verbs: [...] }`) ([settings-reference#spinnerverbs](https://code.claude.com/docs/en/settings-reference#spinnerverbs)). The `Spinner` site's `word` is described as "as sampled for this turn" (T:9436-9445). The docs don't describe the sampling algorithm. For squishys, plain `Math.random()` in the module is enough (standard JS; inferred to be available, since the module is a JS environment with web APIs).

### 3.2 Sprites (pixel art)

- **`Raster` (terminal only)** takes `key`, `columns` (1-512), `rows` (1-256), and `cells`: base64 of little-endian u32 triplets `[codePoint, fg, bg]`. "A code point is one printable width-1 BMP character (blocks, box drawing, braille too)". A color is `0x00RRGGBB`, or `0x01000000` for the terminal default (T:8617-8643). So `▀` (U+2580) with fg = top pixel and bg = bottom pixel gives **2 pixels per cell**, the usual half-block technique, and it's explicitly allowed. The docs also say: "Draw one `Raster` and not a `Box` for each cell" ([interface](https://code.claude.com/docs/en/plugins/mods/interface#draw-a-grid-of-colored-cells)).
- **Palette caveat:** "A `Raster` rounds each color to a smaller palette, so `0x2e7d32` draws as `#337733`" ([gallery](https://code.claude.com/docs/en/plugins/mods/gallery)). That example looks like 4-bit-per-channel quantization (inferred). This suits a low-color Gen 1/2 look. Pick palette colors that survive the rounding.
- Packing helper, from the docs:

  ```javascript
  const DEFAULT_COLOR = 0x01000000
  function cellsOf(rows) {
    const numbers = rows.flat().flatMap(([char, color]) => [char.codePointAt(0), color, DEFAULT_COLOR])
    return new Uint8Array(Uint32Array.from(numbers).buffer).toBase64()
  }
  // Raster({ key: 'grid', columns: 3, rows: 2, cells: cellsOf(rows) })
  ```

  ([interface](https://code.claude.com/docs/en/plugins/mods/interface#draw-a-grid-of-colored-cells)). For half-blocks, emit `[0x2580, topRGB, bottomRGB]` per cell instead of the default background.
- **`Image` (terminal only):** PNG or RGBA bytes up to 2 MiB, or a file or shared-memory source, drawn with the **kitty graphics protocol** where the terminal supports it (kitty, Ghostty). Elsewhere it shows its `alt` text. Swap frames with `$.ui.blit({ requestId, key, source })` (SKREF, T:5003, [reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements)). **Sixel isn't mentioned anywhere** in the docs or types I read. iTerm2's image protocol isn't mentioned either. Treat `Image` as a kitty/Ghostty bonus, and use `Raster` as the baseline.
- **Desktop Code tab:** no `Raster` or `Image`. `Svg` (desktop only, up to 131,072 chars) can draw crisp pixel rects ([reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements), [gallery](https://code.claude.com/docs/en/plugins/mods/gallery)). `Client` works in both apps. Inside a `Client` you could draw half-blocks as `Text` with `color`/`backgroundColor` (inferred). `TextProps` takes `color` and `backgroundColor` strings (T:11869). The docs only say "a theme key or a color such as `'red'`" ([interface](https://code.claude.com/docs/en/plugins/mods/interface#build-a-tree-from-elements)). The types call the props "an allowlisted subset of Ink's Box/Text props" (T:8718), so hex strings probably work (inferred, verify).
- **Sizing (inferred):** a 16×16-pixel icon in half-blocks is 16 columns × 8 rows. An 8×8 "mini" icon is 8 × 4. A docked pane's width depends on the terminal (`bodyColumns`), and the mod can ask for a width with `columns` on `$.ui.open` ([interface](https://code.claude.com/docs/en/plugins/mods/interface#open-a-pane-at-the-right-time)). Background, not from Claude Code docs: Gen 1/2 party-menu icons are 16×16 with 2 frames.
- **Where the art lives:** ship sprite data as code (palette-indexed arrays in a `.ts` file the module `import`s). Plugin files can be imported with an `import` declaration (SKREF). Alternatively read PNGs with `$.fs.read(path, { as: 'bytes' })` for `Image` (SKREF).

### 3.3 Wiggle animation

- **Raster path:** draw the roster once, then call `$.ui.blit({ requestId: PANE, key, columns, rows, cells })` from a `$.clock.every(250, ...)` timer to swap between frame A and frame B. `blit` "repaints that one element without running your `ui.render` hook again" ([interface](https://code.claude.com/docs/en/plugins/mods/interface#draw-a-grid-of-colored-cells), T:2179-2198). A 2-4 fps wiggle is far below every limit.
- **Client path:** call `surface.every(ms, fn)` on the drawing thread's frame clock and `setState` to flip frames locally, with no round trip to the hooks module (T:1406-1412). Beware: three `setState` calls in a row with no input or tick in between count as a render loop, and the instance unmounts (T:1390-1394).
- **Invalidate path:** `$.ui.invalidate('ui.render')` on a timer (10-30/s cap) also works, but it re-runs the whole tree ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)).
- `prefersReducedMotion` exists as a user setting for Claude Code's own animations ([settings-reference](https://code.claude.com/docs/en/settings-reference)). Whether a mod can read it isn't documented. `$.settings.read` might expose it (inferred).

### 3.4 Side panel and slots

- Open with `$.ui.open({ id: 'squishys', title: 'Squishys', columns: 36 })` from a `/squishys` command or a Button, so it places at any width. Opened unasked from `session.start` or a timer, it needs 144 columns, or 110 once the user has opened it before. Check `isPlaced` in the result ([interface](https://code.claude.com/docs/en/plugins/mods/interface#when-a-pane-waits-for-a-wider-terminal), EX/pane.tsx).
- `e.props.placement` is `dock` (beside the transcript; fullscreen, ≥110 cols) or `inline` (above the prompt). It's read-only (T:9651-9657). The mod **can't force dock**. It should lay out for both modes, for example 2-across in a dock and 1 row of minis inline (inferred design).
- The engine shows one pane per screen and turns the others into tabs (T:9622-9625). So "several panes" means tabs, not tiles. Keep the whole roster plus the detail view in **one** pane.
- Slots are pure mod logic: keep `slots: agentId[]` (max N) in `$.state`, plus an overflow count ("+3 more"), and fill free slots from running agents.

### 3.5 Clicking a squishy

- **Simplest:** under each sprite, a `Button` with `plain`, a `hotkey` of `1`-`9`, and the squishy's name as its label. Clicking it or pressing the digit selects that agent. Buttons accept clicks (T:892-899). Hotkeys work only while the pane has focus ([interface](https://code.claude.com/docs/en/plugins/mods/interface#know-which-keys-your-mod-can-receive)).
- **Click on the sprite itself:** `Raster` has no press handler (T:8617; not documented as pressable). Use a `Client` per slot or for the whole roster, map `onPointer({ type: 'down', x, y })` to a slot, and `post({ select: agentId })`. The hooks module receives that as `ui.message` (T:1277-1320, T:1413-1430, [reference#interface](https://code.claude.com/docs/en/plugins/mods/reference#interface)). Trade-off: no `Raster` inside a `Client`, so sprites become colored `Text` half-blocks (inferred to render the same way).
- **Hover highlight:** wrap each slot in a keyed `Box` with `hover: { borderStyle/backgroundColor }`. No hook runs on hover (T:716-770).

### 3.6 Live activity of a subagent

Several documented feeds carry the agent id:

- `tool.call`: `e.agentId` is set inside a subagent. The tool name and arguments are on `e`, and `await next(e)` gives the result (T:11951-11961; [events](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call)). Best for a "Mochi is running `grep …`" ticker.
- `turn.step`: an async generator that sees each model request and its streamed chunks (text, thinking, tool input), with `e.agentId` for subagents (T:12601, T:12628-12670; [events#follow-a-turn](https://code.claude.com/docs/en/plugins/mods/events#follow-a-turn)). Useful for a "typing" wiggle while a subagent streams.
- `session.append` fires for every stored row "in the main conversation and in every subagent's alike (the event's `agentId` names the subagent's loop)" (SKREF).
- Pull on demand with `$.session.messages({ agentId })`, which returns `{ role, text, toolUses, toolResults }` rows, or `{ deny }` when the agent runs in another process, e.g. a split-pane teammate (T:10449-10600). Capped at the newest 4,096 entries ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)).
- `turn.complete` (`agentId`, `answer`, `durationMs`, `usage`) gives the end-of-run summary (T:12478-12512).
- Render the selected agent's feed with `Markdown` (≤10,000 chars) and `Text` rows inside the pane ([reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements)).
- **Not covered:** agents run by dynamic workflows "carry ids no list names" (T:174-178), and `$.session.messages` can't read them (T:10527). Workflow subagents may get squishys from `tool.call` ids, but `agent.list` won't describe them (inferred).

### 3.7 Redirect (send new instructions)

- `$.session.send({ to: { agentId }, text })` is "the same delivery the SendMessage tool makes". It resolves `{ isDelivered: true }` once queued, or `{ isDelivered: false, reason }` ([api](https://code.claude.com/docs/en/plugins/mods/api#send-and-receive-messages-between-sessions)). The types' own example is `await $.session.send({ to: { agentId }, text: "stop after this file" })` (T:2672-2685). "Delivered means queued at the recipient ... never read" (T:10925). A finished subagent is resumed from its transcript with the message (T:10833-10838).
- `$.session.append({ message: { type: 'user', content }, agentId })` adds a user-role row the model reads into **a running subagent's** conversation. It shows up "in a running turn's requests from the loop's next top" (SKREF; T:2687-2697). This is the more immediate injection.
- Subagents treat messages from their launcher as "normal task direction, including mid-task course corrections". No agent message can approve a permission prompt or change a subagent's settings ([sub-agents#resume-subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents)). A mod-sent message arrives framed as a peer's, with `origin.plugin` naming the mod (T:2676-2678). Whether the subagent weighs it as launcher direction isn't documented.
- UI: an `Input` with `onSubmit(text)` in the detail view ([interface](https://code.claude.com/docs/en/plugins/mods/interface#take-typed-input-and-draw-a-row-for-each-item)).

### 3.8 Stop a subagent

There is **no documented mod method to stop a specific subagent**. The options:

1. **`$.tool.call({ tool: 'TaskStop', task_id: agentId })` (inferred, most promising).** `$.tool.call` runs any tool "the same call the engine makes for the model's tool calls", through hooks and the permission check (T:2808-2819). The types even show `$.tool.call({ tool: "Agent", ... })` (T:103). `TaskStop`'s input says "Agent-team teammates and named background agents are also accepted by agent ID or name" (T:15628-15633). The docs mention "a subagent that Claude stopped with the `TaskStop` tool" ([sub-agents#resume-subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents)). Whether an unnamed background subagent's `agentId` is a valid `task_id` isn't stated, so test it.
2. **Starve it (inferred).** Answer every `tool.call` with `e.agentId === target` with `{ deny: 'Stopped by user' }`, and answer its next `turn.step` without calling the model. A hook "can answer without calling the model" ([events#follow-a-turn](https://code.claude.com/docs/en/plugins/mods/events#follow-a-turn)). The subagent would end its run, but its status would probably read `completed`, not `killed` (inferred).
3. **`$.turn.abort({ turnId })`** cancels "the running model turn: the one whose id `turn.start` handed this plugin" (T:2716-2727), and "a subagent's run raises no `turn.start`" (T:12494-12495). So this targets the main turn, not one subagent (inferred).
4. **Host UI fallback:** the user presses `x` on a row in the agent panel or in `/tasks` ([sub-agents#observe-and-steer-running-forks](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks), [agents#check-on-running-work](https://code.claude.com/docs/en/agents#check-on-running-work)). `chat:killAgents` (Ctrl+X Ctrl+K) stops **all** background subagents ([keybindings](https://code.claude.com/docs/en/keybindings)). A mod can't fire a keybinding action: `Button.action` works the other way round, letting the user's chord press the mod's button (T:917-925).

### 3.9 Change a subagent's model

- **At spawn (documented):** in an `agent.spawn` hook, `return next({ ...e, model: 'haiku' })`. "A hook sets this to pick the subagent's model". Forks ignore it and always inherit (T:264-273). Org `availableModels` allowlists still substitute blocked values ([sub-agents#choose-a-model](https://code.claude.com/docs/en/sub-agents#choose-a-model)). Valid Agent-tool aliases in this build are `"sonnet" | "opus" | "haiku" | "fable"` (T:14979-14990).
- **Mid-run (documented mechanism, effects unknown):** `turn.step` input has `model` ("`next({ ...e, model })` names another") and `agentId` (T:12628-12665). So the mod keeps `desiredModel[agentId]` and rewrites each of that agent's requests. Not documented: whether `/tasks` (which "names the model on the subagent's row", [sub-agents#choose-a-model](https://code.claude.com/docs/en/sub-agents#choose-a-model)) reflects the override, whether switching families mid-conversation breaks thinking-block replay, and what happens to the prompt cache (inferred: a model switch likely misses the cache).
- **Restart variant (inferred):** stop the agent (§3.8) and resume it with a new model. Resumes keep the per-invocation model ([sub-agents#choose-a-model](https://code.claude.com/docs/en/sub-agents#choose-a-model)), and the docs don't say a mod can pass a model on resume.
- UI: a `Select` with options `haiku/sonnet/opus/fable` and `onSelect` ([reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements)).

### 3.10 "Bring the subagent into the main panel and swap with the orchestrator"

- **The host already does this.** Running subagents and forks appear "in a panel below the prompt input, with one row for the main session and one for each fork". `↑/↓` selects a row, `Enter` opens that agent's transcript and lets you send follow-ups, `x` stops it, and `Esc` goes back ([sub-agents#observe-and-steer-running-forks](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks)). While an agent's transcript is open, plain text goes to that agent, and `/model` is blocked there (same source). In-process teammates work the same way ([agent-teams#talk-to-teammates-directly](https://code.claude.com/docs/en/agent-teams#talk-to-teammates-directly)). `/tasks` also opens a subagent's transcript ([sub-agents#run-subagents-in-foreground-or-background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)).
- **A mod can read the switch but not make it:** `Pane` and `AbovePrompt` props carry `view: { agentId? }`, "Which transcript the person has on screen ... The person's to switch, the plugin's to read: a switch re-runs the site's hooks with the new view". A rewrite of `view` is refused (T:9612-9620, T:9663-9671, T:11171-11185).
- `$.command.run` runs a slash command "as if the person typed" it, but it is "queued and run once the session is idle" (T:2862-2866). The orchestrator is usually busy while subagents run, so this can't drive `/tasks` live (inferred). Even if it could, opening a transcript from `/tasks` takes a keypress inside that dialog.
- So the swap has to be **simulated inside the pane** (render the selected agent's live feed plus a redirect input), or the mod **follows the host** (highlight the squishy whose `agentId` matches `e.props.view.agentId`, and tell the user "↓ Enter to open in main view").

---

## 4. Gaps and workarounds

| Gap | Workaround |
| :- | :- |
| A mod can't switch the main transcript view (T:11178) | Show a mirrored "focus view" of the selected agent in the pane, and sync highlights to `view.agentId` so the host panel and squishys agree. Document the ↓/Enter gesture |
| No `$.agent.stop` | Try `$.tool.call({ tool: 'TaskStop', task_id })` first, then fall back to deny-all tool calls for that `agentId` plus short-circuiting its `turn.step` (§3.8). Verify both in a spike |
| Mid-run model change effects undocumented | Ship spawn-time model choice first (documented). Gate mid-run switching behind an "experimental" toggle and label the `/tasks` model possibly stale |
| Desktop has no `Raster`/`Image` | Render per surface: `Raster` in the terminal, `Svg` rects on desktop (`e.surface` check, as in the docs' heat-map example, [interface](https://code.claude.com/docs/en/plugins/mods/interface#draw-a-grid-of-colored-cells)) |
| VS Code panel, `-p`, cloud: nothing draws ([overview#where-mods-run](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run)) | Degrade to `$.ui.log`/toasts, or do nothing |
| Pane docks only in fullscreen ≥110 cols, and an unasked open needs 144 (T:9651-9657, [reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)) | Open from `/squishys` (user-initiated). Design a compact inline layout (one row of 8×4 minis). Also offer a band (`AbovePrompt`) mini-roster |
| Only one pane visible, others become tabs (T:9622) | One pane holds the roster and the detail view |
| `Raster` isn't clickable | Labels as `Button`s with digit hotkeys, or a `Client` with `onPointer` |
| Mouse works only in fullscreen rendering (T:5408; [fullscreen](https://code.claude.com/docs/en/fullscreen#use-the-mouse)) | Hotkeys `1`-`9` and Tab/Enter as the primary path, with clicks as a bonus |
| Color quantization in `Raster` ([gallery](https://code.claude.com/docs/en/plugins/mods/gallery)) | Author sprites in a palette that survives the rounding (e.g. channel values that are multiples of 0x11, inferred from the `#337733` example) |
| Host agent panel can't be hidden or restyled (not a render site) | Live with the duplication, or treat squishys as the fun layer on top |
| Workflow agents aren't in `$.agent.list()` (T:174-178) | Fall back to ids seen in `tool.call`/`turn.step` with a generic squishy, or skip them |
| `$.state` resets on `/clear`, `/resume`, `/branch` ([interface](https://code.claude.com/docs/en/plugins/mods/interface#load-a-saved-value-again-after-clear)) | Rebuild the roster from `$.agent.list()` in `classic.SessionStart` with `source: clear/resume/fork` |
| 10 s hook budget, shared worker thread ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits), [troubleshoot](https://code.claude.com/docs/en/plugins/mods/troubleshoot)) | No heavy work in hooks. Pre-pack sprite frames to base64 once at `session.start` and reuse them |

**Limits worth remembering** ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)):

- A hook's own execution time is capped at 10 s, a `.catch` handler at 1 s, and all `session.end` hooks together at 1.5 s.
- `Text` string children are capped at 10,000 chars.
- `$.store` holds 4 MiB in total.
- Redraws are capped at 10/s (30/s for the visible pane in the terminal).
- Pane and command names are `[A-Za-z0-9_-]`, up to 64 chars.

**Client trees** have their own bounds: 20,000 nodes, 32 deep, 100,000 chars serialized (T:1229-1236). The engine also refuses 20+ concurrent subagents by default, which sets the maximum roster size (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) ([sub-agents#concurrent-subagent-limit](https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit)).

**Permissions and sandboxing:** mods aren't sandboxed. They run with your user permissions, can see every prompt and tool call, can approve tool calls, and can spend your usage. If sandboxing is on, it covers only Claude's Bash commands, not processes a mod starts ([overview#what-a-mod-can-reach](https://code.claude.com/docs/en/plugins/mods/overview#what-a-mod-can-reach)). `$.tool.call` goes through the normal permission check and its dialog (T:2811-2813), so a `TaskStop` call might prompt the user (inferred). Orgs can block user mods (`allowManagedModsOnly`, `disableAllHooks`) ([reference#settings](https://code.claude.com/docs/en/plugins/mods/reference#settings-and-environment-variables)).

---

## 5. Suggested architecture and MVP

### Architecture sketch (inferred design)

```text
hooks/register.tsx
├── catalog.ts            sprite data: { id, name, palette[], frameA[], frameB[] } × N variants
├── state (types/index.d.ts → PluginState['squishys'])
│     agents:   Record<agentId, { squishy, label, type, model, desiredModel?, status, feed: Row[] }>
│     slots:    agentId[]            (≤ MAX_SLOTS)
│     selected: agentId | null
├── lifecycle
│     agent.spawn      → assign random squishy (avoid live duplicates), record model, apply desiredModel default
│     tool.call        → if e.agentId: push feed row; await next(e); mark done
│     turn.step        → if desiredModel[e.agentId]: next({ ...e, model }); stream → "typing" flag
│     turn.complete    → if e.agentId: status done, last answer
│     classic.SubagentStop / $.clock.every(1000) + $.agent.list() → reconcile killed/failed
│     classic.SessionStart{clear,resume,fork} → rebuild from $.agent.list()
├── commands
│     /squishys        → $.ui.open({ id: 'squishys', title: 'Squishys', columns: 36 })
├── render
│     ui.render{Pane, requestId:'squishys'}
│       terminal: one Raster per slot (half-blocks) + Button(name, hotkey 1-9) + status dot
│       desktop:  Svg per slot
│       detail:   Markdown feed of selected + [s] Stop · Input "Redirect…" · Select model
│       highlight slot where e.props.view.agentId === slot (host's main-view agent)
├── animation
│     $.clock.every(300) → $.ui.blit each visible slot's Raster with the other frame
└── controls
      stop     → $.tool.call({ tool: 'TaskStop', task_id }) ▸ fallback: deny-all for agentId
      redirect → $.session.append({ agentId, message }) or $.session.send({ to: { agentId }, text })
      model    → desiredModel[agentId] = m (applies from the next turn.step)
```

Spawn-hook sketch. Untested; written against the types (T:239-345, T:2959-3003):

```tsx
on('agent.spawn', async ($, e, next) => {
  const pick = CATALOG[Math.floor(Math.random() * CATALOG.length)]
  const started = await next(e)              // { model, agentId } or { deny }
  if (started.agentId) {
    await update($, agents, a => ({ ...a, [started.agentId!]: {
      squishy: pick.id, label: e.description, type: e.subagentType,
      model: started.model, status: 'running', feed: [] } }))
  }
  return started
})
```

### MVP slice

The goal is to prove the riskiest pieces in one sitting:

1. `/squishys` opens a docked pane, terminal only.
2. `agent.spawn` assigns one of **4 hard-coded 16×16 variants** at random. The roster shows up to **4 slots** as `Raster` half-block sprites, each with a `Button` label (hotkeys 1-4).
3. The 2-frame wiggle runs via `$.clock.every` + `$.ui.blit` while the agent is `running`, and the sprite freezes or dims when done.
4. Selecting a slot shows the last 10 `tool.call` rows for that `agentId`.
5. A **Stop** button calls `$.tool.call({ tool: 'TaskStop', task_id })`. This is the spike that decides §3.8.
6. Write `claude plugin test` cases for spawn → slot assignment and for Stop wiring ([test](https://code.claude.com/docs/en/plugins/mods/test)).

Next slices:

- Redirect `Input` via `$.session.append`/`send`.
- Spawn-time model `Select`, applied to the next spawns or as a per-agent default.
- Experimental mid-run model switch via `turn.step`.
- Overflow "+N" and slot rotation.
- `view.agentId` highlight sync.
- Desktop `Svg` renderer.
- `Client`-based click-on-sprite.
- Kitty `Image` path for high-fidelity sprites.

---

## 6. Open questions (verify in a spike)

1. Does `TaskStop` with a plain background subagent's `agentId` (from `$.agent.list()`) stop it? Does `$.tool.call` trigger a permission prompt for it?
2. Mid-run `turn.step` model rewrite: does it work across families (opus → haiku) with thinking on? Does `/tasks` show the new model? What does it cost in cache misses?
3. When does a **running** subagent read a `$.session.send` message: at its next request, or only after its run ends? `$.session.append` claims "from the loop's next top" (SKREF), and `send` only promises "queued".
4. Is the `Spinner` site raised per agent? Its `requestId` is "the agent id" ([reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference#render-sites)). Could a sprite be drawn into each subagent's spinner, or into the spinner while an agent's transcript is in view?
5. Do `Text` `color`/`backgroundColor` accept `#rrggbb` (needed for `Client`/desktop half-block sprites)? The docs only show named colors.
6. What is the exact `Raster` palette? It looks like 12-bit from the `#337733` example, which is inferred.
7. Does a click on a `Raster` inside a keyed `Box` do anything (focus, select)? The docs don't say.
8. Desktop Code tab: does `Pane` there carry `view.agentId`, and does the Desktop app have an equivalent of the agent panel?
9. Can the mod read `prefersReducedMotion` (via `$.settings.read`) to pause the wiggle?
10. Agent teams in split-pane mode: teammates run in other processes, and `$.session.messages` returns `{ deny }` for them (T:10550-10556). Do `agent.spawn` and `tool.call` still fire for them in the lead's mod?
