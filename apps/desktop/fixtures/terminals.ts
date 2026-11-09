import type { TerminalSession } from '../src/pages/workbench'

const esc = '\u001b['
const reset = `${esc}0m`
const color = (code: number, text: string) => `${esc}${code}m${text}${reset}`
const bold = (text: string) => `${esc}1m${text}${reset}`
const dim = (text: string) => color(90, text)

/** A shell prompt with the worktree path and the branch. */
const prompt = (path: string, branch: string) =>
  `${color(34, path)} ${color(35, branch)}\r\n${color(32, '❯')} `

/** A session that writes a fixed transcript, as a running process would. */
function transcript(
  id: string,
  title: string,
  lines: string[],
): TerminalSession {
  return {
    id,
    title,
    subscribe(onData) {
      onData(lines.join('\r\n'))
      return () => {}
    },
  }
}

const shellLines = [
  `${prompt('~/code/vvorkflow.terminal-tabs', 'feat/terminal-tabs')}pnpm test`,
  '',
  ` ${color(46, color(30, ' RUN '))} ${color(36, 'v5.1.0')} ${dim('~/code/vvorkflow.terminal-tabs/apps/desktop')}`,
  '',
  ` ${color(32, '✓')} tests/design-tokens.test.ts ${dim('(176 tests)')} ${color(33, '41ms')}`,
  ` ${color(32, '✓')} tests/explorer-model.test.ts ${dim('(8 tests)')} ${color(33, '6ms')}`,
  ` ${color(31, '✗')} tests/terminal-tabs.test.ts ${dim('>')} keeps the order of the tabs`,
  '',
  `   ${color(91, 'AssertionError')}: expected ${color(32, "[ 'codex', 'claude' ]")} to equal ${color(31, "[ 'claude', 'codex' ]")}`,
  `   ${color(36, '❯')} tests/terminal-tabs.test.ts${dim(':24:31')}`,
  '',
  ` ${dim('Test Files')}  ${color(91, bold('1 failed'))} ${dim('|')} ${color(92, bold('2 passed'))} ${dim('(3)')}`,
  `      ${dim('Tests')}  ${color(91, bold('1 failed'))} ${dim('|')} ${color(92, bold('184 passed'))} ${dim('(185)')}`,
  '',
  `${prompt('~/code/vvorkflow.terminal-tabs', 'feat/terminal-tabs')}git log --oneline -3`,
  `${color(33, 'a41c9e2')} feat(desktop): 터미널 탭의 순서를 지킨다`,
  `${color(33, '94331de')} feat(desktop): add the Explorer tree (#5)`,
  `${color(33, 'c05388e')} fix(desktop): keep the focus when the side bar opens or closes (#4)`,
  '',
  `${prompt('~/code/vvorkflow.terminal-tabs', 'feat/terminal-tabs')}git status --short`,
  ` ${color(33, 'M')} apps/desktop/src/pages/workbench/ui/editor-area/editor-area.tsx`,
  `${color(32, 'A')}  apps/desktop/src/pages/workbench/ui/terminal/terminal-tab.tsx`,
  `${color(31, '??')} scratch.md`,
  '',
  `${prompt('~/code/vvorkflow.terminal-tabs', 'feat/terminal-tabs')}`,
]

/** Two terminal sessions; the last one is the active tab. */
export const terminals: TerminalSession[] = [
  transcript('agent-explorer', 'codex · feat/explorer', [
    `${prompt('~/code/vvorkflow.explorer', 'feat/explorer')}codex`,
  ]),
  transcript('shell-terminal-tabs', 'zsh · feat/terminal-tabs', shellLines),
]
