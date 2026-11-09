# Tooling

The project uses the tools of the `vulpes-conventions` plugin.\
This file gives only the rules that are different from that plugin, or that it does not give.

1. Lint TypeScript with oxlint, not ESLint.\
   create-vite 9 makes oxlint the linter of the `react-compiler-ts` template.
2. Keep the shadcn components in `apps/desktop/src/shared/ui/` in the form that shadcn makes.\
   `components.json` points shadcn at the `shared` segments of Feature-Sliced Design.\
   The oxlint rule `react/only-export-components` is off only in that folder, because shadcn components also export their variants.
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
