import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  everything,
  hostile,
  longLines,
  remoteImagesDocument,
} from '../../fixtures/markdown'
import { MarkdownPreview } from '../../src/pages/workbench/ui/markdown-preview/markdown-preview'

/** What the stories record, for the e2e test to read. */
interface Recorded {
  openedLinks?: string[]
  allowCalls?: number
}
const recorded = globalThis as Recorded

const localImages = new Set(['photo.jpg', 'transparent.png'])

/** Serves a local image of the document from the sample media of Storybook. */
function resolveImage(path: string) {
  const name = path.split('/').pop() ?? ''
  return localImages.has(name) ? `/media/${name}` : undefined
}

const meta = {
  title: 'Screens/MarkdownPreview',
  component: MarkdownPreview,
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    text: everything,
    remoteImages: false,
    resolveImage,
    onAllowRemoteImages: () => {
      recorded.allowCalls = (recorded.allowCalls ?? 0) + 1
    },
    onOpenLink: (url) => {
      recorded.openedLinks = [...(recorded.openedLinks ?? []), url]
    },
  },
} satisfies Meta<typeof MarkdownPreview>

export default meta
type Story = StoryObj<typeof meta>

/** A document with every element, in the dark theme. */
export const Document: Story = {}

/** The same document in the light theme. */
export const DocumentLight: Story = { globals: { colorScheme: 'light' } }

/**
 * Remote images with `remoteImages` false: each one is a placeholder with its
 * host, no request goes out, and the button at the top allows them.
 */
export const RemoteBlocked: Story = {
  args: { text: remoteImagesDocument('https://images.example.com') },
}

/**
 * The same document with the remote images allowed. The images come from the
 * origin of Storybook, so that the screen capture needs no network.
 */
export const RemoteAllowed: Story = {
  args: { remoteImages: true },
  render: (args) => (
    <MarkdownPreview
      {...args}
      text={remoteImagesDocument(globalThis.location.origin)}
    />
  ),
}

/** A hostile document: raw HTML, scripts, and unsafe schemes have no effect. */
export const Hostile: Story = { args: { text: hostile } }

/** The document at 320 CSS pixels wide (WCAG 2.2 SC 1.4.10). */
export const Reflow320: Story = {}

/** Long lines at 320 CSS pixels wide: text wraps, and tables and code scroll inside themselves. */
export const LongLines320: Story = { args: { text: longLines } }
