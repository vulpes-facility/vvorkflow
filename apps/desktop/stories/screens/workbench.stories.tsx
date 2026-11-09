import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { MacTrafficLights } from '../../fixtures/mac-traffic-lights'
import { expandedPaths, repositories } from '../../fixtures/repositories'
import { terminals } from '../../fixtures/terminals'
import {
  projects,
  status,
  windowContext,
  windowControls,
} from '../../fixtures/workbench'
import { SampleWorkbench } from '../../fixtures/sample-workbench'

const meta = {
  title: 'Screens/Workbench',
  // The page, with the sample repositories served as the engine would.
  component: SampleWorkbench,
  decorators: [
    (Story, context) => (
      <div style={{ height: '100vh' }}>
        {context.args.platform === 'macos' && <MacTrafficLights />}
        <Story />
      </div>
    ),
  ],
  args: {
    platform: 'macos',
    projects,
    context: windowContext,
    status,
    onNewProject: fn(),
    onOpenFolder: fn(),
    onAddWorktree: fn(),
    onOpenProject: fn(),
    onOpenSettings: fn(),
    commandPaletteShortcut: 'mod+shift+p',
  },
} satisfies Meta<typeof SampleWorkbench>

export default meta
type Story = StoryObj<typeof meta>

/** The main window on macOS, with the Welcome tab. */
export const MacosDark: Story = {}

/** The same window in the light theme. */
export const MacosLight: Story = { globals: { colorScheme: 'light' } }

/** Windows has no native decorations: the title bar holds the caption buttons. */
export const WindowsDark: Story = {
  args: { platform: 'windows', windowControls },
}

/** Linux has no native decorations: the title bar holds round GNOME buttons. */
export const LinuxDark: Story = { args: { platform: 'linux', windowControls } }

/** The first start: an empty projects root, and no status. */
export const FirstRun: Story = {
  args: { projects: [], context: undefined, status: undefined },
}

/** An engine that did not start, because its projects root is not correct. */
export const RootError: Story = {
  args: {
    projects: [],
    engineError: 'VVORKFLOW_ROOT is not an absolute path: projects.',
    context: undefined,
    status: undefined,
  },
}

/**
 * The window as the app opens it today: no handlers, so no start actions, no
 * settings, and no command hint.
 */
export const AppStart: Story = {
  args: {
    projects: [],
    context: undefined,
    status: undefined,
    onNewProject: undefined,
    onOpenFolder: undefined,
    onAddWorktree: undefined,
    onOpenProject: undefined,
    onOpenSettings: undefined,
    commandPaletteShortcut: undefined,
  },
}

/**
 * The window at 200 % zoom (WCAG 2.2 SC 1.4.4). The screen capture opens it
 * in a 720 by 450 viewport, which is a 1440 by 900 window at 200 %. The
 * editor area is then about as narrow as at the minimum window width with the
 * widest side bar.
 */
export const Zoomed200: Story = {}

/**
 * The window at 320 CSS pixels wide (WCAG 2.2 SC 1.4.10), as at 400 % zoom.
 * The side bar closes by itself, and the Welcome tab reflows to one column.
 */
export const Reflow320: Story = {}

/**
 * The Explorer with two repositories of three worktrees each. The current
 * worktree is open down to a deep folder, and it shows every git status.
 */
export const Explorer: Story = { args: { repositories, expandedPaths } }

/** The same Explorer in the light theme. */
export const ExplorerLight: Story = {
  args: { repositories, expandedPaths },
  globals: { colorScheme: 'light' },
}

/**
 * Two terminal tabs over the Explorer: the active tab runs a shell with the
 * ANSI colors and wide characters, as an agent's TUI would draw them.
 */
export const Terminal: Story = {
  args: { repositories, expandedPaths, terminals },
}

/** The same terminal tabs in the light theme. */
export const TerminalLight: Story = {
  args: { repositories, expandedPaths, terminals },
  globals: { colorScheme: 'light' },
}
