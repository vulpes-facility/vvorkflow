# vvorkflow

A light IDE for directing TUI coding agents across git worktrees.\
A main agent in a terminal directs worker agents, such as Codex and Claude Code.\
The workers run as their real TUIs, in terminal tabs, in the worktrees of a repository.

## Status

The repository has the scaffold of the desktop app, and no features yet.\
The design follows the [core values](docs/core-values.md).

## Requirements

- [pnpm](https://pnpm.io/installation) 12.18.0.\
  pnpm downloads Node.js 26.13.0 for the project, from `devEngines` in `package.json`.
- [rustup](https://rustup.rs/).\
  It installs Rust 1.99.1 with rustfmt and clippy, from `rust-toolchain.toml`.
- The system dependencies of Tauri 2 for your operating system, from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).\
  On Ubuntu, these are `libwebkit2gtk-4.1-dev`, `build-essential`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, and `librsvg2-dev`.

## Start

```sh
pnpm install
pnpm dev
```

`pnpm dev` opens the desktop app in a Tauri window.\
To open only the web UI in a browser, run `pnpm --filter @vvorkflow/desktop dev:web`.

## Tasks

Run each task from the root. Turborepo runs it in each package.

| Command | Result |
| --- | --- |
| `pnpm dev` | Starts the desktop app with hot reload. |
| `pnpm build` | Builds the web UI into `apps/desktop/dist`. |
| `pnpm lint` | Checks the format and runs the linters: Prettier, oxlint, Steiger, rustfmt, and clippy. |
| `pnpm check-types` | Checks the TypeScript types. |
| `pnpm test` | Runs the Vitest and Cargo tests. |
| `pnpm format` | Formats the TypeScript and Rust code. |
| `pnpm --filter @vvorkflow/desktop bundle` | Builds the installable desktop app. |

Each task MUST pass with no errors and no warnings before a pull request.

## Layout

```text
.
├── apps/
│   └── desktop/            The desktop app
│       ├── src/            The web UI, in Feature-Sliced Design layers
│       │   ├── app/        The entry point and the global styles
│       │   └── shared/     The UI kit (shadcn) and the shared code
│       └── src-tauri/      The Tauri 2 shell, in Rust
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
