import { describe, expect, it } from 'vitest'
import {
  buildTree,
  entryNodeId,
  pathStatus,
  repositoryNodeId,
  worktreeNodeId,
  survivingRow,
  visibleRows,
  type ChangedItem,
  type DirectoryItem,
  type ExplorerRepository,
  type TreeNode,
} from '../src/pages/workbench/model/explorer.ts'

describe('pathStatus', () => {
  const changes: ChangedItem[] = [
    { path: 'src/a.ts', status: 'modified' },
    { path: 'src/deep/b.ts', status: 'conflict' },
    { path: 'src/new.ts', status: 'added' },
    { path: 'scratch/', status: 'untracked' },
    { path: 'dist/', status: 'ignored' },
    { path: 'src/cache.log', status: 'ignored' },
  ]

  it('gives a file its own status, and no status without a change', () => {
    expect(pathStatus(changes, 'src/a.ts', false)).toBe('modified')
    expect(pathStatus(changes, 'src/b.ts', false)).toBeUndefined()
  })

  it('gives a folder the most important status in it, without the ignored paths', () => {
    expect(pathStatus(changes, 'src', true)).toBe('conflict')
    expect(pathStatus(changes, 'src/deep', true)).toBe('conflict')
    expect(pathStatus(changes, '', true)).toBe('conflict')
    expect(pathStatus([{ path: 'x.log', status: 'ignored' }], '', true)).toBe(
      undefined,
    )
  })

  it('gives a folder that git reports as a whole, and each path in it, its status', () => {
    expect(pathStatus(changes, 'dist', true)).toBe('ignored')
    expect(pathStatus(changes, 'dist/index.js', false)).toBe('ignored')
    expect(pathStatus(changes, 'scratch/notes', true)).toBe('untracked')
    expect(pathStatus(changes, 'scratch/a.md', false)).toBe('untracked')
  })

  it('gives a folder the status that git reports at its own path, as for a submodule', () => {
    const submodule: ChangedItem[] = [
      { path: 'vendor/library', status: 'modified' },
    ]
    expect(pathStatus(submodule, 'vendor/library', true)).toBe('modified')
    expect(pathStatus(submodule, 'vendor', true)).toBe('modified')
  })

  it('lets a change in a folder that git reports as a whole win over that folder', () => {
    for (const whole of ['untracked', 'ignored'] as const) {
      const removed: ChangedItem[] = [
        { path: 'dir/file', status: 'deleted' },
        { path: 'dir/', status: whole },
      ]
      expect(pathStatus(removed, 'dir', true)).toBe('deleted')
      expect(pathStatus(removed, 'dir/file', false)).toBe('deleted')
      expect(pathStatus(removed, 'dir/other', false)).toBe(whole)
      expect(pathStatus(removed, '', true)).toBe('deleted')
    }
  })

  it('has no status before the status is read', () => {
    expect(pathStatus(undefined, 'src', true)).toBeUndefined()
  })
})

