# vvorkflow

A light IDE for directing TUI coding agents across git worktrees.\
A main agent in a terminal directs worker agents, such as Codex and Claude Code.\
The workers run as their real TUIs, in terminal tabs, in the worktrees of a repository.

## Status

The desktop app has its design tokens, its window shell, and the Welcome tab, and no features yet.\
The design follows the [core values](docs/core-values.md) and [`docs/conventions/design.md`](docs/conventions/design.md).

## Requirements

- [pnpm](https://pnpm.io/installation) 12.18.0.\
  pnpm downloads Node.js 26.13.0 for the project, from `devEngines` in `package.json`.
- [rustup](https://rustup.rs/).\
  It installs Rust 1.99.1 with rustfmt and clippy, from `rust-toolchain.toml`.
- The system dependencies of Tauri 2 for your operating system, from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).\
  On Ubuntu, these are `libwebkit2gtk-4.1-dev`, `build-essential`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, and `librsvg2-dev`.
- For the screen capture only: the Playwright browsers.\
  Install them with `pnpm --filter @vvorkflow/desktop exec playwright install --with-deps chromium webkit`.

## Start

```sh
pnpm install
pnpm dev
```

`pnpm dev` opens the desktop app in a Tauri window.\
To open only the web UI in a browser, run `pnpm --filter @vvorkflow/desktop dev:web`.

## Tasks

Run each task from the root.\
Turborepo runs it in each package.

| Command | Result |
| --- | --- |
| `pnpm dev` | Starts the desktop app with hot reload. |
| `pnpm build` | Builds the web UI into `apps/desktop/dist`. |
| `pnpm lint` | Checks the format and runs the linters: Prettier, oxlint, Steiger, rustfmt, and clippy. |
| `pnpm check-types` | Checks the TypeScript types. |
| `pnpm test` | Runs the Vitest and Cargo tests. |
| `pnpm format` | Formats the TypeScript and Rust code. |
| `pnpm --filter @vvorkflow/desktop bundle` | Builds the installable desktop app. |
| `pnpm --filter @vvorkflow/desktop storybook` | Opens the components and the screens in Storybook, at `http://localhost:6006`. |
| `pnpm --filter @vvorkflow/desktop screens` | Captures each screen in Chromium and WebKit into `apps/desktop/screens/`, and checks it against WCAG 2.2 AA. |

Each task MUST pass with no errors and no warnings before a pull request.

## Layout

```text
.
├── apps/
│   └── desktop/            The desktop app
│       ├── src/            The web UI, in Feature-Sliced Design layers
│       │   ├── app/        The entry point, the design tokens, and the global styles
│       │   ├── pages/      The workbench: the window shell and the Welcome tab
│       │   └── shared/     The UI kit (shadcn), the Tauri window API, and the shared code
│       ├── src-tauri/      The Tauri 2 shell, in Rust
│       ├── stories/        The Storybook stories of the screens and the tokens
│       ├── fixtures/       The sample data of the stories
│       ├── e2e/            The Playwright screen capture
│       └── tests/          The Vitest tests, such as the token and contrast checks
├── packages/               The shared packages (none yet)
├── docs/                   The core values and the conventions
├── Cargo.toml              The Cargo workspace
├── rust-toolchain.toml     The Rust version
├── pnpm-workspace.yaml     The pnpm workspace
└── turbo.json              The root tasks
```

## Generators

These commands made the scaffold.\
Use the same generators to add files.

| File or folder | Command |
| --- | --- |
| `package.json` | `pnpm init`, then `pnpm runtime set node 26.13.0` |
| `apps/desktop` | `pnpm create vite@9.3.4 desktop --template react-compiler-ts`, in `apps/` |
| FSD layers and slices | `pnpm dlx @feature-sliced/cli@1.0.0 <layer> <slice> -r src`, in `apps/desktop` |
| shadcn components | `pnpm dlx shadcn@4.23.0 init -t vite -b base -p nova`, then `pnpm dlx shadcn@4.23.0 add <component>`, in `apps/desktop` |
| `apps/desktop/src-tauri` | `pnpm tauri init --ci -A vvorkflow -W vvorkflow -D ../dist -P http://localhost:5173`, in `apps/desktop` |
| `Cargo.lock` | `cargo generate-lockfile` |
| `lefthook.yml` | The postinstall script of `lefthook`, after `pnpm approve-builds lefthook` |
| `apps/desktop/.storybook` | `pnpm dlx create-storybook@10.6.6 --type react --builder vite --features docs a11y`, in `apps/desktop` |
| `apps/desktop/playwright.config.ts` | `pnpm dlx create-playwright@1.17.139 --browser=chromium --browser=webkit --no-examples`, in `apps/desktop` |

These files have no generator, so they are written by hand:\
`pnpm-workspace.yaml`, `turbo.json`, `Cargo.toml`, `rust-toolchain.toml`, `commitlint.config.js`, the Prettier and Steiger configurations, and `.github/workflows/ci.yml`.

## Branch strategy

The repository uses GitHub flow: work branches from `main`, and a squash merge of each pull request to `main`.\
The rules are in [`docs/conventions/git.md`](docs/conventions/git.md).

## Conventions

Agents start at [`AGENTS.md`](AGENTS.md).\
The project conventions are in [`docs/conventions/`](docs/conventions/).

## License

[MIT](LICENSE)
