import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react'
import { EditorTab } from './editor-tab'

const theme: DockviewTheme = {
  name: 'vvorkflow',
  className: 'dockview-theme-vv',
}

interface EditorAreaProps {
  /** The content of each panel kind, by name. */
  components: Record<string, React.FunctionComponent<IDockviewPanelProps>>
  /** Opens the first panels, after the editor area is ready. */
  onReady: (event: DockviewReadyEvent) => void
}

/**
 * The editor area: groups of tabs that the user can split and dock. Code,
 * terminals, and the Welcome page are all tabs here.
 */
export function EditorArea({ components, onReady }: EditorAreaProps) {
  return (
    <main aria-label="Editor" className="h-full min-h-0 min-w-0">
      <DockviewReact
        className="h-full"
        theme={theme}
        components={components}
        defaultTabComponent={EditorTab}
        onReady={onReady}
      />
    </main>
  )
}
