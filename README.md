# OpenCode Skills Dock

An OpenCode 2.x TUI plugin that appends a Skills section to the session sidebar. It shows session usage and an estimated context share.

## Usage

Click **None**, **Scope**, or **Author** in the **Group By:** row to switch grouping. Click a skill to open its action menu:

- **Copy to clipboard** copies a request to use the skill via OSC 52. Your terminal must support clipboard access.
- **Use now** immediately sends an `@skill-id` mention to the current session. It does not edit the prompt draft.
- **View details** opens a separate screen with its description, scope, status, and path when available. **Back** returns to the menu, and **Close** dismisses the dialog.

## Install

Install [Bun](https://bun.sh/), then clone the repository and install its dependencies:

```sh
git clone https://github.com/oliveiram1/opencode-skills-dock.git
cd opencode-skills-dock
bun install --frozen-lockfile
```

Add the absolute path to the checkout to the `plugins` array in OpenCode V2's global CLI config:

```json
{
  "plugins": ["/absolute/path/to/opencode-skills-dock"]
}
```

Replace the example path with your checkout path. Merge the entry into any existing `plugins` array instead of replacing other entries. The config is `$XDG_CONFIG_HOME/opencode/cli.json` when `XDG_CONFIG_HOME` is set, otherwise `$HOME/.config/opencode/cli.json`. Restart OpenCode after changing the config.

This is a TUI-only plugin. The host must provide `@opentui/core`, `@opentui/solid`, `solid-js`, and the TSX transform. See the [OpenCode TUI plugin guide](https://opencode.ai/docs/build/plugins/cli).

## Grouping

- **None** (default): loaded skills appear first, followed by an **Inactive** section you can collapse. Completed skill loads remain loaded until compaction clears them.
- **Scope**: Local / Global, using best-effort path classification.
- **Author**: alphabetical author groups, falling back to the original Git repository, with **Unknown source** last. The plugin reads `author` or `metadata.author` from catalogue entries, content frontmatter, or the source `SKILL.md`. Repository fallback uses ancestor `.skill-lock.json` or `skills-lock.json` installation records, then the resolved skill path's Git origin, including symlinked installations. Local source lookup is best-effort; files on a remote server may not be accessible to the TUI.

The selected grouping and inactive visibility are saved when host storage is available. Each group can be collapsed independently; switching views preserves its collapsed state for the current sidebar instance. Empty groups are hidden.

## Remove

Remove the checkout path from the `plugins` array. Removing the registration does not delete this repository.

## Runtime caveats

- Live activity relies on the host message store being reactive; the plugin does not explicitly subscribe to part events or sync session messages.
- Actual host APIs, message schemas, event shapes, and TSX loading must be verified against the target runtime; helper tests do not establish compatibility.
- Usage is derived from messages for the displayed session only, not across sessions or child sessions.
- Context percentages are rough character-based estimates, not measured token usage or an exact attribution.
- A completed compaction resets loaded skills and their estimated context contribution. Later skill loads count again; usage history is preserved. Running or failed compactions do not reset skills. Summarized skill guidance may remain in context but is not counted.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks.
