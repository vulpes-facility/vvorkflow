import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const tokensPath = join(root, 'src/app/styles/tokens.css')
const tokens = readFileSync(tokensPath, 'utf8')

/** Reads the custom properties of each `selector { ... }` block, in order. */
function blocks(css: string, selector: string): Map<string, string>[] {
  const result: Map<string, string>[] = []
  const pattern = new RegExp(
    `(^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`,
    'g',
  )
  for (const match of css.matchAll(pattern)) {
    const body = match[2].replace(/\/\*[\s\S]*?\*\//g, '')
    const properties = new Map<string, string>()
    for (const declaration of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      properties.set(declaration[1], declaration[2].trim())
    }
    result.push(properties)
  }
  return result
}

const [primitives, light] = blocks(tokens, ':root')
const [dark] = blocks(tokens, '.dark')
const themes = { light, dark }

/** The semantic variables that shadcn components read. */
const shadcnVariables = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'radius',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
]

describe('tokens.css', () => {
  it('has primitives, a light theme, and a dark theme', () => {
    expect(primitives.size).toBeGreaterThan(0)
    expect(light.size).toBeGreaterThan(0)
    expect(dark.size).toBeGreaterThan(0)
  })

  it('names each primitive --vv-*, and no semantic variable --vv-*', () => {
    expect(
      [...primitives.keys()].filter((name) => !name.startsWith('--vv-')),
    ).toEqual([])
    for (const theme of Object.values(themes)) {
      expect(
        [...theme.keys()].filter((name) => name.startsWith('--vv-')),
      ).toEqual([])
    }
  })

  it('defines the same semantic variables in both themes', () => {
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort())
  })

  it('defines every shadcn variable', () => {
    for (const name of shadcnVariables)
      expect(light.has(`--${name}`), name).toBe(true)
  })

  it('maps each semantic variable to one primitive', () => {
    for (const [themeName, theme] of Object.entries(themes)) {
      for (const [name, value] of theme) {
        const match = /^var\((--vv-[\w-]+)\)$/.exec(value)
        expect(match, `${themeName} ${name}: ${value}`).not.toBeNull()
        expect(
          primitives.has(match![1]),
          `${themeName} ${name} -> ${match![1]}`,
        ).toBe(true)
      }
    }
  })
})

describe('the source outside tokens.css', () => {
  const rawColor =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/

  function files(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) return files(path)
      return /\.(tsx?|css)$/.test(name) ? [path] : []
    })
  }

  /** The lines of the source that match `pattern`, as `path:line`. */
  function linesMatching(pattern: RegExp): string[] {
    return files(join(root, 'src'))
      .filter((path) => path !== tokensPath)
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => pattern.test(line))
          .map(({ index }) => `${relative(root, path)}:${index + 1}`),
      )
  }

  it('has no raw color value, also not in an arbitrary class', () => {
    expect(linesMatching(rawColor)).toEqual([])
  })

  it('draws focus indicators with the opaque ring color', () => {
    // An opacity modifier would lower the 3:1 contrast of WCAG 2.2 SC 1.4.11.
    expect(linesMatching(/\b(?:ring|outline|border)-ring\/\d+/)).toEqual([])
  })

  it('uses no color of the Tailwind palette', () => {
    const paletteUtility =
      /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|divide|placeholder|caret|accent|decoration|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)\b/
    expect(linesMatching(paletteUtility)).toEqual([])
  })
})

/** Converts an `oklch(L C h)` value to the WCAG relative luminance of its sRGB color. */
function luminance(value: string): number {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value)
  if (!match) throw new Error(`not an opaque oklch color: ${value}`)
  const [lightness, chroma, hue] = match.slice(1).map(Number)
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel))
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function resolve(theme: Map<string, string>, name: string): string {
  const reference = /^var\((--vv-[\w-]+)\)$/.exec(theme.get(`--${name}`) ?? '')
  if (!reference) throw new Error(`--${name} is not a reference`)
  return primitives.get(reference[1])!
}

