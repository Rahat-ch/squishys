# Contributing to squishys

Thanks for helping out. Squishys is early, so the most useful contributions right now are ideas, bug reports and feedback on the design.

## Issues

- Open a [GitHub issue](https://github.com/Rahat-ch/squishys/issues) for bugs, ideas and questions.
- New issues are labeled `needs-triage` until a maintainer looks at them. Issues labeled `ready-for-human` or `ready-for-agent` are fully specified and ready to pick up.

## Pull requests

- `main` is protected: every change lands through a pull request.
- Keep each PR focused on one change, and link the issue it addresses.
- Use the project's vocabulary from [CONTEXT.md](CONTEXT.md) (squishy, agent, roster, focus view…) in code, tests and PR descriptions.
- If your change contradicts a decision in [docs/adr/](docs/adr/), say so in the PR and explain why it's worth revisiting.

## Developing the mod

From your clone:

- Load the mod into a session with `claude --plugin-dir .`, which reloads it on save. Spawn an agent, and run `/squishys` to open or close the pane.
- Run the tests with `npm test` (or `claude plugin test`).
- Type-check with `npm run typecheck` after `npm install`. It uses the types Claude Code writes into `.claude-plugin/types/` each time it loads the mod, so load the mod once first.
- Before opening a PR, validate the marketplace with `claude plugin validate .` and the plugin itself with `claude plugin validate .claude-plugin/plugin.json`.

Mods need Claude Code 2.1.287 or later. See the [mods documentation](https://code.claude.com/docs/en/plugins/mods/overview).

## Art

Squishy sprites are drawn as code and curated through a preview page: `npm run preview` writes it to `out/art-preview.html`, and you can open that file in a browser. You don't need to draw pixels to contribute. If you have notes on a sprite, open an issue with its name and what you'd change.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
