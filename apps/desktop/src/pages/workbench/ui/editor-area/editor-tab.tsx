import type {
  DockviewApi,
  DockviewPanelApi,
  IDockviewPanelHeaderProps,
} from 'dockview-react'
import { SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  LogoMark,
} from '@/shared/ui'

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
  containerApi,
  params,
}: IDockviewPanelHeaderProps<EditorTabParams>) {
  const trigger = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(api.title ?? '')
  useEffect(() => {
    const subscription = api.onDidTitleChange((event) => setTitle(event.title))
    return () => subscription.dispose()
  }, [api])

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={trigger}
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
      </ContextMenuTrigger>
      <ContextMenuContent
        // The focus goes back to the tab, or to the tab that is active after
        // the action, because a closed or moved tab is gone. When no tab is
        // left, it goes to the activity bar.
        finalFocus={() => {
          const tab = trigger.current?.closest<HTMLElement>('[role="tab"]')
          if (tab?.isConnected) return tab
          return (
            document.querySelector<HTMLElement>(
              '.dv-active-group [role="tab"][aria-selected="true"]',
            ) ??
            document.querySelector<HTMLElement>(
              '[data-region="activity-bar"] [role="tab"][tabindex="0"]',
            )
          )
        }}
      >
        <TabMenuItems api={api} editor={containerApi} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The actions of a tab, which are also the way to move a tab without a drag
 * (WCAG 2.2 SC 2.5.7). It reads the groups when the menu opens, and it shows
 * only the actions that apply.
 */
function TabMenuItems({
  api,
  editor,
}: {
  api: DockviewPanelApi
  editor: DockviewApi
}) {
  const groups = editor.groups
  const index = groups.indexOf(api.group)
  const others = api.group.panels.filter((panel) => panel.api !== api)
  const next = groups[index + 1]
  const previous = groups[index - 1]
  return (
    <>
      <ContextMenuItem onClick={() => api.close()}>Close</ContextMenuItem>
      {others.length > 0 && (
        <ContextMenuItem
          onClick={() => {
            for (const panel of others) panel.api.close()
          }}
        >
          Close others
        </ContextMenuItem>
      )}
      {(others.length > 0 || next || previous) && <ContextMenuSeparator />}
      {others.length > 0 && (
        <ContextMenuItem
          onClick={() => api.moveTo({ group: api.group, position: 'right' })}
        >
          Split right
        </ContextMenuItem>
      )}
      {next && (
        <ContextMenuItem
          onClick={() => api.moveTo({ group: next, position: 'center' })}
        >
          Move to next group
        </ContextMenuItem>
      )}
      {previous && (
        <ContextMenuItem
          onClick={() => api.moveTo({ group: previous, position: 'center' })}
        >
          Move to previous group
        </ContextMenuItem>
      )}
    </>
  )
}