describe('buildTree', () => {
  const repositories: ExplorerRepository[] = [
    {
      name: 'app',
      git: true,
      worktrees: [{ path: '/code/app', branch: 'main', current: true }],
    },
  ]
  const folders: Record<string, DirectoryItem[]> = {
    '': [
      { name: 'src', kind: 'folder' },
      { name: 'empty', kind: 'folder' },
      { name: 'node_modules', kind: 'folder' },
      { name: 'README.md', kind: 'file' },
    ],
    src: [{ name: 'a.ts', kind: 'file' }],
    empty: [],
  }
  const read = (_worktree: string, path: string) => folders[path]
  const status = () => [{ path: 'src/a.ts', status: 'modified' as const }]

  it('reads only the open folders under open folders', () => {
    const { toRead } = buildTree(
      repositories,
      new Set([
        repositoryNodeId(repositories[0]),
        worktreeNodeId('/code/app'),
        entryNodeId('/code/app', 'src'),
      ]),
      () => undefined,
      status,
    )
    // The worktree is read first; its folders come after it is read.
    expect(toRead).toEqual([{ worktree: '/code/app', path: '' }])

    const next = buildTree(
      repositories,
      new Set([
        repositoryNodeId(repositories[0]),
        worktreeNodeId('/code/app'),
        entryNodeId('/code/app', 'src'),
        entryNodeId('/code/app', 'node_modules/x'),
      ]),
      (worktree, path) => (path === '' ? read(worktree, path) : undefined),
      status,
    )
    expect(next.toRead).toEqual([{ worktree: '/code/app', path: 'src' }])
  })

  it('builds the rows with their status, and an empty folder cannot open', () => {
    const { nodes } = buildTree(
      repositories,
      new Set([
        repositoryNodeId(repositories[0]),
        worktreeNodeId('/code/app'),
        entryNodeId('/code/app', 'empty'),
      ]),
      read,
      status,
    )
    const worktree = nodes[0].children![0]
    expect(worktree).toMatchObject({
      id: worktreeNodeId('/code/app'),
      label: 'main',
      status: 'modified',
      current: true,
    })
    expect(
      worktree.children!.map((node) => [
        node.label,
        node.status,
        node.expandable,
      ]),
    ).toEqual([
      ['src', 'modified', true],
      ['empty', undefined, false],
      ['node_modules', undefined, true],
      ['README.md', undefined, false],
    ])
  })
})

describe('the ids of the rows', () => {
  it('differ for a folder and a nested repository at the same path', () => {
    const outer: ExplorerRepository = {
      name: 'app',
      git: true,
      worktrees: [{ path: '/code/app', current: true }],
    }
    const nested: ExplorerRepository = {
      name: 'nested',
      git: true,
      worktrees: [{ path: '/code/app/nested', current: true }],
    }
    const expanded = new Set([
      repositoryNodeId(outer),
      worktreeNodeId('/code/app'),
      repositoryNodeId(nested),
      worktreeNodeId('/code/app/nested'),
    ])
    const { nodes } = buildTree(
      [outer, nested],
      expanded,
      (worktree, path) =>
        worktree === '/code/app' && path === ''
          ? [{ name: 'nested', kind: 'folder' }]
          : [],
      () => [],
    )
    const ids = visibleRows(nodes, expanded).map((row) => row.node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('survivingRow', () => {
  const file = (id: string): TreeNode => ({
    id,
    kind: 'file',
    label: id,
    expandable: false,
  })
  const tree = (files: string[], open = true) => {
    const nodes: TreeNode[] = [
      {
        id: 'f',
        kind: 'folder',
        label: 'f',
        expandable: files.length > 0,
        children: files.map(file),
      },
      file('z'),
    ]
    return visibleRows(nodes, new Set(open ? ['f'] : []))
  }

  it('takes the next sibling, or else the previous one', () => {
    expect(survivingRow(tree(['a', 'b', 'c']), tree(['a', 'c']), 'b')).toBe('c')
    expect(survivingRow(tree(['a', 'b', 'c']), tree(['a', 'b']), 'c')).toBe('b')
  })

  it('takes the parent when no sibling is visible', () => {
    expect(survivingRow(tree(['a']), tree([]), 'a')).toBe('f')
    expect(survivingRow(tree(['a', 'b']), tree(['a', 'b'], false), 'b')).toBe(
      'f',
    )
  })

  it('takes the row at the same place when no relative is left', () => {
    const previous = visibleRows([file('x'), file('y')], new Set())
    expect(survivingRow(previous, visibleRows([], new Set()), 'x')).toBe(
      undefined,
    )
    expect(
      survivingRow(previous, visibleRows([file('q')], new Set()), 'y'),
    ).toBe('q')
  })
})

describe('the label of a worktree without a branch', () => {
  it('is the name of its folder, with either separator', () => {
    for (const path of ['/code/notes', 'C:\\code\\notes']) {
      const { nodes } = buildTree(
        [{ name: 'notes', git: false, worktrees: [{ path, current: true }] }],
        new Set([
          repositoryNodeId({
            name: 'notes',
            git: false,
            worktrees: [{ path }],
          }),
        ]),
        () => [],
        () => undefined,
      )
      expect(nodes[0].children![0].label).toBe('notes')
    }
  })
})
