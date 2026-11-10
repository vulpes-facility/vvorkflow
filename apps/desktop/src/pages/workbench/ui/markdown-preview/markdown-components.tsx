import type { Components } from 'react-markdown'
import { cn } from '@/shared/lib'
import { Checkbox, Heading, Link } from './markdown-elements'
import { MarkdownImage } from './markdown-image'

/** The elements of a document, in the design tokens. */
export const markdownComponents: Components = {
  h1: (props) => <Heading level={1} {...props} />,
  h2: (props) => <Heading level={2} {...props} />,
  h3: (props) => <Heading level={3} {...props} />,
  h4: (props) => <Heading level={4} {...props} />,
  h5: (props) => <Heading level={5} {...props} />,
  h6: (props) => <Heading level={6} {...props} />,
  p: ({ node: _node, ...props }) => <p {...props} className="my-3" />,
  a: Link,
  img: ({ node: _node, src, alt }) => (
    <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} />
  ),
  input: Checkbox,
  ul: ({ node: _node, className, ...props }) => (
    <ul
      {...props}
      className={cn(
        'my-3 list-disc pl-6 marker:text-subtle-foreground',
        className?.includes('contains-task-list') && 'list-none pl-1',
      )}
    />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol
      {...props}
      className="my-3 list-decimal pl-6 marker:text-muted-foreground"
    />
  ),
  li: ({ node: _node, ...props }) => (
    <li
      {...props}
      className="my-1 rounded-sm pl-1 outline-none focus:ring-1 focus:ring-ring [&>ol]:my-1 [&>ul]:my-1"
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      {...props}
      className="my-4 border-l-2 border-input pl-4 text-muted-foreground"
    />
  ),
  hr: ({ node: _node }) => <hr className="my-8 border-border" />,
  pre: ({ node: _node, ...props }) => (
    // The block scrolls inside itself, and the keyboard can reach it.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <pre
      {...props}
      tabIndex={0}
      className="my-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-normal outline-none focus-visible:ring-1 focus-visible:ring-ring [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]"
    />
  ),
  code: ({ node: _node, ...props }) => (
    <code
      {...props}
      className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]"
    />
  ),
  table: ({ node: _node, ...props }) => (
    // The table scrolls inside itself, so that the page does not (SC 1.4.10).
    <div
      tabIndex={0}
      className="my-4 overflow-x-auto rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <table {...props} className="w-max min-w-full border-collapse text-sm" />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th
      {...props}
      className="border border-border bg-muted px-3 py-1.5 text-left font-semibold"
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td {...props} className="border border-border px-3 py-1.5 align-top" />
  ),
  section: ({ node: _node, ...props }) => (
    <section
      {...props}
      className={cn(
        'data-footnotes' in props && 'mt-10 border-t border-border pt-2',
      )}
    />
  ),
}
