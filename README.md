# vvorkflow

A light IDE for directing TUI coding agents across git worktrees.\
A main agent in a terminal directs worker agents, such as Codex and Claude Code.\
The workers run as their real TUIs, in terminal tabs, in the worktrees of a project.

## Status

vvorkflow is at the design stage, and the repository has no app yet.\
The start steps, the folder layout, and the generator commands come with the first app.

The design follows the [core values](docs/core-values.md).

## Branch strategy

The repository uses GitHub flow.

- `main` is the only long-lived branch.
- Make each work branch from `main`, and name it `<type>/<topic>`, for example `feat/terminal-tabs`.
- Write each commit message and each pull request title in the Conventional Commits form.
- Sign each commit.
- Merge each pull request to `main` with a squash merge.\
  The squash commit takes the title and the description of the pull request.

## Conventions

Agents start at [`AGENTS.md`](AGENTS.md).\
The project conventions are in [`docs/conventions/`](docs/conventions/).

## License

[MIT](LICENSE)
