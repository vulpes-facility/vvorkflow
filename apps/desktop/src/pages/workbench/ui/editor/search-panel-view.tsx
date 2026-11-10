import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import { runScopeHandlers, type EditorView } from '@codemirror/view'
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { countText, type MatchCount } from './search-count'
import { cn, type Platform } from '@/shared/lib'
import {
  ErrorMark,
  Input,
  Shortcut,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/ui'

/** The message of a regular expression that does not compile, or undefined. */
function regexpError(query: SearchQuery): string | undefined {
  if (!query.regexp || !query.search) return undefined
  try {
    new RegExp(query.search)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'Not a valid expression'
  }
}

interface PanelButtonProps {
  label: string
  /** A shortcut such as `shift+Enter`, for the tooltip. */
  shortcut?: string
  platform: Platform
  pressed?: boolean
  expanded?: boolean
  onClick: () => void
  children: ReactNode
}

/**
 * An icon button of the panel: 24 by 24 pixels, a name and a tooltip, and a
 * pressed state that has a surface and a border and not only a color.
 */
function PanelButton({
  label,
  shortcut,
  platform,
  pressed,
  expanded,
  onClick,
  children,
}: PanelButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            aria-expanded={expanded}
            onClick={onClick}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-chrome-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
              'aria-pressed:border-foreground aria-pressed:bg-selection aria-pressed:text-foreground',
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut && <Shortcut keys={shortcut} platform={platform} />}
      </TooltipContent>
    </Tooltip>
  )
}

const fieldClass =
  'h-6 min-w-0 basis-24 flex-1 rounded-md bg-editor px-2 py-0 text-ui'

/** The props of the search panel. */
export interface SearchPanelViewProps {
  view: EditorView
  platform: Platform
  /** The count of the matches, which the panel measures when the document or the selection changes. */
  count: MatchCount
}

/** The rows of the search panel. */
export function SearchPanelView({
  view,
  platform,
  count,
}: SearchPanelViewProps) {
  const query = getSearchQuery(view.state)
  const readOnly = view.state.readOnly
  const [replaceOpen, setReplaceOpen] = useState(false)
  const showReplace = replaceOpen && !readOnly
  const error = regexpError(query)

  // A field keeps its own text while the user types, and takes the query
  // when the query changes from outside, such as when the panel opens.
  const [search, setSearch] = useState(query.search)
  const [seenSearch, setSeenSearch] = useState(query.search)
  if (query.search !== seenSearch) {
    setSeenSearch(query.search)
    setSearch(query.search)
  }
  const [replace, setReplace] = useState(query.replace)
  const [seenReplace, setSeenReplace] = useState(query.replace)
  if (query.replace !== seenReplace) {
    setSeenReplace(query.replace)
    setReplace(query.replace)
  }

  function commit(
    patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>,
  ) {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: query.search,
          caseSensitive: query.caseSensitive,
          regexp: query.regexp,
          wholeWord: query.wholeWord,
          literal: query.literal,
          replace: query.replace,
          ...patch,
        }),
      ),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // The keys of the search scope: Escape, mod+F, F3, and mod+G.
    if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) {
      event.preventDefault()
      return
    }
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement))
      return
    event.preventDefault()
    if (event.target.name === 'replace') replaceNext(view)
    else (event.shiftKey ? findPrevious : findNext)(view)
  }

  const text = countText(count)
  return (
    <TooltipProvider>
      <div
        className="flex flex-col gap-1 p-1 text-ui text-chrome-foreground"
        onKeyDown={onKeyDown}
      >
        <div className="flex flex-wrap items-center gap-1">
          {!readOnly && (
            <PanelButton
              label="Show replace"
              platform={platform}
              expanded={replaceOpen}
              onClick={() => setReplaceOpen(!replaceOpen)}
            >
              {replaceOpen ? (
                <ChevronDown className="size-icon" aria-hidden />
              ) : (
                <ChevronRight className="size-icon" aria-hidden />
              )}
            </PanelButton>
          )}
          <Input
            name="search"
            aria-label="Find"
            placeholder="Find"
            main-field="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'search-error' : undefined}
            value={search}
            className={fieldClass}
            onChange={(event) => {
              setSearch(event.target.value)
              commit({ search: event.target.value })
            }}
          />
          {error && (
            <ErrorMark
              label="Expression error"
              message={error}
              messageId="search-error"
            />
          )}
          <span
            aria-live="polite"
            className="min-w-12 text-xs text-muted-foreground tabular-nums"
          >
            {text}
          </span>
          <PanelButton
            label="Previous match"
            shortcut="shift+Enter"
            platform={platform}
            onClick={() => findPrevious(view)}
          >
            <ChevronUp className="size-icon" aria-hidden />
          </PanelButton>
          <PanelButton
            label="Next match"
            shortcut="Enter"
            platform={platform}
            onClick={() => findNext(view)}
          >
            <ChevronDown className="size-icon" aria-hidden />
          </PanelButton>
          <PanelButton
            label="Match case"
            platform={platform}
            pressed={query.caseSensitive}
            onClick={() => commit({ caseSensitive: !query.caseSensitive })}
          >
            <CaseSensitive className="size-icon" aria-hidden />
          </PanelButton>
          <PanelButton
            label="Whole word"
            platform={platform}
            pressed={query.wholeWord}
            onClick={() => commit({ wholeWord: !query.wholeWord })}
          >
            <WholeWord className="size-icon" aria-hidden />
          </PanelButton>
          <PanelButton
            label="Regular expression"
            platform={platform}
            pressed={query.regexp}
            onClick={() => commit({ regexp: !query.regexp })}
          >
            <Regex className="size-icon" aria-hidden />
          </PanelButton>
          <span className="ml-auto" />
          <PanelButton
            label="Close"
            shortcut="Escape"
            platform={platform}
            onClick={() => closeSearchPanel(view)}
          >
            <X className="size-icon" aria-hidden />
          </PanelButton>
        </div>
        {showReplace && (
          <div className="flex flex-wrap items-center gap-1 pl-7">
            <Input
              name="replace"
              aria-label="Replace"
              placeholder="Replace"
              value={replace}
              className={fieldClass}
              onChange={(event) => {
                setReplace(event.target.value)
                commit({ replace: event.target.value })
              }}
            />
            <PanelButton
              label="Replace"
              shortcut="Enter"
              platform={platform}
              onClick={() => replaceNext(view)}
            >
              <Replace className="size-icon" aria-hidden />
            </PanelButton>
            <PanelButton
              label="Replace all"
              platform={platform}
              onClick={() => replaceAll(view)}
            >
              <ReplaceAll className="size-icon" aria-hidden />
            </PanelButton>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
