import { describe, expect, it } from 'vitest'
import {
  rollUpStatus,
  survivingRow,
  toTreeNodes,
  visibleRows,
  type RepositoryGroup,
  type TreeNode,
} from '../src/pages/workbench/model/explorer.ts'

describe('rollUpStatus', () => {
  it('takes the most important status', () => {
    expect(rollUpStatus(['added', 'conflict', 'modified', undefined])).toBe(
      'conflict',
    )
    expect(rollUpStatus(['untracked', 'modified'])).toBe('modified')
  })

  it('is ignored only when every child is ignored', () => {
    expect(rollUpStatus(['ignored', 'ignored'])).toBe('ignored')
    expect(rollUpStatus(['ignored', undefined])).toBeUndefined()
  })

  it('has no status when no child has one', () => {
    expect(rollUpStatus([undefined, undefined])).toBeUndefined()
    expect(rollUpStatus([])).toBeUndefined()
  })
})

const groups: RepositoryGroup[] = [
  {
    id: 'r',
    name: 'repo',
    worktrees: [
      {
        id: 'w',
        branch: 'main',
        path: '~/repo',
        children: [
          {
            kind: 'folder',
            id: 'f',
            name: 'src',
            children: [
              { kind: 'file', id: 'a', name: 'a.ts', status: 'modified' },
            ],
          },
        ],
      },
    ],
  },
]

describe('toTreeNodes and visibleRows', () => {
  it('rolls the status up to the folder and the worktree', () => {
    const [repository] = toTreeNodes(groups)
    const worktree = repository.children![0]
    expect(worktree.status).toBe('modified')
    expect(worktree.children![0].status).toBe('modified')
  })

  it('shows the children of the expanded nodes only, with their level and parent', () => {
    const nodes = toTreeNodes(groups)
    expect(visibleRows(nodes, new Set()).map((row) => row.node.id)).toEqual([
      'r',
    ])
    const rows = visibleRows(nodes, new Set(['r', 'w', 'f']))
    expect(
      rows.map((row) => [
        row.node.id,
        row.level,
        row.parentId,
        row.position,
        row.siblings,
      ]),
    ).toEqual([
      ['r', 1, undefined, 1, 1],
      ['w', 2, 'r', 1, 1],
      ['f', 3, 'w', 1, 1],
      ['a', 4, 'f', 1, 1],
    ])
  })
})

describe('survivingRow', () => {
  const file = (id: string): TreeNode => ({ id, kind: 'file', label: id })
  const tree = (files: string[], open = true) => {
    const nodes: TreeNode[] = [
      {
        id: 'f',
        kind: 'folder',
        label: 'f',
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
