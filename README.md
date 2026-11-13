# OpenCode Skills Dock

An OpenCode TUI plugin that adds skills to the session sidebar.

- Browse skills grouped by scope or author.
- Use a skill, copy a request, or view its details.
- See session usage and estimated context share.

## Install

```sh
opencode plugin add opencode-skills-dock
```

Run `/reload` in OpenCode to load the plugin. The install command adds the
package to the `plugins` array in your OpenCode CLI configuration.

## Develop locally

Install [Bun](https://bun.sh/), then run:

```sh
git clone https://github.com/oliveiram1/opencode-skills-dock.git && cd opencode-skills-dock && bun run install:local
```

The script packs the built plugin, installs that tarball with its peer dependencies under `~/.cache/opencode-skills-dock/local` (or `$XDG_CACHE_HOME/opencode-skills-dock/local` when set), and adds the installed package path to the `plugins` array in `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json` when set). This exercises the same package contents and entry point as a published install. It preserves other settings and plugin entries. Run `/reload` in OpenCode to load the plugin. After editing the source, run `bun run install:local` again to rebuild and reinstall it.

Run the checks with:

```sh
bun run test
bun run typecheck
bun run test:package
```
