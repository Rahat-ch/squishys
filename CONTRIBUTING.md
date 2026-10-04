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

Once the mod lands, you'll be able to:

- Load it into a session from your clone with `claude --plugin-dir .`, which reloads it on save.
- Run the tests with `claude plugin test`.
- Validate the plugin with `claude plugin validate .` before opening a PR.

Mods need Claude Code 2.1.287 or later. See the [mods documentation](https://code.claude.com/docs/en/plugins/mods/overview).

## Art

Squishy sprites are drawn as code and curated through a preview page. You don't need to draw pixels to contribute. If you have notes on a sprite, open an issue with its name and what you'd change.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
