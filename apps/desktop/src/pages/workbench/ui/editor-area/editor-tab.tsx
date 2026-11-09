import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { SquareTerminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/shared/lib'
import { LogoMark } from '@/shared/ui'

/** The parameters of an editor panel that its tab reads. */
export interface EditorTabParams {
  /** The kind of the panel, which selects the icon of the tab. */
  kind?: 'welcome' | 'terminal'
  /** The terminal session of a terminal panel. */
  sessionId?: string
}

/** A tab of the editor area: the icon, the title, and a close icon for the pointer. */
export function EditorTab({
  api,
  params,
}: IDockviewPanelHeaderProps<EditorTabParams>) {
  const [title, setTitle] = useState(api.title ?? '')
  useEffect(() => {
    const subscription = api.onDidTitleChange((event) => setTitle(event.title))
    return () => subscription.dispose()
  }, [api])

  return (
    <div
      className="group flex h-full min-w-0 items-center gap-2 pr-1.5 pl-3 text-ui"
      onAuxClick={(event) => {
        // The middle button closes the tab, as in browsers.
        if (event.button === 1) api.close()
      }}
    >
      {params.kind === 'welcome' && (
        <LogoMark className="size-icon-sm shrink-0 text-foreground" />
      )}
      {params.kind === 'terminal' && (
        <SquareTerminal
          aria-hidden
          strokeWidth={1.75}
          className="size-icon-sm shrink-0 text-subtle-foreground"
        />
      )}
      <span className="truncate">{title}</span>
      {/*
        The tab itself is the focusable control (role="tab"), so the close
        icon is a pointer target only. Keyboard users close the active tab
        with the close shortcut of the workbench.
      */}
      <span
        aria-hidden
        data-pointer-target
        title={`Close ${title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          api.close()
        }}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground',
          'hover:bg-hover hover:text-foreground',
          'opacity-0 group-hover:opacity-100 [.dv-active-tab_&]:opacity-100',
        )}
      >
        <X className="size-icon-sm" strokeWidth={1.75} />
      </span>
    </div>
  )
}
