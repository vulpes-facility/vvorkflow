import { useEffect, useState } from 'react'
import { CodeEditor, DiffEditor } from '../src/pages/workbench'
import type { Platform } from '../src/shared/lib'
import type { SampleFile } from './editor'

/** What the tests read and drive from the page. */
export interface EditorProbe {
  /** The calls of the callbacks, in order: `dirty:true`, `dirty:false`, or `save:<text>`. */
  calls: string[]
  /** Gives the editor a new text and a new version, as a read from the disk does. */
  setText: (text: string, version: string) => void
  /** Gives the diff editor a new original text. */
  setOriginal: (text: string) => void
}

declare global {
  interface Window {
    editorProbe?: EditorProbe
  }
}

interface EditorHarnessProps {
  file: SampleFile
  platform: Platform
  readOnly?: boolean
  /** The text to compare with. A value makes the harness a diff editor. */
  original?: string
}

/**
 * An editor with a control after it, and a probe on the page for the tests.
 * The control is the next stop of the Tab key, after the editor.
 */
export function EditorHarness({
  file,
  platform,
  readOnly,
  original,
}: EditorHarnessProps) {
  const [text, setText] = useState(file.text)
  const [version, setVersion] = useState('1')
  const [compared, setCompared] = useState(original)
  const [calls] = useState<string[]>([])

  useEffect(() => {
    window.editorProbe = {
      calls,
      setText: (next, nextVersion) => {
        setText(next)
        setVersion(nextVersion)
      },
      setOriginal: setCompared,
    }
    return () => {
      delete window.editorProbe
    }
  }, [calls])

  const shared = {
    path: file.path,
    text,
    version,
    readOnly,
    platform,
    onDirtyChange: (dirty: boolean) => calls.push(`dirty:${dirty}`),
    onSave: (saved: string) => calls.push(`save:${saved}`),
  }
  return (
    <div
      data-harness
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--editor)',
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        {compared === undefined ? (
          <CodeEditor {...shared} />
        ) : (
          <DiffEditor {...shared} original={compared} />
        )}
      </div>
      <button type="button" style={{ height: 24, color: 'var(--foreground)' }}>
        Next control
      </button>
    </div>
  )
}