function contrast(
  theme: Map<string, string>,
  foreground: string,
  background: string,
): number {
  const [high, low] = [
    luminance(resolve(theme, foreground)),
    luminance(resolve(theme, background)),
  ].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const surfaces = [
  'editor',
  'chrome',
  'sidebar',
  'background',
  'card',
  'popover',
  'hover',
  'selection',
]

/** The syntax colors of the code editor. */
const syntaxColors = [
  'syntax-keyword',
  'syntax-string',
  'syntax-number',
  'syntax-comment',
  'syntax-function',
  'syntax-type',
  // The color of an error in the code: an invalid token, and a bracket with no pair.
  'editor-error',
]

/** Every surface that text of the code editor can be on. */
const editorSurfaces = [
  'editor',
  'editor-active-line',
  'editor-selection',
  'editor-match',
  'editor-match-current',
  'editor-inserted',
  'editor-inserted-text',
  'editor-deleted',
  'editor-deleted-text',
]

/** WCAG 2.2 SC 1.4.3: text needs 4.5:1 against each surface that it is on. */
const textPairs: [string, string[]][] = [
  ['foreground', surfaces],
  ['muted-foreground', surfaces],
  ['chrome-foreground', ['chrome', 'sidebar', 'hover', 'selection']],
  ['popover-foreground', ['popover']],
  ['card-foreground', ['card']],
  ['accent-foreground', ['accent']],
  ['muted-foreground', ['muted']],
  ['secondary-foreground', ['secondary']],
  ['sidebar-foreground', ['sidebar', 'sidebar-accent']],
  ['primary-foreground', ['primary', 'primary-hover']],
  ['link', ['editor', 'chrome', 'sidebar', 'popover']],
  ['destructive', ['editor', 'popover']],
  ['git-added', ['sidebar', 'editor', 'hover', 'selection']],
  ['git-modified', ['sidebar', 'editor', 'hover', 'selection']],
  ['git-deleted', ['sidebar', 'editor', 'hover', 'selection']],
  ['git-untracked', ['sidebar', 'editor', 'hover', 'selection']],
  ['git-conflict', ['sidebar', 'editor', 'hover', 'selection']],
  ['git-ignored', ['sidebar', 'editor', 'hover', 'selection']],
  // The editor: the foreground and the syntax colors on each surface of the editor.
  ['foreground', editorSurfaces],
  ['muted-foreground', editorSurfaces],
  ...syntaxColors.map((color): [string, string[]] => [color, editorSurfaces]),
]

/** WCAG 2.2 SC 1.4.11: icons, focus indicators, and control boundaries need 3:1. */
const nonTextPairs: [string, string[]][] = [
  // The chevron and the folder icon of a tree row show if it is open, also on hover and selection.
  ['subtle-foreground', ['chrome', 'sidebar', 'editor', 'hover', 'selection']],
  ['indicator', ['chrome', 'sidebar', 'editor']],
  [
    'ring',
    ['editor', 'chrome', 'sidebar', 'popover', 'hover', 'selection', 'accent'],
  ],
  ['input', ['editor', 'chrome', 'sidebar', 'popover']],
  ['scrollbar-thumb', ['editor', 'chrome', 'sidebar', 'popover']],
  // The grip identifies the separator, a control; the hairline beside it is decoration.
  ['grip', ['editor', 'chrome', 'sidebar']],
  ['window-close-hover-foreground', ['window-close-hover']],
  // The marks of a diff and the outline of a search match.
  ['git-added', ['editor', 'editor-inserted', 'editor-inserted-text']],
  ['git-deleted', ['editor', 'editor-deleted', 'editor-deleted-text']],
  ['subtle-foreground', ['editor-match', 'editor-match-current']],
  ['ring', ['editor-match', 'editor-match-current']],
]

const ansiColors = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
].flatMap((name) => [`ansi-${name}`, `ansi-bright-${name}`])

/**
 * The ANSI colors that may be faint on the terminal background of a theme:
 * a program uses black and white also as backgrounds. The terminal raises
 * their contrast at run time (`minimumContrastRatio`), and `pnpm screens`
 * checks the result.
 */
const faintAnsi: Record<keyof typeof themes, string[]> = {
  light: ['ansi-white', 'ansi-bright-white'],
  dark: ['ansi-black'],
}

describe('WCAG 2.2 contrast', () => {
  for (const [themeName, theme] of Object.entries(themes)) {
    const terminalText = [
      'terminal-foreground',
      ...ansiColors.filter(
        (color) => !faintAnsi[themeName as keyof typeof themes].includes(color),
      ),
    ]
    for (const foreground of terminalText) {
      it(`${themeName}: ${foreground} on terminal >= 4.5`, () => {
        expect(contrast(theme, foreground, 'terminal')).toBeGreaterThanOrEqual(
          4.5,
        )
      })
    }
    it(`${themeName}: terminal-selection-foreground on terminal-selection >= 4.5`, () => {
      expect(
        contrast(theme, 'terminal-selection-foreground', 'terminal-selection'),
      ).toBeGreaterThanOrEqual(4.5)
    })
    it(`${themeName}: terminal-cursor on terminal >= 3`, () => {
      expect(
        contrast(theme, 'terminal-cursor', 'terminal'),
      ).toBeGreaterThanOrEqual(3)
    })
    for (const [foreground, backgrounds] of textPairs) {
      for (const background of backgrounds) {
        it(`${themeName}: ${foreground} on ${background} >= 4.5`, () => {
          expect(
            contrast(theme, foreground, background),
          ).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
    for (const [foreground, backgrounds] of nonTextPairs) {
      for (const background of backgrounds) {
        it(`${themeName}: ${foreground} on ${background} >= 3`, () => {
          expect(
            contrast(theme, foreground, background),
          ).toBeGreaterThanOrEqual(3)
        })
      }
    }
  }
})
