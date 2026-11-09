import { Files } from 'lucide-react'
import type { Meta, StoryObj } from '@storybook/react-vite'

const surfaces = [
  'editor',
  'chrome',
  'sidebar',
  'popover',
  'hover',
  'selection',
  'hairline',
  'input',
]
const text = ['foreground', 'muted-foreground', 'chrome-foreground', 'link']
/** Icons only: 3:1 is enough for non-text (WCAG 2.2 SC 1.4.11), not for text. */
const icons = ['subtle-foreground', 'indicator']
const accent = ['primary', 'indicator', 'ring', 'destructive']
const git = [
  ['git-added', 'A', 'Added'],
  ['git-modified', 'M', 'Modified'],
  ['git-deleted', 'D', 'Deleted'],
  ['git-untracked', 'U', 'Untracked'],
  ['git-conflict', 'C', 'Conflict'],
  ['git-ignored', 'I', 'Ignored'],
] as const
const typeScale = [
  ['text-2xl', '28 / 34', 'vvorkflow'],
  ['text-xl', '20 / 28', 'Agent graphs'],
  ['text-lg', '16 / 24', 'Add worktree'],
  ['text-sm', '14 / 20', 'Open a folder to see its worktrees and files.'],
  [
    'text-ui',
    '13 / 18',
    'The base size of the interface: tabs, rows, and menus.',
  ],
  ['text-xs', '12 / 16', 'Secondary text, paths, and the status bar.'],
  ['text-2xs', '11 / 16', 'VIEW TITLES AND BADGES'],
] as const

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="size-8 shrink-0 rounded-md border border-border"
        style={{ background: `var(--${name})` }}
      />
      <code className="font-mono text-xs text-muted-foreground">--{name}</code>
    </div>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xs font-semibold tracking-label text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Tokens() {
  return (
    // The sheet grows with its content, so that the screen capture takes all of it.
    <div className="min-h-screen bg-editor p-10 text-foreground">
      <div className="mx-auto grid max-w-5xl grid-cols-3 gap-10">
        <Group title="Surfaces">
          {surfaces.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </Group>
        <Group title="Text and icons">
          {text.map((name) => (
            <div key={name} className="flex items-center gap-3">
              <span
                className="w-8 text-center text-lg font-semibold"
                style={{ color: `var(--${name})` }}
              >
                Aa
              </span>
              <code className="font-mono text-xs text-muted-foreground">
                --{name}
              </code>
            </div>
          ))}
        </Group>
        <Group title="Icons">
          {icons.map((name) => (
            <div key={name} className="flex items-center gap-3">
              <span
                className="flex w-8 justify-center"
                style={{ color: `var(--${name})` }}
              >
                <Files className="size-icon-lg" strokeWidth={1.5} aria-hidden />
              </span>
              <code className="font-mono text-xs text-muted-foreground">
                --{name}
              </code>
            </div>
          ))}
        </Group>
        <Group title="Accent">
          {accent.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </Group>
        <Group title="Git status: a color and a letter">
          {git.map(([name, letter, label]) => (
            <div key={name} className="flex h-row items-center gap-3 text-ui">
              <span className="flex-1" style={{ color: `var(--${name})` }}>
                {label.toLowerCase()}.ts
              </span>
              <span
                className="w-4 text-center font-mono text-xs font-semibold"
                style={{ color: `var(--${name})` }}
              >
                {letter}
              </span>
            </div>
          ))}
        </Group>
        <div className="col-span-2">
          <Group title="Type scale: Geist and Geist Mono">
            {typeScale.map(([className, size, sample]) => (
              <div key={className} className="flex items-baseline gap-4">
                <code className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                  {size}
                </code>
                <span className={className}>{sample}</span>
              </div>
            ))}
            <div className="flex items-baseline gap-4">
              <code className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                13 / 18
              </code>
              <span className="font-mono text-ui">
                const worktree = await vv.worktree.add('feat/tabs')
              </span>
            </div>
          </Group>
        </div>
      </div>
    </div>
  )
}

const meta = { title: 'Foundations/Tokens', component: Tokens } satisfies Meta<
  typeof Tokens
>
export default meta

export const Dark: StoryObj<typeof meta> = {}
export const Light: StoryObj<typeof meta> = {
  globals: { colorScheme: 'light' },
}
