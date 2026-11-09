# AGENTS.md

vvorkflow is a light desktop IDE for directing TUI coding agents across git worktrees, on a Rust engine and Tauri 2.\
Its owner uses it alone, for now.\
A main agent in a terminal directs worker agents, such as Codex and Claude Code, that run as their real TUIs.\
The repository has the scaffold of the desktop app, and no features yet.

## Index

- `README.md` - The requirements, the start steps, the tasks, the folder layout, the generator commands, and the branch strategy.
- `docs/core-values.md` - The quality bar, the core values in priority order, and the platform decisions that each design decision follows.
- `docs/conventions/agent-instructions.md` - The rules for `CLAUDE.md`, `AGENTS.md`, `docs/conventions/`, and the format of each index.
- `docs/conventions/writing.md` - How to write the documents: English, ASD-STE100, BCP 14 keywords, and Semantic Line Breaks.
- `docs/conventions/git.md` - GitHub flow: branch names, Conventional Commits, signed commits, and the squash merge.
- `docs/conventions/tooling.md` - The tool rules that differ from the `vulpes-conventions` plugin: oxlint, the shadcn folder, and the Node.js and Rust versions.
- `apps/desktop/` - The desktop app: the React web UI in `src/`, and the Tauri 2 shell in `src-tauri/`.
- `turbo.json` - The root tasks `build`, `dev`, `lint`, `check-types`, `test`, and `format`.
- `.github/workflows/ci.yml` - The CI checks that run on each pull request and on `main`.
- `LICENSE` - The MIT License of the repository.
