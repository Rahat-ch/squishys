## Commands

- **Typecheck:** `npm run typecheck` (run `npm install` once first). It checks against the engine types Claude Code writes into `.claude-plugin/types/` whenever it loads the mod, so load the mod once (below) on a fresh clone or after a Claude Code update.
- **Single test file:** `claude plugin test` has no file filter; it always runs every `*.test.ts` under the folder. The whole suite takes about a second, so run it.
- **Full suite:** `npm test` (same as `claude plugin test .`).
- **Load in a session:** `claude --plugin-dir .` (hot-reloads on save). Then `/squishys` toggles the pane.
- **Art preview:** `npm run preview` writes `out/art-preview.html` (gitignored) from the current kit. Publish it as an Artifact with `capabilities: { db: {} }`; see "Art preview" below.
- **Validate before a PR:** `claude plugin validate .` (the marketplace) and `claude plugin validate .claude-plugin/plugin.json` (the manifest, hooks and `$.state` contract).

## Mod conventions

- `hooks/register.tsx` only wires features. Each feature is a module in `src/` exporting `register<Feature>(on)`. Pure modules (the roller, composer) take plain data, never `$`, and their tests call them directly with seeded randomness. Everything else is tested through the mod test kit in `tests/`, with shared inputs in `tests/fixtures.ts`.
- One hook per event per plugin: the engine refuses a second unmatched `on('tool.call')` anywhere in the module graph. A new behaviour on an event already hooked joins that event's existing hook. Where it needs `$` functions of another file, that file adds a matched hook instead, with a matcher every event fits (`src/agents.ts` hooks `session.start` with `{ isInteractive: [true, false] }`).
- The engine reads `$.state` references off each file statically, so every file that reads or writes a value declares its own `atom({ plugin: 'squishys', key }, initial)` const; an imported atom fails to load. Each value is declared in `types/index.d.ts`.
- Every `$.state.get` of one dispatch reads one moment, whatever is written meanwhile (the types say so), so a read after `await next(e)` misses what an event raised inside `next` wrote: a permission prompt during a `tool.call`, as `tests/needs-you.test.ts` shows. There, `src/agents.ts` keeps the `asking` set and calls `setState` with `current`, which writes without reading first.
- `$` is followed only into functions declared in the same file as the hook, never across an import. Logic shared between feature files takes plain data (as `settingsFrom` and `withModelDefault` in `src/settings.tsx` do), and the hook makes the `$` calls itself.
- Drawing hooks return `next(e)` unless `e.surface === 'terminal'`.
- The pane shows one mode at a time: the `mode` value in `$.state` (`PaneMode` in `types/index.d.ts`). Each mode is a feature module with its own `ui.render` hook on `{ component: 'Pane', requestId: 'squishys' }` (spelled out, so the engine can read the matcher) that draws only while `mode` names it and returns `next(e)` otherwise. Several matched hooks on one event are allowed. A new mode adds its name to `PaneMode` and a module like `src/settings.tsx`.
- Picking a squishy is one handler: the `ui.press` hook in `src/focus.tsx`, matched on `element: /^squishy-/`, answers a press on any pane Button keyed `squishy-<agent id>` by opening that agent's focus view. A new place to pick from (the overflow list) keys its Buttons so and needs no handler of its own; their `onPress` stays a no-op.
- The focus view's feed (`activity` in `$.state`, the latest `FEED_ROWS` per agent) is filled by matched hooks in `src/focus.tsx` on `{ agentId: /./ }`, which fit only agents' events; the agent tracker's unmatched hooks on those events run first. Thinking… is drawn from the agent's state, not kept in the feed.
- A `Button` `hotkey` is one digit or one lowercase letter; the engine refuses anything else, so the spec's `,` for settings is `o`, and `r` returns to the roster.
- Lasting values live in `$.store` (settings under `settings`). The test kit leaves the store unanswered, and a hook whose store call goes unanswered is skipped, so every test that spawns an agent answers it with `mock.store(on)`, or with `stubStore(on)` from `tests/fixtures.ts` to read back what was saved.
- The pure modules (`src/kit.ts`, `src/roller.ts`, `src/composer.ts`, `src/raster.ts`, `src/states.ts`, `src/seeded.ts` and the kit data) never import from `claude-code`, so tools outside the mod (the art preview) use them as they are. Those are the only modules a tool may import; a tool never imports test code. The mod rolls with `crypto.getRandomValues`; tests and the art preview pass `seeded(n)` from `src/seeded.ts`.
- `claude plugin validate` wants `types/index.d.ts` self-contained (no imports), so a type it shares with a pure module (`Squishy`, `Rarity`) is written out in both. Change both together: the mod hands values both ways between them, so the typecheck fails if they drift.
- A squishy's state lives on its agent in the `agents` value (`state`), set by the agent tracker in `src/agents.ts`. The rules about states (which have ended, which move, which state an end maps to, what an answered prompt leaves) live only in `src/states.ts`. Every mode draws a squishy's picture through `animatedPicture(agent, rasterKey, size)` from `src/pane.tsx`, which draws it at the animator's current frame and has the animator repaint it; the pane's own render hook (the outermost) starts the animator after whichever mode drew. Animation frames only ever go out as `$.ui.blit` from the animator in `src/pane.tsx`: a frame never writes `$.state` or calls `$.ui.invalidate`.
- Mod tests read a squishy's state from its picture: `watch(ui, agentId)` (or `spawnAndWatch($)`) from `tests/pictures.ts` finds the squishy a just-spawned slot shows, and its `state()` names the pose the slot shows now, at any frame.
- The test kit drops the `key` of a `Text`: find a Text by `text`, or key the `Box` around it.
- No test walks every squishy the kit can make, since the real kit makes thousands: cover every part once (`eachPart`), and keep spawns in a test to a handful.
- While a `turn.step` stream a test opened is still open, the kit waits out a timeout before each act (about 500ms for `find`, 1000ms for `clock.settle`). Read the first piece with `await stream.next()`, keep acts to a minimum until the stream is drained, and use `clock.advance`, which doesn't wait.
- Under `mock.clock` the agent list is checked every `AGENT_CHECK_MS` while any agent runs. A check that goes unanswered is skipped, so answer `agent.list` (`stubAgentList`) only where the test is about it. The kit can't reload the mod; a test stands in for a reload dropping the timers by refusing `clock.every` periods with its own hook (see the hot reload test in `tests/states.test.ts`).
- The version lives only in `.claude-plugin/plugin.json`.

