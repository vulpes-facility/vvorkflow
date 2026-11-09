# Tooling

The project uses the tools of the `vulpes-conventions` plugin.\
This file gives only the rules that are different from that plugin, or that it does not give.

1. Lint TypeScript with oxlint, not ESLint.\
   create-vite 9 makes oxlint the linter of the `react-compiler-ts` template.
2. Keep the shadcn components in `apps/desktop/src/shared/ui/`.\
   `components.json` points shadcn at the `shared` segments of Feature-Sliced Design.\
   You MAY change their classes to fit the design, but keep their structure and their exports, so that the diff of a later `shadcn add` stays small.\
   The oxlint rule `react/only-export-components` is off in that folder, because shadcn components also export their variants.\
   It is also off in `apps/desktop/.storybook/`, because the Storybook preview exports its configuration next to a decorator component, and fast refresh does not apply to it.
3. Pin Node.js with `devEngines.runtime` in the root `package.json`, and let pnpm download it.\
   Do not add a different Node.js version manager.
4. Pin Rust in `rust-toolchain.toml`.
5. Let a package run its install script only when it is necessary.\
   Approve it with `pnpm approve-builds <package>`, which writes `allowBuilds` in `pnpm-workspace.yaml`.
6. The `lint` and `test` tasks of `apps/desktop` run after its `build` task, because the Tauri crate compiles only when `apps/desktop/dist` exists.
7. The root `dev` script runs Turborepo with `--env-mode=loose`.\
   In strict mode, Turborepo removes environment variables that the desktop app can need, for example `WAYLAND_DISPLAY`.\
   The `dev` task has no cache, so the loose mode does not change a cache key.
8. When a root file changes the result of every task, add it to `globalDependencies` in `turbo.json`.\
   Examples are `Cargo.toml`, `Cargo.lock`, and `rust-toolchain.toml`.
9. Use only package versions that are older than the `minimumReleaseAge` of pnpm.\
   Do not add a `minimumReleaseAgeExclude` entry.\
   Pick an older version.
10. Keep the Playwright specs and the Vitest tests of `apps/desktop` outside `src/`, in `e2e/` and `tests/`.\
    [design.md](design.md) gives the place of the stories and the fixtures.
11. Fix an advisory of `pnpm audit` in a transitive package with an entry in `overrides` of `pnpm-workspace.yaml`.\
    Name the advisory in a comment, and remove the entry when the direct dependency takes the patched version.\
    When no patched version exists, as for `deepmerge` in the shadcn CLI, accept a low advisory in a tool that the app does not bundle.
12. The serde types of `crates/vvorkflow-protocol` are the source of truth of the engine protocol.\
    `VVORKFLOW_UPDATE_SCHEMA=1 cargo test -p vvorkflow-protocol` writes its JSON Schema, and `pnpm --filter @vvorkflow/desktop generate:protocol` writes the zod client from it.\
    A Rust test and a Vitest test fail when the schema or the client is out of date.\
    The generator types the union of the requests as `any`, so `engine.ts` keeps a map of each method to its params and its value, and a Vitest test checks the map and the protocol version against the schema.\
    The client parses each answer of the engine at run time, because a value from another process can be wrong.
13. The `lint` and `test` scripts of `apps/desktop` check the whole Cargo workspace, and `apps/desktop/turbo.json` adds `crates/**` to their inputs.
14. Check a change of the engine in the real app.\
    Run `pnpm --filter @vvorkflow/desktop tauri build --debug --no-bundle`, then `target/debug/vvorkflow-desktop <folder>`: each folder of the command line opens at start.\
    On a machine with no display, run it under `Xvfb` and `dbus-run-session`, with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
