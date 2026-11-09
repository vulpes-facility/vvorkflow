# Git

The repository uses GitHub flow.

1. `main` is the only long-lived branch.
2. Make each work branch from `main`, and name it `<type>/<topic>`, for example `feat/terminal-tabs`.\
   Use a type from the Conventional Commits 1.0.0 types of `@commitlint/config-conventional`, and a topic in lower-case kebab-case.
3. Write each commit message and each pull request title in the Conventional Commits 1.0.0 form.
4. Sign each commit.\
   The organization refuses unsigned commits on every branch.
5. Merge each pull request to `main` with a squash merge.\
   The squash commit takes the title and the description of the pull request.