## Art preview

- `tools/preview/` is development only and the mod never loads it. `items.ts` lists the items and draws them through `compose` and `roll` (tested in `tests/preview.test.ts`), `page.ts` writes the HTML, `client.js` is the page script, and `build.mjs` runs it all under Node's built-in type stripping, with a resolve hook that adds the `.ts` the mod's imports leave off. It imports only the pure modules, never `claude-code`.
- Item ids stay the same while the kit keeps its part ids: `body/<id>`, `face/<id>`, `palette/<id>` and `palette/<id>/shiny`, `accessory/<id>`, `sample/<squishy key>` (seed 1), the legendary's squishy key (`legendary/<id>`, `legendary/<id>/shiny`) and `starter/<body>/<face>`. Plain and shiny are separate items with their own verdicts.
- Verdicts live in the published page's database, collection `verdicts`, one document per item: `{ item, verdict: 'keep' | 'redo' | null, notes, art, updatedAt }`. `art` is the fingerprint (FNV-1a over the pixels, 8 hex digits) of the picture the verdict was given on. The page shows a verdict only while `art` matches the current picture; after a redraw the item reads "changed since your verdict" and counts as undecided. The document id is the item id with `/` as `:`, and any other character outside `A-Z a-z 0-9 _ - . @ +` (including `~`) as `~` and four hex digits of its code point. Read verdicts back with the `ArtifactData` tool (`list` on `verdicts`). Republish to the same artifact URL after redrawing, so the verdicts stay with the page. Deleting a document sets its item back to undecided.
- Opened without the database (as a local file), or after the store refuses a save, the page keeps verdicts in the browser with a notice, and shows them as JSON at its foot to paste back.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on Rahat-ch/squishys, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
