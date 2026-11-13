# Contributing

## Build and verify

Install [Bun](https://bun.sh/) and the locked dependencies, then run the checks:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run test:package
```

`npm pack` runs `bun run build` to compile Solid JSX and bundle the local helpers into `dist/tui.js`. OpenTUI and Solid remain external so OpenCode can use its own runtime copies. Published packages do not rely on a TSX transform inside `node_modules`.

`bun run test:package` installs the tarball in a temporary directory outside the checkout. It imports the TUI entry point without a JSX preload, then runs the sidebar render-and-click tests against the installed package. This check requires npm registry access to install peer dependencies.

The test scripts enable Solid's client runtime with `--conditions=browser`. These checks validate helpers, sidebar interactions in the test renderer, packaging, and TypeScript, not integration with a running OpenCode host. They do not change global OpenCode configuration.
