import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect } from 'react'
import '../src/app/styles/index.css'
import { applyColorScheme, type ColorScheme } from '../src/shared/lib'

function ColorSchemeRoot({
  scheme,
  children,
}: {
  scheme: ColorScheme
  children: React.ReactNode
}) {
  useEffect(() => applyColorScheme(document.documentElement, scheme), [scheme])
  return children
}

/** Applies the color scheme of the toolbar to the whole document, as the app does. */
const withColorScheme: Decorator = (Story, context) => (
  <ColorSchemeRoot scheme={context.globals.colorScheme as ColorScheme}>
    <Story />
  </ColorSchemeRoot>
)

const preview: Preview = {
  globalTypes: {
    colorScheme: {
      description: 'The color scheme of the design tokens',
      toolbar: {
        title: 'Color scheme',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { colorScheme: 'dark' },
  // Select the theme before the story renders, as the app does before its first render.
  beforeEach: ({ globals }) => {
    applyColorScheme(
      document.documentElement,
      globals.colorScheme as ColorScheme,
    )
  },
  decorators: [withColorScheme],
  parameters: {
    layout: 'fullscreen',
    a11y: {
      // Fail the a11y panel, and the screen capture, on any WCAG 2.2 A or AA violation.
      test: 'error',
      options: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      },
    },
  },
}

export default preview
