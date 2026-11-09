# Agent instructions

The agent instructions of a repository are `CLAUDE.md`, `AGENTS.md`, and the files in `docs/conventions/`.\
`AGENTS.md` is the entry point for all agents.\
Write these files in English.

## CLAUDE.md

1. The repository MUST have a `CLAUDE.md` at the root, next to `AGENTS.md`.
2. `CLAUDE.md` MUST contain only these parts, in this order:\
   a. One sentence that tells what the file is.\
   b. A `## Index` section with one entry, for `AGENTS.md`.\
   c. The line `@AGENTS.md`.
3. Write `@AGENTS.md` on its own line, outside a code block.\
   Then Claude Code loads `AGENTS.md` with `CLAUDE.md`.\
   Claude Code does not load an import in a code block or a code span.
4. Do not write other instructions in `CLAUDE.md`.\
   Write each rule in a file in `docs/conventions/`.\
   Add that file to the index of `AGENTS.md`, so that all agents read the same instructions.

```markdown
# CLAUDE.md

Claude Code reads this file, which loads the instructions for all agents from `AGENTS.md`.

## Index

- `AGENTS.md` - The project description and the index of the files that agents need.

@AGENTS.md
```

## AGENTS.md

1. The repository MUST have an `AGENTS.md` at the root.
2. `AGENTS.md` MUST contain only these parts, in this order:\
   a. A short description of the project: what it is, and who uses it.\
   b. A `## Index` section.
3. Do not write rules in `AGENTS.md`.\
   Write each rule in a file in `docs/conventions/`, and add that file to the index.

## Project conventions

1. Keep the conventions of the project in `docs/conventions/`, in one file for each topic.\
   Name each file in lower-case kebab-case (for example, `docs/conventions/writing.md`).
2. Keep each rule in one file only.\
   When a different file needs the rule, link to it.
3. Keep the rules of this file in `docs/conventions/agent-instructions.md`.

## Index

1. Write each entry in this form: ``- `{path}` - {one-sentence summary}``.
2. Write each path from the folder of the file that contains the index.\
   End the path of a folder with `/`.
3. Add an entry for each file and each folder that an agent must know to do work in the project.\
   Add one entry for each file in `docs/conventions/`, not one entry for the folder.
4. Do not add files that a tool makes or keeps, for example lockfiles and build output.
5. Write the summary so that an agent can decide to read the file without opening it.\
   Tell what the file contains, or when to read it.
6. When you add, move, or delete a file that the index lists, change the index in the same commit.

## App folders

1. In a monorepo, an app folder MAY have its own `CLAUDE.md`, `AGENTS.md`, and `docs/conventions/`, with the rules of this file.\
   Do this only when the app has conventions that the other apps do not have.
2. Add the `AGENTS.md` of each app to the index of the root `AGENTS.md`.
