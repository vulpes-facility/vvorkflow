import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { EditorHarness } from '../../fixtures/editor-harness'
import { CodeEditor, DiffEditor } from '../../src/pages/workbench'
import { detectPlatform } from '../../src/shared/lib'
import {
  crlfFile,
  markdownFile,
  typeScriptFile,
  typeScriptOriginal,
} from '../../fixtures/editor'

const meta = {
  title: 'Screens/Editor',
  component: CodeEditor,
  // A full-height surface of the editor area, as a tab of the window has.
  decorators: [
    (Story, context) => (
      <div
        style={{
          height: '100vh',
          width: context.parameters.width ?? '100%',
          background: 'var(--editor)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    path: typeScriptFile.path,
    text: typeScriptFile.text,
    version: '1',
    platform: detectPlatform(navigator.userAgent),
    onDirtyChange: fn(),
    onSave: fn(),
  },
} satisfies Meta<typeof CodeEditor>

export default meta
type Story = StoryObj<typeof meta>

/** A TypeScript file in the dark theme. */
export const TypeScriptDark: Story = {}

/** The same file in the light theme. */
export const TypeScriptLight: Story = { globals: { colorScheme: 'light' } }

/** A Markdown file. */
export const Markdown: Story = {
  args: { path: markdownFile.path, text: markdownFile.text },
}

/** The search panel open, with a match under the cursor (`mod+F`). */
export const SearchOpen: Story = {}

/** A file that takes no input. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** A file with CRLF line endings. */
export const Crlf: Story = {
  args: { path: crlfFile.path, text: crlfFile.text },
}

/** The editor at 320 CSS pixels wide (WCAG 2.2 SC 1.4.10): the content scrolls, the page does not. */
export const Reflow320: Story = {}

/** The diff in a wide editor: the original at the left, the editable text at the right. */
export const DiffWideDark: Story = {
  render: (args) => <DiffEditor {...args} original={typeScriptOriginal} />,
}

/** The wide diff in the light theme. */
export const DiffWideLight: Story = {
  ...DiffWideDark,
  globals: { colorScheme: 'light' },
}

/** The diff in a narrow editor (560 CSS pixels): one unified column. */
export const DiffNarrow: Story = {
  ...DiffWideDark,
  parameters: { width: '560px' },
}

/** The editor with a control after it, for the keyboard tests (`e2e/editor.spec.ts`). */
export const Harness: Story = {
  render: (args) => (
    <EditorHarness
      file={{ path: args.path, text: args.text }}
      platform={args.platform}
      readOnly={args.readOnly}
    />
  ),
}

/** The diff editor with a control after it, for the keyboard and layout tests. */
export const DiffHarness: Story = {
  render: (args) => (
    <EditorHarness
      file={{ path: args.path, text: args.text }}
      platform={args.platform}
      original={typeScriptOriginal}
    />
  ),
}
