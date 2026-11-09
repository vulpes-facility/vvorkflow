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
import type { EditorTabParams } from './editor-area/editor-tab'
import { SideBar } from './side-bar/side-bar'
import { StatusBar, type StatusItem } from './status-bar/status-bar'
import { TitleBar, type WindowContext } from './title-bar/title-bar'
import { Welcome, type RecentProject } from './welcome/welcome'
import { useLayout } from '../model/layout'
import { useActionShortcuts } from '../model/use-action-shortcuts'
import { useEditorShortcuts } from '../model/use-editor-shortcuts'
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
  /** The content of the Explorer view. Without it, the view shows its empty state. */
  explorer?: React.ReactNode
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
    explorer,
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
  useNarrowWindow(setSideBarOpen)
  useActionShortcuts(platform, {
    onNewProject: props.onNewProject,
    onOpenFolder: props.onOpenFolder,
    onOpenSettings,
  })

  // The panel follows the layout state; a drag to the collapsed size updates the state.
  const sideBarPanel = usePanelRef()
  useEffect(() => {
    const panel = sideBarPanel.current
    if (!panel) return
    if (sideBarOpen && panel.isCollapsed()) panel.expand()
    if (!sideBarOpen && !panel.isCollapsed()) panel.collapse()
  }, [sideBarOpen, sideBarPanel])

  const editor = useRef<DockviewApi | undefined>(undefined)
  const getEditor = useCallback(() => editor.current, [])
  useEditorShortcuts(platform, getEditor)
  const onEditorReady = useCallback((event: DockviewReadyEvent) => {
    editor.current = event.api
    openWelcome(event)
  }, [])

  const activeView =
    views.find((candidate) => candidate.id === view) ?? views[0]
  return (
    <PageProps.Provider value={props}>
      <TooltipProvider delay={600}>
        <div
          className="flex h-full bg-chrome text-foreground"
          data-platform={platform}
        >
          <ActivityBar
            platform={platform}
            activities={[...views]}
            activeId={view}
            onSelect={(id) => selectView(id as typeof view)}
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
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-w-0 flex-1"
          >
            <ResizablePanel
              panelRef={sideBarPanel}
              collapsible
              collapsedSize={0}
              onResize={(size) => setSideBarOpen(size.inPixels > 0)}
              defaultSize={readPixelToken('--vv-sidebar-w', 300)}
              minSize={readPixelToken('--vv-sidebar-min-w', 240)}
              maxSize={readPixelToken('--vv-sidebar-max-w', 560)}
            >
              <SideBar
                platform={platform}
                open={sideBarOpen}
                id={sideBarId}
                title={activeView.label}
              >
                {view === 'explorer' &&
                  (explorer ?? (
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
              </SideBar>
            </ResizablePanel>
            {/* The line starts at the border of the header row, so that the header row looks like one row. */}
            <ResizableHandle className="w-px bg-transparent before:absolute before:inset-x-0 before:top-[calc(var(--vv-titlebar-h)-1px)] before:bottom-0 before:bg-hairline before:transition-colors before:delay-300 before:duration-150 after:w-2 data-[separator=active]:before:bg-indicator data-[separator=hover]:before:bg-indicator" />
            <ResizablePanel className="flex min-w-0 flex-col">
              <TitleBar
                platform={platform}
                context={context}
                windowControls={windowControls}
                besideWindowButtons={platform === 'macos' && !sideBarOpen}
              />
              <div className="min-h-0 flex-1">
                <EditorArea components={components} onReady={onEditorReady} />
              </div>
              <StatusBar start={status?.start} end={status?.end} />
            </ResizablePanel>
          </ResizablePanelGroup>
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
