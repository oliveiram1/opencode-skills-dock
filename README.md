# OpenCode Skills Dock

An OpenCode TUI plugin that adds skills to the session sidebar.

- Browse skills grouped by scope or author.
- Use a skill, copy a request, or view its details.
- See session usage and estimated context share.

## Install

```sh
opencode plugin add opencode-skills-dock
```

## Develop locally

Install [Bun](https://bun.sh/), then clone the repository and install dependencies:

```sh
git clone https://github.com/oliveiram1/opencode-skills-dock.git
cd opencode-skills-dock
bun install --frozen-lockfile
```

To load the local checkout, add its absolute path to the `plugins` array in `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json` if `XDG_CONFIG_HOME` is set):

```json
{
  "plugins": ["/absolute/path/to/opencode-skills-dock"]
}
```

Keep any existing plugin entries. Run `/reload` in OpenCode to load changes.

Run the checks with:

```sh
bun run test
bun run typecheck
```
