import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { MacTrafficLights } from '../../fixtures/mac-traffic-lights'
import {
  recentProjects,
  status,
  windowContext,
  windowControls,
} from '../../fixtures/workbench'
import { WorkbenchPage } from '../../src/pages/workbench'

const meta = {
  title: 'Screens/Workbench',
  component: WorkbenchPage,
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
    recentProjects,
    context: windowContext,
    status,
    onNewProject: fn(),
    onOpenFolder: fn(),
    onAddWorktree: fn(),
    onOpenRecent: fn(),
    onOpenSettings: fn(),
    commandPaletteShortcut: 'mod+shift+p',
  },
} satisfies Meta<typeof WorkbenchPage>

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

/** The first start: no project, no recent projects, and no status. */
export const FirstRun: Story = {
  args: { recentProjects: [], context: undefined, status: undefined },
}

/**
 * The window as the app opens it today: no handlers, so no start actions, no
 * settings, and no command hint.
 */
export const AppStart: Story = {
  args: {
    recentProjects: [],
    context: undefined,
    status: undefined,
    onNewProject: undefined,
    onOpenFolder: undefined,
    onAddWorktree: undefined,
    onOpenRecent: undefined,
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
