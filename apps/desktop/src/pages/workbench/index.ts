export { WorkbenchPage } from './ui/workbench-page'
export { GitStatusMark } from './ui/explorer/git-status-mark'
export type { WelcomeProject } from './ui/welcome/welcome'
export type { StatusItem } from './ui/status-bar/status-bar'
export type { WindowContext } from './ui/title-bar/title-bar'
export {
  entryNodeId,
  repositoryNodeId,
  uniqueRepositories,
  worktreeNodeId,
} from './model/explorer'
export type {
  ChangedItem,
  DirectoryItem,
  ExplorerRepository,
  ExplorerSource,
  GitStatus,
} from './model/explorer'
export type { TerminalSession } from './model/terminal'
export { CodeEditor } from './ui/editor/code-editor'
export type { CodeEditorProps, EditorHandle } from './ui/editor/code-editor'
export { DiffEditor } from './ui/editor/diff-editor'
export type { DiffEditorProps } from './ui/editor/diff-editor'
