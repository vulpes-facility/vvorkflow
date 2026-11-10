/** The path and text of a sample file for the editor stories. */
export interface SampleFile {
  path: string
  text: string
}

/** A TypeScript file with 2-space indentation and most kinds of token. */
export const typeScriptFile: SampleFile = {
  path: 'src/queue/job-queue.ts',
  text: `import { EventEmitter } from 'node:events'

/** The state of a job in the queue. */
export type JobState = 'waiting' | 'running' | 'done' | 'failed'

export interface Job<T = unknown> {
  readonly id: number
  readonly payload: T
  state: JobState
  attempts: number
}

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 250 // doubled on each attempt

/**
 * A queue that runs jobs one at a time, in the order that they came.
 * A failed job runs again until it has used all its attempts.
 */
export class JobQueue<T> extends EventEmitter {
  private jobs: Job<T>[] = []
  private nextId = 1
  private active = false

  constructor(private readonly handler: (payload: T) => Promise<void>) {
    super()
  }

  add(payload: T): Job<T> {
    const job: Job<T> = {
      id: this.nextId++,
      payload,
      state: 'waiting',
      attempts: 0,
    }
    this.jobs.push(job)
    void this.drain()
    return job
  }

  private async drain(): Promise<void> {
    if (this.active) return
    this.active = true
    try {
      for (let job = this.take(); job; job = this.take()) {
        await this.run(job)
      }
    } finally {
      this.active = false
    }
  }

  private take(): Job<T> | undefined {
    return this.jobs.find((job) => job.state === 'waiting')
  }

  private async run(job: Job<T>): Promise<void> {
    job.state = 'running'
    job.attempts += 1
    try {
      await this.handler(job.payload)
      job.state = 'done'
    } catch (error) {
      const retry = job.attempts < MAX_ATTEMPTS
      job.state = retry ? 'waiting' : 'failed'
      if (retry) await sleep(RETRY_DELAY_MS * 2 ** (job.attempts - 1))
      else this.emit('failed', job, error)
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
`,
}

/** A Markdown file with a heading, a list, a link, and a code block. */
export const markdownFile: SampleFile = {
  path: 'docs/queue.md',
  text: `# Job queue

The queue runs **one job at a time**, in the order that they came.\\
A failed job runs again until it has used all its attempts.

## Use

1. Make the queue with a handler.
2. Call \`add(payload)\` for each job.
3. Listen for the \`failed\` event.

\`\`\`ts
const queue = new JobQueue<string>(async (name) => {
  await build(name)
})
queue.on('failed', (job) => console.error(job.id))
queue.add('desktop')
\`\`\`

> A job never runs twice at the same time.

See [the source](../src/queue/job-queue.ts) for the retry delay.
`,
}

/** A short file that has CRLF line endings, as a file from Windows has. */
export const crlfFile: SampleFile = {
  path: 'scripts/build.ps1',
  text: '$ErrorActionPreference = "Stop"\r\n\r\nWrite-Host "Build"\r\npnpm install\r\npnpm build\r\n',
}

/** The committed version of {@link typeScriptFile}: before the retry delay and the `take` method. */
export const typeScriptOriginal = typeScriptFile.text
  .replace(
    'const RETRY_DELAY_MS = 250 // doubled on each attempt',
    'const RETRY_DELAY_MS = 100',
  )
  .replace(
    "      if (retry) await sleep(RETRY_DELAY_MS * 2 ** (job.attempts - 1))\n      else this.emit('failed', job, error)\n",
    "      if (retry) await sleep(RETRY_DELAY_MS)\n      else this.emit('failed', job)\n",
  )
  .replace(
    "  private take(): Job<T> | undefined {\n    return this.jobs.find((job) => job.state === 'waiting')\n  }\n\n",
    '',
  )
  .replace(
    'for (let job = this.take(); job; job = this.take()) {',
    'for (const job of this.jobs) {',
  )
