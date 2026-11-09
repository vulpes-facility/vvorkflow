import type { StorybookConfig } from '@storybook/react-vite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resolves the folder of a package, as Storybook needs in a pnpm workspace. */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)))
}

const config: StorybookConfig = {
  // The stories and their fixtures are test tools: they stay outside `src/`.
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(ts|tsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: getAbsolutePath('@storybook/react-vite'),
  core: { disableTelemetry: true },
}

export default config
