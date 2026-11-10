// Builds the engine process, `vvorkflow-server`, so that the app finds it next
// to its own executable in `target/<profile>/`. Tauri runs this script before
// `tauri dev` and `tauri build`.
//
// With `--sidecar`, the script also copies the binary to
// `src-tauri/binaries/vvorkflow-server-<target triple>`, which the bundle
// configuration (`src-tauri/tauri.bundle.json`) puts in the installer.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Tauri sets TAURI_ENV_DEBUG to `true` for `tauri dev` and `tauri build --debug`.
const debug = process.env.TAURI_ENV_DEBUG === 'true'
const root = fileURLToPath(new URL('../../../', import.meta.url))

// The script builds the engine process for the host only. A build of the app
// for another target would get an engine that does not run there.
const host = /^host: (.+)$/m.exec(
  execFileSync('rustc', ['-vV'], { encoding: 'utf8' }),
)?.[1]
if (!host) throw new Error('The host triple of Rust is not known.')
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? host
if (triple !== host) {
  throw new Error(
    `A build for ${triple} on ${host} is not supported: the engine process builds only for the host.`,
  )
}
execFileSync(
  'cargo',
  [
    'build',
    '--locked',
    '-p',
    'vvorkflow-server',
    ...(debug ? [] : ['--release']),
  ],
  { cwd: root, stdio: 'inherit' },
)

if (process.argv.includes('--sidecar')) {
  const suffix = triple.includes('windows') ? '.exe' : ''
  const binaries = fileURLToPath(
    new URL('../src-tauri/binaries/', import.meta.url),
  )
  mkdirSync(binaries, { recursive: true })
  copyFileSync(
    `${root}target/${debug ? 'debug' : 'release'}/vvorkflow-server${suffix}`,
    `${binaries}vvorkflow-server-${triple}${suffix}`,
  )
}
