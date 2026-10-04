# squishys

[![License: MIT](https://img.shields.io/github/license/Rahat-ch/squishys)](LICENSE)

A Claude Code mod that gives every agent your orchestrator starts its own tiny pixel-art squishy, so you can watch, stop and redirect your agents through them.

> **Status:** early development. To try it from a clone, see [Developing the mod](CONTRIBUTING.md#developing-the-mod).

## Docs

- [Domain glossary](CONTEXT.md)
- [Architecture decisions](docs/adr/)
- [Research: building squishys as a Claude Code mod](docs/research/claude-code-mods.md)
- [Claude Code mods documentation](https://code.claude.com/docs/en/plugins/mods/overview)

## Security

- **Share** posts nothing by itself. It saves a picture of the squishy (a PNG in a private folder of your own: `squishys-share` in your temp folder on macOS, `~/.cache/squishys/share` on Linux; pictures older than a day are cleared), copies it to the clipboard on macOS, and opens X's compose page in your browser with the text filled in. You review the text, attach the picture and post it yourself; squishys never sees your X account.
- The text for a finished agent includes the start of the agent's description, which can hold private project details. It's cut short, but read it in the compose box before you post.
- To do this, Share runs a few local commands: `sh`, `uname`, `base64`, `mktemp` and `find` to save the picture, then `osascript` and `open` on macOS, or `xdg-open` on Linux.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
