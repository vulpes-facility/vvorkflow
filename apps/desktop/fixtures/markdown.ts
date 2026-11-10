/** The sample documents of the Markdown preview stories. */

const filler = (topic: string) =>
  `The ${topic} is checked before each release, and a failure stops the release. ` +
  'A reader who scrolls a long document keeps the position when the window changes size, ' +
  'and a line stays short enough to read without losing the start of the next line.'

/** A document with every element that the preview draws. */
export const everything = `# Release notes

A short paragraph with **bold**, *emphasis*, ~~strikethrough~~, \`inline code\`, a [link](https://example.com/docs), and an autolink: https://example.com/changelog.
${filler('build')}

## Highlights

### Engine

#### Sessions

##### Limits

###### Details

> A block quote keeps its own indent.
> It can hold \`code\` and a [link](https://example.com).

- A list item
- Another list item
  - A nested item
  - Another nested item
- The last list item
- [A link alone in a list item](https://example.com/item)

1. First step
2. Second step
3. Third step

- [x] Read the protocol
- [ ] Write the client
- [x] Run the screen checks

| Package | Version | Size |
| :------ | :-----: | ---: |
| engine  |  1.4.0  | 2 MB |
| server  |  1.4.1  | 1 MB |
| desktop |  0.9.0  | 8 MB |

| Link                                        |
| ------------------------------------------- |
| [A link alone in a table cell](https://example.com/cell) |

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}\`
}
\`\`\`

[A link alone in its paragraph](https://example.com/alone)

[![A linked image](./media/transparent.png)](https://example.com/image)

[Go](https://example.com/short)

---

![A photo](./media/photo.jpg)

## Notes

${filler('protocol')}[^1]

${filler('engine')}

${filler('desktop app')}[^2]

${filler('terminal')}

${filler('explorer')}

[^1]: The first footnote.
[^2]: The second footnote, with \`code\`.
`

/** A document with remote images in every form that Markdown has. */
export function remoteImagesDocument(base: string): string {
  return `# Remote images

An inline image: ![Chart](${base}/media/photo.jpg)

A reference-style image: ![Logo][logo]

An image in a link: [![Badge](${base}/media/transparent.png)](https://example.com)

A local image: ![Local](./media/transparent.png)

[logo]: ${base}/media/photo.jpg
`
}

/** A hostile document: each part of it MUST have no effect. */
export const hostile = `# Hostile document

<script>window.__pwned = 'script'</script>

<iframe src="https://remote-images.test/frame"></iframe>

<style>body { display: none !important }</style>

<img src="https://remote-images.test/raw.png" onerror="window.__pwned = 'onerror'">

<div onclick="window.__pwned = 'onclick'">raw html</div>

![inline](https://remote-images.test/inline.png)

![reference][ref]

![protocol-relative](//remote-images.test/relative.png)

![data](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=)

![script](javascript:window.__pwned='image')

[javascript link](javascript:window.__pwned='link')

[vbscript link](vbscript:msgbox)

[data link](data:text/html,<script>window.__pwned='data'</script>)

[safe link](https://example.com/safe)

[ref]: https://remote-images.test/reference.png

![space](<  https://remote-images.test/space.png>)

![upper](HTTPS://REMOTE-IMAGES.TEST/upper.png)

![backslash](\\\\\\\\remote-images.test\\bs.png)

![tab](java&#9;script:window.__pwned='image-tab')

![same scheme](https:remote-images.test/same-scheme.png)

[tab link](java&#9;script:window.__pwned='tab')

[upper link](JAVASCRIPT:window.__pwned='upper')

[space link](<  javascript:window.__pwned='space'>)

[drag me](https://link-target.test/page)

![dragged](https://remote-images.test/dragged.png)
`

/** A long line without a break, in text and in code, for the 320 pixel reflow. */
export const longLines = `# Long lines

https://example.com/a/very/long/path/that/has/no/place/to/break/in/it/at/all/and/keeps/going/on/and/on

\`inline-code-with-a-very-long-name-that-has-no-place-to-break-in-it-at-all-and-keeps-going\`

| A very long column name | Another long column name | A third long column name |
| ----------------------- | ------------------------ | ------------------------ |
| a value that is long    | another value that is long | a third value that is long |

\`\`\`
const aVeryLongLine = 'it does not wrap in a code block, so the block scrolls inside itself'
\`\`\`

![Wide](./media/photo.jpg)
`

/** A document with footnote labels that look like the ids of the preview. */
export const hostileFootnotes = `# Footnotes

${filler('first')}[^footnote-label]

${filler('second')}[^user-content-fn-1]

${filler('third')}[^1]

${filler('fourth')}

${filler('fifth')}

${filler('sixth')}

[^footnote-label]: A note with the label of the footnote section.
[^user-content-fn-1]: A note with a label that looks like an id.
[^1]: A plain note.
`
