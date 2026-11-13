# Contributing

## Build and verify

Install [Bun](https://bun.sh/) and the locked dependencies, then run the checks:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
```

This TUI-only plugin has no separate build or bundle step. OpenCode loads the `tui.tsx` entry point directly; keep it with the accompanying `src/` directory. The test script enables Solid's client runtime with `--conditions=browser` for the OpenTUI render-and-click test. These checks validate helpers, sidebar interactions in the test renderer, and TypeScript, not integration with a running OpenCode host. They do not change global OpenCode configuration.
