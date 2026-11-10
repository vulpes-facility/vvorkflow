# AGENTS.md

vvorkflow is a light IDE on a Rust engine and Tauri 2.\
The user opens folders to see and edit them, and opens terminals to run commands and agents, such as Claude Code and Codex.\
The engine runs on the user's computer or headless on a remote machine.\
Its owner uses it alone, for now.\
The desktop app has its design tokens, its window shell, the Welcome tab, the terminal tabs on sample data, and an Explorer that reads real folders and their git status from the local Rust engine.

## Index

- `README.md` - The requirements, the start steps, the tasks, the folder layout, the generator commands, and the branch strategy.
- `docs/core-values.md` - The quality bar, the purpose, the core values in priority order, and the decisions that the owner confirmed.
- `docs/architecture.md` - The parts, the transports, the protocol envelope, the projects root, the terminal sessions, the memory limits, the security rules, and the roadmap.
- `docs/conventions/agent-instructions.md` - The rules for `CLAUDE.md`, `AGENTS.md`, `docs/conventions/`, and the format of each index.
- `docs/conventions/writing.md` - How to write the documents: English, ASD-STE100, BCP 14 keywords, and Semantic Line Breaks.
- `docs/conventions/git.md` - GitHub flow: branch names, Conventional Commits, signed commits, and the squash merge.
- `docs/conventions/design.md` - The design rules: the tokens, WCAG 2.2 AA, the window shell, and the stories and screen captures.
- `docs/conventions/engine.md` - The rules that keep each request of the engine in the opened folders, and their known limit.
- `docs/conventions/tooling.md` - The tool rules that differ from the `vulpes-conventions` plugin: oxlint, the shadcn folder, the Node.js and Rust versions, and the Turborepo settings.
- `apps/desktop/` - The desktop app: the React web UI in `src/`, and the Tauri 2 shell in `src-tauri/`.
- `apps/desktop/scripts/build-server.mjs` - Builds the engine process `vvorkflow-server` before `tauri dev` and `tauri build`, and copies it as the sidecar of the bundle.
- `apps/desktop/src/app/styles/tokens.css` - The design tokens, the only source of design values, for the light and the dark theme.
- `apps/desktop/src/pages/workbench/` - The window shell: the activity bar, the side bar, the title bar, the editor area, the status bar, the Welcome tab, the New project dialog, the Explorer tree, and the terminal tabs.
- `apps/desktop/stories/` - The Storybook stories of the screens and the tokens, which the screen capture uses.
- `apps/desktop/fixtures/` - The sample data of the stories, which the code in `src/` never imports.
- `apps/desktop/src/shared/api/engine.ts` - The client of the engine: each request through the Tauri IPC, with its answer parsed by the generated protocol.
- `crates/vvorkflow-protocol/` - The protocol of the engine, as serde types, and its JSON Schema in `schema/`, the source of the TypeScript client.
- `crates/vvorkflow-server/` - The engine process `vvorkflow-server`: its local endpoint, its lock, and its WebSocket connections with the envelope of each request.
- `crates/vvorkflow-engine/` - The engine: the projects root, the folders, the worktrees, and the git status, inside the roots that the user opened.
- `.env.example` - The environment variables of the engine, such as the projects root `VVORKFLOW_ROOT`.
- `package.json` - The root scripts that run each task with Turborepo, and the pinned versions of pnpm and Node.js.
- `pnpm-workspace.yaml` - The workspace packages, and the packages that may run install scripts.
- `turbo.json` - The root tasks `build`, `dev`, `lint`, `check-types`, `test`, and `format`, and the root files that change every task.
- `Cargo.toml` - The Cargo workspace and its member crates.
- `rust-toolchain.toml` - The pinned Rust version and its components.
- `commitlint.config.js` - The commit message rules: Conventional Commits, with the pnpm package names as scopes.
- `lefthook.yml` - The git hook that checks each commit message with commitlint.
- `.github/workflows/ci.yml` - The CI checks that run on each pull request and on `main`.
- `LICENSE` - The MIT License of the repository.
