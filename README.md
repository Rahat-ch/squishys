# squishys

[![License: MIT](https://img.shields.io/github/license/Rahat-ch/squishys)](LICENSE)

A companion mod for Claude Code's agents. Every agent Claude starts gets its own tiny pixel-art squishy, so you can watch your agents work and stop or redirect them right from their squishys.

## What you get

- **A squishy per agent:** each subagent, fork or background agent gets its own squishy with a generated Name, which stays with that agent for its whole life.
- **States and animation:** a squishy shows whether its agent is Working, Thinking, Needs you, Asleep (finished) or Squished (failed or stopped).
- **Focus view:** pick a squishy to follow its agent's live activity.
- **Stop:** stop a running agent from its focus view.
- **Redirect (`i`):** type a message to an agent. A running agent reads it at its next step, and a finished one resumes with it.
- **Next-run model and effort (`m`/`e`):** pick the model and effort an agent's next run uses.
- **The Squishydex:** a lasting collection of every squishy you've met, across sessions, with your own partner squishy for Claude.
- **Shiny and legendary moments:** rare squishys turn up with a sparkle, a toast and an optional chime.
- **Share:** turn a squishy into a picture card and post it to X yourself.

## Install

From your shell:

```sh
claude plugin marketplace add Rahat-ch/squishys
claude plugin install squishys@squishys
```

Or inside a Claude Code session:

```
/plugin marketplace add Rahat-ch/squishys
/plugin install squishys@squishys
```

### Updating

Run `claude plugin update squishys@squishys` and restart Claude Code, or turn on auto-update for the `squishys` marketplace in `/plugin`.

## Requirements

- Claude Code 2.1.287 or later (tested on 2.1.289), in a terminal.
- Fullscreen rendering is recommended (`/tui fullscreen`): it gives you clicks, hover and the pane docked beside the transcript.
- The classic renderer works too, with hotkeys and a compact pane inline above the prompt.
- Nothing draws in the VS Code panel, in `-p` (print) runs or in cloud sessions.
- The chime plays on macOS only.

## Using it

The pane opens by itself when Claude starts its first agent, if there's room for it. `/squishys` opens or closes it, and `/squishydex` opens the Squishydex. Opened that way, the pane takes the keyboard, so its hotkeys work at once. Esc hands the keyboard back to the prompt, and Ctrl+X Tab (Ctrl+X, then Tab) gives it to the pane again. Under fullscreen rendering you can also click a squishy.

When the terminal is too narrow for the pane, a **band** of mini squishys sits above the prompt instead. It has no hotkeys, so typing in the prompt never presses it; under fullscreen rendering, click a squishy there to open its focus view.

### Keys

Every control in the pane has a hotkey, shown before its label (`i: Redirect`). Hotkeys work while the pane has the keyboard.

| Where | Keys |
| --- | --- |
| First run | `1`–`3` pick your starter partner |
| Roster | `1`–`9` pick a squishy (your partner is `1`; letters after the digits), `m` the `+N` list of agents with no slot, `o` settings, `d` Squishydex |
| An agent's view | `i` type in the Redirect box (Enter sends, Esc leaves), `s` stop (press twice), `x` share, `m` model and `e` effort for its next run, `1` or `r` back to the roster |
| Settings | `m` model for new agents, `s` roster slots, `c` chime, `r` back |
| Squishydex | `1`–`9` open a squishy's card (letters after the digits), `n`/`p` next and previous page, `r` roster; on a card `m` make partner, `c` palette, `x` share, `b` back |

Controls with a few choices (model, effort, slots, palette) step to the next choice on each press. The label shows the current choice and the next one.

**Held controls:** a control that doesn't apply right now stays on screen, dimmed, with a few words of why, such as `s: Stop (finished)`. Pressing it tells you why instead of typing the key into the prompt.

### Next-run model and effort

An agent's model and effort apply from its next run, so you usually pick them while it's Asleep, and they take effect when it's resumed. A redirect to a running agent joins its current run, which keeps its current model. If you redirect an Asleep agent that has a pick, the message goes through Claude, which resumes the agent with SendMessage so the pick applies; that takes a moment, since Claude passes it on once it's free. The model control offers the models this session already runs on: Claude's own and the other agents'.

## Security

squishys runs inside your Claude Code session, with your permissions. Here is what it reads and what it can do.

**It reads:**

- Your agents' tool calls and conversation rows, to show their state and live activity.
- A few of Claude Code's settings and session details: the model allowlist (`availableModels`), reduced motion, and the models the session runs on.
- Its own saved data in Claude Code's plugin store: your settings, your partner, the Squishydex, which squishy each agent has and which agents each session started.

**It can:**

- Stop an agent, with Claude Code's TaskStop tool, when you press Stop.
- Redirect an agent with your message: into its current run (`$.session.append`), by resuming it (`$.session.send`), or by asking Claude to pass it on with SendMessage.
- Rewrite the model and effort of an agent's next run when you pick them, and the model new agents start on when you set one in Settings.
- Run local commands for Share: `sh` (with `uname`, `base64`, `mktemp` and `find`) to save the card, then `osascript` and `open` on macOS, or `xdg-open` on Linux.
- Write card PNGs to a private folder of your own (`squishys-share` in your temp folder on macOS, `~/.cache/squishys/share` on Linux). Cards older than a day are cleared.

**Nothing is posted automatically.** Share saves the card, copies it to the clipboard on macOS, and opens X's compose page in your browser with the text filled in. You attach the picture and post it yourself; squishys never sees your X account. The text for a finished agent includes the start of the agent's description, which can hold private project details, so review it in the compose box before you post.

## Development

Want to load the mod from a clone, run the tests or contribute? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
