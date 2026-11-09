// Builds the engine process, `vvorkflow-server`, so that the app finds it next
// to its own executable in `target/<profile>/`. Tauri runs this script before
// `tauri dev` and `tauri build`, and sets TAURI_ENV_DEBUG for a debug build.
//
// With `--sidecar`, the script also copies the binary to
// `src-tauri/binaries/vvorkflow-server-<target triple>`, which the bundle
// configuration (`src-tauri/tauri.bundle.json`) puts in the installer.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const debug = process.env.TAURI_ENV_DEBUG !== 'false'
const root = fileURLToPath(new URL('../../../', import.meta.url))
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
  const host = /^host: (.+)$/m.exec(
    execFileSync('rustc', ['-vV'], { encoding: 'utf8' }),
  )
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? host?.[1]
  if (!triple) throw new Error('The target triple of Rust is not known.')
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
