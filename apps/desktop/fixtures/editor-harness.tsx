import { useEffect, useRef, useState } from 'react'
import {
  CodeEditor,
  DiffEditor,
  type EditorHandle,
} from '../src/pages/workbench'
import type { Platform } from '../src/shared/lib'
import type { SampleFile } from './editor'

/** What the tests read and drive from the page. */
export interface EditorProbe {
  /**
   * The calls of the callbacks, in order: `dirty:true`, `conflict:false`, or `save:<text>`.
   * After `swapCallbacks()`, a call has the prefix `b:`.
   */
  calls: string[]
  /** Gives the editor a new text and a new version, as a read from the disk does. */
  setText: (text: string, version: string) => void
  /** Gives the diff editor a new original text. */
  setOriginal: (text: string) => void
  setReadOnly: (readOnly: boolean) => void
  setPlatform: (platform: Platform) => void
  setPath: (path: string) => void
  /** Gives the editor new callbacks, which add the prefix `b:` to their calls. */
  swapCallbacks: () => void
  /** Calls `revert()` of the editor. */
  revert: () => void
  /** Removes the editor from the React tree, or puts it back as a new mount. */
  setMounted: (mounted: boolean) => void
}

interface EditorHarnessProps {
  file: SampleFile
  platform: Platform
  readOnly?: boolean
  /** The text to compare with. A value makes the harness a diff editor. */
  original?: string
}

/**
 * An editor with a control after it, and a probe on the page for the tests
 * (`window.editorProbe`). The control is the next stop of the Tab key, after
 * the editor. The platform of the editor is the prop of the harness, which a
 * story takes from the user agent of the browser.
 */
export function EditorHarness({
  file,
  platform: initialPlatform,
  readOnly: initialReadOnly = false,
  original,
}: EditorHarnessProps) {
  const [text, setText] = useState(file.text)
  const [version, setVersion] = useState('1')
  const [compared, setCompared] = useState(original)
  const [readOnly, setReadOnly] = useState(initialReadOnly)
  const [platform, setPlatform] = useState(initialPlatform)
  const [path, setPath] = useState(file.path)
  const [mounted, setMounted] = useState(true)
  const [swapped, setSwapped] = useState(false)
  const [calls] = useState<string[]>([])
  const editor = useRef<EditorHandle>(null)

  useEffect(() => {
    const probe: EditorProbe = {
      calls,
      setText: (next, nextVersion) => {
        setText(next)
        setVersion(nextVersion)
      },
      setOriginal: setCompared,
      setReadOnly,
      setPlatform,
      setPath,
      swapCallbacks: () => setSwapped(true),
      revert: () => editor.current?.revert(),
      setMounted,
    }
    ;(window as unknown as { editorProbe?: EditorProbe }).editorProbe = probe
    return () => {
      delete (window as unknown as { editorProbe?: EditorProbe }).editorProbe
    }
  }, [calls])

  const prefix = swapped ? 'b:' : ''
  const shared = {
    path,
    text,
    version,
    readOnly,
    platform,
    ref: editor,
    onDirtyChange: (dirty: boolean) => calls.push(`${prefix}dirty:${dirty}`),
    onConflictChange: (conflict: boolean) =>
      calls.push(`${prefix}conflict:${conflict}`),
    onSave: (saved: string) => calls.push(`${prefix}save:${saved}`),
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
        {!mounted ? null : compared === undefined ? (
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
