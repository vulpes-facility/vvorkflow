import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanelProps,
} from 'dockview-react'
import {
  FolderOpen,
  Keyboard,
  Plus,
  Search,
  Settings,
  SquareTerminal,
} from 'lucide-react'
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
  IconButton,
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
import { TerminalsView } from './terminals/terminals-view'
import { StatusBar, type StatusItem } from './status-bar/status-bar'
import { TitleBar, type WindowContext } from './title-bar/title-bar'
import { Welcome, type WelcomeProject } from './welcome/welcome'
import { isDialogKey } from '../model/dialog-keys'
import { useLayout } from '../model/layout'
import type { ExplorerRepository, ExplorerSource } from '../model/explorer'
import { HIDDEN_TERMINAL_TIME, type TerminalSession } from '../model/terminal'
import { TerminalActions } from '../model/terminal-actions'
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
  /**
   * The terminal sessions of the engine, such as agents. Each one opens as a
   * tab of the editor area when it first shows here. A tab that the user
   * closes detaches from its session, which stays in the Terminals view. The
   * tab of a session that leaves this list closes.
   */
  terminals?: TerminalSession[]
  /** Starts a terminal session. Without it, the window has no New terminal action. */
  onNewTerminal?: () => void
  /** Ends a terminal session. Without it, a terminal has no Kill action. */
  onKillTerminal?: (id: string) => void
  /**
   * Stops an engine of another version, with its sessions, after the user
   * said yes. The Welcome tab shows the action next to the engine error.
   */
  onStopEngine?: () => void
  onOpenFile?: (id: string) => void
  /**
   * Makes a project with the name that the user gave. When it rejects, the
   * dialog shows the message of the error. The signal aborts when the user
   * closes the dialog before the answer; do not open the project then.
   * Without this handler, the window has no New project action.
   */
  onCreateProject?: (name: string, signal: AbortSignal) => Promise<void>
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
  | (WorkbenchPageProps & {
      onNewProject?: () => void
      /** Starts a terminal session, whose terminal then takes the focus. */
      onNewTerminal?: () => void
      /** Called with each title that the program of a session sets. */
      onTerminalTitle: (id: string, title: string) => void
      /** True once for the session whose terminal takes the focus when it opens. */
      takeTerminalFocus: (id: string) => boolean
    })
  | null
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
  // The user asked for a terminal: the next new session takes the focus.
  // A session that only shows here, as at the start, does not.
  const asked = useRef(false)
  const focusNext = useRef<string | null>(null)
  const propsNewTerminal = props.onNewTerminal
  const askForTerminal = useCallback(() => {
    asked.current = true
    propsNewTerminal?.()
  }, [propsNewTerminal])
  const onNewTerminal = propsNewTerminal ? askForTerminal : undefined
  const takeTerminalFocus = useCallback((id: string) => {
    if (focusNext.current !== id) return false
    focusNext.current = null
    return true
  }, [])
  useActionShortcuts(platform, {
    onNewProject,
    onNewTerminal,
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
  // Each session opens as a tab once, when it first shows; the last one is
  // the active tab. A tab that the user closed stays closed, and the tab of
  // a session that ended closes.
  const terminals = props.terminals
  const latestTerminals = useRef(terminals)
  const shown = useRef(new Set<string>())
  // While a terminal has the focus, the status bar tells the way out of it.
  // The session of that terminal stays known after the terminal is gone,
  // because an element that goes away sends no blur.
  const [terminalFocused, setTerminalFocused] = useState(false)
  const focusedTerminal = useRef<string | null>(null)
  const syncTerminals = useCallback((api: DockviewApi) => {
    const sessions = latestTerminals.current ?? []
    const ids = new Set(sessions.map(({ id }) => id))
    for (const id of shown.current) {
      if (ids.has(id)) continue
      shown.current.delete(id)
      api.getPanel(terminalPanelId(id))?.api.close()
      // The terminal of a session that ended went away with the focus in
      // it: the focus moves to the tab that is active after it, or to the
      // activity bar when no tab is left (WCAG 2.2 SC 2.4.3).
      if (focusedTerminal.current !== id) continue
      focusedTerminal.current = null
      setTerminalFocused(false)
      if (document.activeElement !== document.body) continue
      const next =
        root.current?.querySelector<HTMLElement>(
          '.dv-active-group [role="tab"][aria-selected="true"]',
        ) ??
        root.current?.querySelector<HTMLElement>(
          'nav [role="tab"][tabindex="0"]',
        )
      next?.focus()
    }
    for (const session of sessions) {
      if (shown.current.has(session.id)) continue
      shown.current.add(session.id)
      if (asked.current) {
        asked.current = false
        focusNext.current = session.id
      }
      openTerminal(api, session)
    }
  }, [])
  const onEditorReady = useCallback(
    (event: DockviewReadyEvent) => {
      editor.current = event.api
      openWelcome(event)
      syncTerminals(event.api)
    },
    [syncTerminals],
  )
  useEffect(() => {
    latestTerminals.current = terminals
    const api = editor.current
    if (api) syncTerminals(api)
  }, [terminals, syncTerminals])
  // The titles that the programs set, for the tabs and the Terminals view.
  const [terminalTitles, setTerminalTitles] = useState<Record<string, string>>(
    {},
  )
  const onTerminalTitle = useCallback((id: string, title: string) => {
    setTerminalTitles((titles) =>
      titles[id] === title ? titles : { ...titles, [id]: title },
    )
    editor.current?.getPanel(terminalPanelId(id))?.api.setTitle(title)
  }, [])
  // Shows the tab of a session, and makes it again after the user closed it.
  const showTerminal = useCallback(
    (id: string) => {
      const api = editor.current
      const session = latestTerminals.current?.find(
        (candidate) => candidate.id === id,
      )
      if (!api || !session) return
      const panel = api.getPanel(terminalPanelId(id))
      if (!panel) {
        focusNext.current = id
        openTerminal(api, session, terminalTitles[id])
        return
      }
      panel.api.setActive()
      // The terminal of the tab takes the keys; one that was dropped takes
      // the focus when it opens again.
      const input = panel.view.content.element.querySelector<HTMLElement>(
        '.xterm-helper-textarea',
      )
      if (input) input.focus()
      else focusNext.current = id
    },
    [terminalTitles],
  )

  const activeView =
    views.find((candidate) => candidate.id === view) ?? views[0]
  const explorer = props.explorer
  const hasTree = Boolean(explorer) && (repositories?.length ?? 0) > 0
  // A tree takes the focus itself, so its scroll area is not a second tab stop.
  const hasTerminals = (terminals?.length ?? 0) > 0
  const contentFocusable = !(
    (view === 'explorer' && hasTree) ||
    (view === 'terminals' && hasTerminals)
  )
  useFocusRescue(root, { sideBarOpen, drawer, view, contentFocusable })
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
      {view === 'terminals' &&
        (hasTerminals ? (
          <TerminalsView
            sessions={(terminals ?? []).map(({ id, title, folder }) => ({
              id,
              title: terminalTitles[id] ?? title,
              folder,
            }))}
            onOpen={showTerminal}
            onKill={props.onKillTerminal}
          />
        ) : (
          <EmptyState icon={SquareTerminal} title="No terminals">
            {propsNewTerminal && (
              <Button size="sm" onClick={askForTerminal}>
                New terminal
              </Button>
            )}
          </EmptyState>
        ))}
    </>
  )
  // The actions of the view, at the right of its title.
  const sideBarActions = view === 'terminals' &&
    hasTerminals &&
    propsNewTerminal && (
      <IconButton icon={Plus} label="New terminal" onClick={askForTerminal} />
    )
  const sideBar = (
    <SideBar
      platform={platform}
      open={sideBarOpen}
      id={sideBarId}
      title={activeView.label}
      contentFocusable={contentFocusable}
      actions={sideBarActions}
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
      actions={sideBarActions}
    >
      {sideBarContent}
    </SideBar>
  )

  return (
    <PageProps.Provider
      value={{
        ...props,
        onNewProject,
        onNewTerminal,
        onTerminalTitle,
        takeTerminalFocus,
      }}
    >
      <TerminalActions.Provider value={{ kill: props.onKillTerminal }}>
        <TooltipProvider delay={600}>
          <div
            ref={root}
            className="relative flex h-full bg-chrome text-foreground"
            data-platform={platform}
            onFocus={(event) => {
              const terminal = event.target.closest('[data-terminal]')
              focusedTerminal.current =
                terminal?.getAttribute('data-terminal') ?? null
              setTerminalFocused(terminal !== null)
            }}
            onBlur={(event) => {
              // A focus that goes to another window keeps its terminal.
              if (event.relatedTarget) focusedTerminal.current = null
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
                    narrow
                      ? undefined
                      : readPixelToken('--vv-editor-min-w', 320)
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
      </TerminalActions.Provider>
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
      onNewTerminal={props.onNewTerminal}
      onStopEngine={props.onStopEngine}
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

/**
 * The panel of a terminal session. A tab that is hidden for 5 minutes drops
 * its terminal and detaches from the session; the terminal comes back, with
 * the screen of the session, when the tab shows again.
 */
function TerminalPanel({ api, params }: IDockviewPanelProps<EditorTabParams>) {
  const props = useContext(PageProps)
  if (!props) throw new Error('TerminalPanel renders only inside WorkbenchPage')
  const [kept, setKept] = useState(true)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function follow(visible: boolean) {
      clearTimeout(timer)
      if (visible) setKept(true)
      else timer = setTimeout(() => setKept(false), HIDDEN_TERMINAL_TIME)
    }
    follow(api.isVisible)
    const subscription = api.onDidVisibilityChange((event) =>
      follow(event.isVisible),
    )
    return () => {
      clearTimeout(timer)
      subscription.dispose()
    }
  }, [api])
  const session = props.terminals?.find(
    (candidate) => candidate.id === params.sessionId,
  )
  const { onTerminalTitle, takeTerminalFocus } = props
  const sessionId = session?.id
  const onTitle = useCallback(
    (title: string) => {
      if (sessionId) onTerminalTitle(sessionId, title)
    },
    [sessionId, onTerminalTitle],
  )
  return session && kept ? (
    <TerminalView
      session={session}
      platform={props.platform}
      onTitle={onTitle}
      takesFocus={() => takeTerminalFocus(session.id)}
    />
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

const terminalPanelId = (session: string) => `terminal:${session}`

/** Opens the tab of a session, as the active tab. */
function openTerminal(
  api: DockviewApi,
  session: TerminalSession,
  title = session.title,
) {
  const id = terminalPanelId(session.id)
  if (api.getPanel(id)) return
  const params: EditorTabParams = { kind: 'terminal', sessionId: session.id }
  api.addPanel({ id, component: 'terminal', title, params })
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
