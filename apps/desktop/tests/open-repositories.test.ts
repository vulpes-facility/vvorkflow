import { describe, expect, it } from 'vitest'
import { uniqueRepositories } from '../src/pages/workbench/model/explorer.ts'

const worktree = (path: string, branch: string, current: boolean) => ({
  path,
  branch,
  current,
})

describe('the open repositories', () => {
  it('show a project and its sibling worktree as one group', () => {
    // The project `app` and the folder `app.feature` in the projects root
    // are two worktrees of one repository.
    const fromProject = {
      name: 'app',
      git: true,
      worktrees: [
        worktree('/root/app', 'main', true),
        worktree('/root/app.feature', 'feat/x', false),
      ],
    }
    const fromSibling = {
      ...fromProject,
      worktrees: [
        worktree('/root/app', 'main', false),
        worktree('/root/app.feature', 'feat/x', true),
      ],
    }
    const notes = {
      name: 'notes',
      git: false,
      worktrees: [{ path: '/root/notes', branch: null, current: true }],
    }
    expect(
      uniqueRepositories([fromProject, undefined, notes, fromSibling]),
    ).toEqual([fromProject, notes])
  })
})
