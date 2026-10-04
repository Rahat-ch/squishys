## Commands

- **Typecheck:** `npm run typecheck` (run `npm install` once first). It checks against the engine types Claude Code writes into `.claude-plugin/types/` whenever it loads the mod, so load the mod once (below) on a fresh clone or after a Claude Code update.
- **Single test file:** `claude plugin test` has no file filter; it always runs every `*.test.ts` under the folder. The whole suite takes under a second, so run it.
- **Full suite:** `npm test` (same as `claude plugin test .`).
- **Load in a session:** `claude --plugin-dir .` (hot-reloads on save). Then `/squishys` toggles the pane.
- **Validate before a PR:** `claude plugin validate .` (the marketplace) and `claude plugin validate .claude-plugin/plugin.json` (the manifest, hooks and `$.state` contract).

## Mod conventions

- `hooks/register.tsx` only wires features. Each feature is a module in `src/` exporting `register<Feature>(on)`. Pure modules (the roller, sprite composer) take plain data, never `$`, and their tests call them directly with seeded randomness. Everything else is tested through the mod test kit in `tests/`, with shared inputs in `tests/fixtures.ts`.
- One hook per event per plugin: the engine refuses a second unmatched `on('tool.call')` anywhere in the module graph. A new behaviour on an event already hooked joins that event's existing hook.
- The engine reads `$.state` references off each file statically, so every file that reads or writes a value declares its own `atom({ plugin: 'squishys', key }, initial)` const; an imported atom fails to load. Each value is declared in `types/index.d.ts`.
- Drawing hooks return `next(e)` unless `e.surface === 'terminal'`.
- The version lives only in `.claude-plugin/plugin.json`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on Rahat-ch/squishys, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
