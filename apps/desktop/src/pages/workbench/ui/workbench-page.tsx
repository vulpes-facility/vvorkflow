import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanelProps,
} from 'dockview-react'
import { FolderOpen, Search, Settings, Workflow } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { ExplorerTree } from './explorer/explorer-tree'
import type { EditorTabParams } from './editor-area/editor-tab'
import { SideBar } from './side-bar/side-bar'
import { StatusBar, type StatusItem } from './status-bar/status-bar'
import { TitleBar, type WindowContext } from './title-bar/title-bar'
import { Welcome, type RecentProject } from './welcome/welcome'
import { useLayout } from '../model/layout'
import { toTreeNodes, type RepositoryGroup } from '../model/explorer'
import { useActionShortcuts } from '../model/use-action-shortcuts'
import { useEditorShortcuts } from '../model/use-editor-shortcuts'
import { useFocusRescue } from '../model/use-focus-rescue'
import { useNarrowWindow } from '../model/use-narrow-window'
import { useViewShortcuts } from '../model/use-view-shortcuts'
import { views } from '../model/views'

const sideBarId = 'workbench-side-bar'

interface WorkbenchPageProps {
  platform: Platform
  /** The native window. Without it, as in a browser, the title bar has no window buttons. */
  windowControls?: WindowControls
  /** The project and the worktree in the title bar. */
  context?: WindowContext
  recentProjects: RecentProject[]
  status?: { start?: StatusItem[]; end?: StatusItem[] }
  /** The repositories and worktrees of the Explorer. Without them, the view shows its empty state. */
  repositories?: RepositoryGroup[]
  /** The worktree and folder ids that the Explorer shows open at the start. */
  expandedPaths?: string[]
  onOpenFile?: (id: string) => void
  onNewProject?: () => void
  onOpenFolder?: () => void
  onAddWorktree?: () => void
  onOpenRecent?: (project: RecentProject) => void
  onOpenSettings?: () => void
  /** The shortcut of the command palette, for the hint on the Welcome tab. */
  commandPaletteShortcut?: string
}

/** The props of the page, for the panels of the editor area, which dockview renders. */
const PageProps = createContext<WorkbenchPageProps | null>(null)

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
    onOpenFolder,
    onOpenSettings,
  } = props
  const view = useLayout((state) => state.view)
  const sideBarOpen = useLayout((state) => state.sideBarOpen)
  const showView = useLayout((state) => state.showView)
  const selectView = useLayout((state) => state.selectView)
  const setSideBarOpen = useLayout((state) => state.setSideBarOpen)
  const toggleSideBar = useLayout((state) => state.toggleSideBar)
  useViewShortcuts(platform, showView, toggleSideBar)
  const narrow = useNarrowWindow(setSideBarOpen)
  useActionShortcuts(platform, {
    onNewProject: props.onNewProject,
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
      if (event.key !== 'Escape') return
      setSideBarOpen(false)
      root.current
        ?.querySelector<HTMLElement>('nav [role="tab"][tabindex="0"]')
        ?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawer, setSideBarOpen])
  useFocusRescue(root, sideBarOpen, drawer, view)

  const editor = useRef<DockviewApi | undefined>(undefined)
  const getEditor = useCallback(() => editor.current, [])
  useEditorShortcuts(platform, getEditor)
  const onEditorReady = useCallback((event: DockviewReadyEvent) => {
    editor.current = event.api
    openWelcome(event)
  }, [])

  const activeView =
    views.find((candidate) => candidate.id === view) ?? views[0]
  const treeNodes = useMemo(
    () => toTreeNodes(repositories ?? []),
    [repositories],
  )
  const hasTree = treeNodes.length > 0
  // A tree takes the focus itself, so its scroll area is not a second tab stop.
  const contentFocusable = !(view === 'explorer' && hasTree)
  const sideBarContent = (
    <>
      {view === 'explorer' &&
        (hasTree ? (
          <ExplorerTree
            label="Explorer"
            nodes={treeNodes}
            defaultExpanded={props.expandedPaths}
            onOpenFile={props.onOpenFile}
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="No project open"
            description="Open a folder to see its worktrees and files."
          >
            {onOpenFolder && (
              <Button size="sm" onClick={onOpenFolder}>
                Open folder…
              </Button>
            )}
          </EmptyState>
        ))}
      {view === 'search' && (
        <EmptyState
          icon={Search}
          title="Nothing to search"
          description="Open a project to search its files."
        />
      )}
      {view === 'graphs' && (
        <EmptyState
          icon={Workflow}
          title="No agent graphs"
          description="Open a project to see its agent graphs."
        />
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
    <PageProps.Provider value={props}>
      <TooltipProvider delay={600}>
        <div
          ref={root}
          className="relative flex h-full bg-chrome text-foreground"
          data-platform={platform}
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
                  <StatusBar start={status?.start} end={status?.end} />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
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
      recentProjects={props.recentProjects}
      onNewProject={props.onNewProject}
      onOpenFolder={props.onOpenFolder}
      onAddWorktree={props.onAddWorktree}
      onOpenRecent={props.onOpenRecent}
      commandPaletteShortcut={props.commandPaletteShortcut}
    />
  )
}

/** The content of each panel kind of the editor area. */
const components: Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
> = {
  welcome: WelcomePanel,
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
