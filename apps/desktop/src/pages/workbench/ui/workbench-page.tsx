import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanelProps,
} from 'dockview-react'
import { FolderOpen, Keyboard, Search, Settings } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { WindowControls } from '@/shared/api'
import { readPixelToken, type Platform } from '@/shared/lib'
import {
  Button,
  EmptyState,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  TooltipProvider,
  usePanelRef,
} from '@/shared/ui'
import { ActivityAction, ActivityBar } from './activity-bar/activity-bar'
import { EditorArea } from './editor-area/editor-area'
import { ExplorerView } from './explorer/explorer-view'
import type { EditorTabParams } from './editor-area/editor-tab'
import { SideBar } from './side-bar/side-bar'
import { NewProjectDialog } from './new-project/new-project-dialog'
import { TerminalView } from './terminal/terminal-view'
import { StatusBar, type StatusItem } from './status-bar/status-bar'
import { TitleBar, type WindowContext } from './title-bar/title-bar'
import { Welcome, type WelcomeProject } from './welcome/welcome'
import { isDialogKey } from '../model/dialog-keys'
import { useLayout } from '../model/layout'
import type { ExplorerRepository, ExplorerSource } from '../model/explorer'
import type { TerminalSession } from '../model/terminal'
import { useActionShortcuts } from '../model/use-action-shortcuts'
import { useEditorShortcuts } from '../model/use-editor-shortcuts'
import { useFocusRescue } from '../model/use-focus-rescue'
import { useNarrowWindow } from '../model/use-narrow-window'
import { useRegionShortcuts } from '../model/use-region-shortcuts'
import { useTabMenuKeys } from '../model/use-tab-menu-keys'
import { useViewShortcuts } from '../model/use-view-shortcuts'
import { views } from '../model/views'

const sideBarId = 'workbench-side-bar'

interface WorkbenchPageProps {
  platform: Platform
  /** The native window. Without it, as in a browser, the title bar has no window buttons. */
  windowControls?: WindowControls
  /** The project and the worktree in the title bar. */
  context?: WindowContext
  /** The projects of the projects root, on the Welcome tab. */
  projects: WelcomeProject[]
  /** The message of an engine that did not start, on the Welcome tab. */
  engineError?: string
  status?: { start?: StatusItem[]; end?: StatusItem[] }
  /** The open repositories of the Explorer. Without them, the view shows its empty state. */
  repositories?: ExplorerRepository[]
  /** Where the Explorer reads the folders and the git status. */
  explorer?: ExplorerSource
  /** The worktree and folder ids that the Explorer shows open at the start. */
  expandedPaths?: string[]
  /** The terminal sessions, such as agents. Each one opens as a tab of the editor area. */
  terminals?: TerminalSession[]
  onOpenFile?: (id: string) => void
  /**
   * Makes a project with the name that the user gave. When it rejects, the
   * dialog shows the message of the error. Without it, the window has no New
   * project action.
   */
  onCreateProject?: (name: string) => Promise<void>
  onOpenFolder?: () => void
  onAddWorktree?: () => void
  onOpenProject?: (project: WelcomeProject) => void
  onOpenSettings?: () => void
  /** The shortcut of the command palette, for the hint on the Welcome tab. */
  commandPaletteShortcut?: string
}

/**
 * The props of the page, and the action that opens the New project dialog,
 * for the panels of the editor area, which dockview renders.
 */
const PageProps = createContext<
  (WorkbenchPageProps & { onNewProject?: () => void }) | null
>(null)

/**
 * The window of vvorkflow: the activity bar and the side bar at full height,
 * and the title bar, the editor area, and the status bar at their right.
 */
