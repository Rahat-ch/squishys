## Commands

- **Typecheck:** `npm run typecheck` (run `npm install` once first). It checks against the engine types Claude Code writes into `.claude-plugin/types/` whenever it loads the mod, so load the mod once (below) on a fresh clone or after a Claude Code update.
- **Single test file:** `claude plugin test` has no file filter; it always runs every `*.test.ts` under the folder. The whole suite takes about a second, so run it.
- **Full suite:** `npm test` (same as `claude plugin test .`).
- **Load in a session:** `claude --plugin-dir .` (hot-reloads on save). Then `/squishys` toggles the pane.
- **Validate before a PR:** `claude plugin validate .` (the marketplace) and `claude plugin validate .claude-plugin/plugin.json` (the manifest, hooks and `$.state` contract).

## Mod conventions

- `hooks/register.tsx` only wires features. Each feature is a module in `src/` exporting `register<Feature>(on)`. Pure modules (the roller, composer) take plain data, never `$`, and their tests call them directly with seeded randomness. Everything else is tested through the mod test kit in `tests/`, with shared inputs in `tests/fixtures.ts`.
- One hook per event per plugin: the engine refuses a second unmatched `on('tool.call')` anywhere in the module graph. A new behaviour on an event already hooked joins that event's existing hook.
- The engine reads `$.state` references off each file statically, so every file that reads or writes a value declares its own `atom({ plugin: 'squishys', key }, initial)` const; an imported atom fails to load. Each value is declared in `types/index.d.ts`.
- `$` is followed only into functions declared in the same file as the hook, never across an import. Logic shared between feature files takes plain data (as `settingsFrom` and `withModelDefault` in `src/settings.tsx` do), and the hook makes the `$` calls itself.
- Drawing hooks return `next(e)` unless `e.surface === 'terminal'`.
- The pane shows one mode at a time: the `mode` value in `$.state` (`PaneMode` in `types/index.d.ts`). Each mode is a feature module with its own `ui.render` hook on `{ component: 'Pane', requestId: 'squishys' }` (spelled out, so the engine can read the matcher) that draws only while `mode` names it and returns `next(e)` otherwise. Several matched hooks on one event are allowed. A new mode adds its name to `PaneMode` and a module like `src/settings.tsx`.
- A `Button` `hotkey` is one digit or one lowercase letter; the engine refuses anything else, so the spec's `,` for settings is `o`, and `r` returns to the roster.
- Lasting values live in `$.store` (settings under `settings`). The test kit leaves the store unanswered, and a hook whose store call goes unanswered is skipped, so every test that spawns an agent answers it with `mock.store(on)`, or with `stubStore(on)` from `tests/fixtures.ts` to read back what was saved.
- The pure modules (`src/kit.ts`, `src/roller.ts`, `src/composer.ts`, `src/raster.ts` and the kit data) never import from `claude-code`, so tools outside the mod (the art preview) use them as they are. The mod rolls with `crypto.getRandomValues`; tests pass `seeded(n)` from `tests/seeded.ts`.
- `claude plugin validate` wants `types/index.d.ts` self-contained (no imports), so a type it shares with a pure module (`Squishy`, `Rarity`) is written out in both. Change both together: the mod hands values both ways between them, so the typecheck fails if they drift.
- The version lives only in `.claude-plugin/plugin.json`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on Rahat-ch/squishys, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
