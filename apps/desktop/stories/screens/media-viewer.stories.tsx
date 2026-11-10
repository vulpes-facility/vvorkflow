import type { Meta, StoryObj } from '@storybook/react-vite'
import { MediaViewer } from '../../src/pages/workbench/ui/media-viewer/media-viewer'

const meta = {
  title: 'Screens/MediaViewer',
  component: MediaViewer,
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    kind: 'image',
    src: '/media/photo.jpg',
    name: 'photo.jpg',
    active: true,
  },
} satisfies Meta<typeof MediaViewer>

export default meta
type Story = StoryObj<typeof meta>

/** A photo-like image, fit to the view. */
export const Photo: Story = {}

/** The same viewer in the light theme. */
export const PhotoLight: Story = { globals: { colorScheme: 'light' } }

/** A small transparent image at its actual size, on the checkerboard. */
export const Transparent: Story = {
  args: { src: '/media/transparent.png', name: 'transparent.png' },
}

/** The transparent image in the light theme. */
export const TransparentLight: Story = {
  ...Transparent,
  globals: { colorScheme: 'light' },
}

/** A file that does not decode: the warning icon, and the message in its tooltip. */
export const Failed: Story = {
  args: { src: '/media/broken.png', name: 'broken.png' },
}

/** A video with the native controls. */
export const Video: Story = {
  args: { kind: 'video', src: '/media/clip.webm', name: 'clip.webm' },
}

/** An audio file with the native controls. */
export const Audio: Story = {
  args: { kind: 'audio', src: '/media/tone.wav', name: 'tone.wav' },
}

/** The image viewer at 320 CSS pixels wide: the toolbar stays one row. */
export const Reflow320: Story = {}