export function WorkbenchPage(props: WorkbenchPageProps) {
  const {
    platform,
    windowControls,
    context,
    status,
    repositories,
    onCreateProject,
    onOpenFolder,
    onOpenSettings,
  } = props
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const onNewProject = onCreateProject
    ? () => setNewProjectOpen(true)
    : undefined
  const view = useLayout((state) => state.view)
  const sideBarOpen = useLayout((state) => state.sideBarOpen)
  const showView = useLayout((state) => state.showView)
  const selectView = useLayout((state) => state.selectView)
  const setSideBarOpen = useLayout((state) => state.setSideBarOpen)
  const toggleSideBar = useLayout((state) => state.toggleSideBar)
  useViewShortcuts(platform, showView, toggleSideBar)
  const narrow = useNarrowWindow(setSideBarOpen)
  useActionShortcuts(platform, {
    onNewProject,
    onOpenFolder: props.onOpenFolder,
    onOpenSettings,
  })

  // In a wide window the side bar is a panel next to the editor area. In a
  // narrow window it is a drawer over the editor area, which is then inert.
  const docked = sideBarOpen && !narrow
  const drawer = sideBarOpen && narrow

  // The panel follows the layout state; a drag to the collapsed size updates the state.
  const sideBarPanel = usePanelRef()
  useEffect(() => {
    const panel = sideBarPanel.current
    if (!panel) return
    if (docked && panel.isCollapsed()) panel.expand()
    if (!docked && !panel.isCollapsed()) panel.collapse()
  }, [docked, sideBarPanel])

  // Escape closes the drawer and gives the focus back to the activity bar.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!drawer) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isDialogKey(event)) return
      setSideBarOpen(false)
      root.current
        ?.querySelector<HTMLElement>('nav [role="tab"][tabindex="0"]')
        ?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawer, setSideBarOpen])

  const editor = useRef<DockviewApi | undefined>(undefined)
  const getEditor = useCallback(() => editor.current, [])
  useEditorShortcuts(platform, getEditor)
  useTabMenuKeys()
  useRegionShortcuts(root, getEditor)
  // Each session opens as a tab once; the last one is the active tab.
  const terminals = props.terminals
  const latestTerminals = useRef(terminals)
  const onEditorReady = useCallback((event: DockviewReadyEvent) => {
    editor.current = event.api
    openWelcome(event)
    openTerminals(event.api, latestTerminals.current ?? [])
  }, [])
  useEffect(() => {
    latestTerminals.current = terminals
    const api = editor.current
    if (api) openTerminals(api, terminals ?? [])
  }, [terminals])

  const activeView =
    views.find((candidate) => candidate.id === view) ?? views[0]
  const explorer = props.explorer
  const hasTree = Boolean(explorer) && (repositories?.length ?? 0) > 0
  // A tree takes the focus itself, so its scroll area is not a second tab stop.
  const contentFocusable = !(view === 'explorer' && hasTree)
  useFocusRescue(root, { sideBarOpen, drawer, view, contentFocusable })
  // While a terminal has the focus, the status bar tells the way out of it.
  const [terminalFocused, setTerminalFocused] = useState(false)
  const sideBarContent = (
    <>
      {view === 'explorer' &&
        (explorer && hasTree ? (
          <ExplorerView
            label="Explorer"
            repositories={repositories ?? []}
            source={explorer}
            defaultExpanded={props.expandedPaths}
            onOpenFile={props.onOpenFile}
          />
        ) : (
          <EmptyState icon={FolderOpen} title="No project open">
            {onOpenFolder && (
              <Button size="sm" onClick={onOpenFolder}>
                Open folder…
              </Button>
            )}
          </EmptyState>
        ))}
      {view === 'search' && (
        <EmptyState icon={Search} title="Nothing to search" />
      )}
    </>
  )
  const sideBar = (
    <SideBar
      platform={platform}
      open={sideBarOpen}
      id={sideBarId}
      title={activeView.label}
      contentFocusable={contentFocusable}
      onWidth={(width) =>
        sideBarPanel.current?.resize(
          {
            narrow: readPixelToken('--vv-sidebar-min-w', 240),
            default: readPixelToken('--vv-sidebar-w', 300),
            wide: readPixelToken('--vv-sidebar-wide-w', 420),
          }[width],
        )
      }
    >
      {sideBarContent}
    </SideBar>
  )

  const sideBarDrawer = drawer && (
    <SideBar
      platform={platform}
      open
      withTopStrip={false}
      id={sideBarId}
      title={activeView.label}
      contentFocusable={contentFocusable}
    >
      {sideBarContent}
    </SideBar>
  )

  return (
    <PageProps.Provider value={{ ...props, onNewProject }}>
      <TooltipProvider delay={600}>
        <div
          ref={root}
          className="relative flex h-full bg-chrome text-foreground"
          data-platform={platform}
          onFocus={(event) =>
            setTerminalFocused(event.target.closest('[data-terminal]') !== null)
          }
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setTerminalFocused(false)
          }}
        >
          <ActivityBar
            platform={platform}
            activities={[...views]}
            activeId={view}
            open={sideBarOpen}
            onSelect={(id) => selectView(id as typeof view)}
            onNavigate={(id) => showView(id as typeof view)}
            panelId={sideBarId}
            footer={
              onOpenSettings && (
                <ActivityAction
                  platform={platform}
                  label="Settings"
                  icon={Settings}
                  shortcut="mod+,"
                  onClick={onOpenSettings}
                />
              )
            }
          />
          {drawer && (
            // The drawer starts under the header row, so that the window buttons stay usable.
            <div
              data-drawer
              className="absolute top-titlebar bottom-0 left-(--vv-activitybar-w) z-30 w-[min(var(--vv-sidebar-w),calc(100%-var(--vv-activitybar-w)))] border-r border-hairline shadow-overlay"
            >
              {sideBarDrawer}
            </div>
          )}
          <div className="flex min-w-0 flex-1">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-w-0 flex-1"
            >
              <ResizablePanel
                panelRef={sideBarPanel}
                disabled={narrow}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  // In a narrow window the panel stays collapsed under the drawer.
                  if (!narrow) setSideBarOpen(size.inPixels > 0)
                }}
                defaultSize={readPixelToken('--vv-sidebar-w', 300)}
                minSize={readPixelToken('--vv-sidebar-min-w', 240)}
                maxSize={readPixelToken('--vv-sidebar-max-w', 560)}
              >
                {!narrow && sideBar}
              </ResizablePanel>
              {/* The line starts at the border of the header row, so that the header row looks like one row. */}
              <ResizableHandle
                // In a narrow window the side bar is a drawer, so the separator does nothing.
                disabled={narrow}
                withHandle={!narrow}
                className="w-px bg-transparent before:absolute before:inset-x-0 before:top-[calc(var(--vv-titlebar-h)-var(--vv-hairline-w))] before:bottom-0 before:bg-hairline before:transition-colors before:delay-(--vv-delay-sash) before:duration-(--vv-duration-fast) after:w-2 data-[separator=active]:before:bg-indicator data-[separator=hover]:before:bg-indicator"
              />
              <ResizablePanel
                className="flex min-w-0 flex-col"
                // The side bar cannot squeeze the editor area below a usable width.
                minSize={
                  narrow ? undefined : readPixelToken('--vv-editor-min-w', 320)
                }
              >
                <TitleBar
                  platform={platform}
                  context={context}
                  windowControls={windowControls}
                  besideWindowButtons={platform === 'macos' && !docked}
                />
                {/* Under the drawer, the editor area and the status bar are inert. */}
                <div inert={drawer} className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1">
                    <EditorArea
                      components={components}
                      onReady={onEditorReady}
                    />
                  </div>
                  <StatusBar
                    start={status?.start}
                    end={
                      terminalFocused
                        ? [terminalKeysHint, ...(status?.end ?? [])]
                        : status?.end
                    }
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
        {onCreateProject && (
          <NewProjectDialog
            open={newProjectOpen}
            onOpenChange={setNewProjectOpen}
            onCreate={onCreateProject}
          />
        )}
      </TooltipProvider>
    </PageProps.Provider>
  )
}

