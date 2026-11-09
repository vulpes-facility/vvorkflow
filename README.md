# vvorkflow

A light IDE for directing TUI coding agents across git worktrees.\
A main agent in a terminal directs worker agents, such as Codex and Claude Code.\
The workers run as their real TUIs, in terminal tabs, in the worktrees of a repository.

## Status

vvorkflow is at the design stage, and the repository has no app yet.\
The start steps, the folder layout, and the generator commands come with the first app.

The design follows the [core values](docs/core-values.md).

## Branch strategy

The repository uses GitHub flow: work branches from `main`, and a squash merge of each pull request to `main`.\
The rules are in [`docs/conventions/git.md`](docs/conventions/git.md).

## Conventions

Agents start at [`AGENTS.md`](AGENTS.md).\
The project conventions are in [`docs/conventions/`](docs/conventions/).

## License

[MIT](LICENSE)