function WelcomePanel() {
  const props = useContext(PageProps)
  if (!props) throw new Error('WelcomePanel renders only inside WorkbenchPage')
  return (
    <Welcome
      platform={props.platform}
      projects={props.projects}
      engineError={props.engineError}
      onNewProject={props.onNewProject}
      onOpenFolder={props.onOpenFolder}
      onAddWorktree={props.onAddWorktree}
      onOpenProject={props.onOpenProject}
      commandPaletteShortcut={props.commandPaletteShortcut}
    />
  )
}

/** The way out of a terminal, which takes the Tab key (WCAG 2.2 SC 2.1.2). */
const terminalKeysHint: StatusItem = {
  id: 'terminal-keys',
  label: 'F6 leaves the terminal',
  icon: Keyboard,
  description:
    'The terminal takes the Tab key. F6 and Shift+F6 move the focus to the other parts of the window.',
}

function TerminalPanel({ params }: IDockviewPanelProps<EditorTabParams>) {
  const props = useContext(PageProps)
  if (!props) throw new Error('TerminalPanel renders only inside WorkbenchPage')
  const session = props.terminals?.find(
    (candidate) => candidate.id === params.sessionId,
  )
  return session ? (
    <TerminalView session={session} platform={props.platform} />
  ) : null
}

/** The content of each panel kind of the editor area. */
const components: Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
> = {
  welcome: WelcomePanel,
  terminal: TerminalPanel,
}

function openTerminals(api: DockviewApi, sessions: TerminalSession[]) {
  for (const session of sessions) {
    const id = `terminal:${session.id}`
    if (api.getPanel(id)) continue
    const params: EditorTabParams = { kind: 'terminal', sessionId: session.id }
    api.addPanel({
      id,
      component: 'terminal',
      title: session.title,
      params,
    })
  }
}

function openWelcome(event: DockviewReadyEvent) {
  const params: EditorTabParams = { kind: 'welcome' }
  event.api.addPanel({
    id: 'welcome',
    component: 'welcome',
    title: 'Welcome',
    params,
  })
}
