import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { protocol } from './protocol.gen.ts'

// The types come from `protocol.gen.ts`, which `pnpm generate:protocol` makes
// from the JSON Schema of the Rust crate `vvorkflow-protocol`.
const types = protocol.shape

export type Repository = z.infer<typeof types.repository>
export type DirectoryEntry = z.infer<typeof types.directory_entry>
export type ChangedPath = z.infer<typeof types.changed_path>
export type EngineErrorCode = z.infer<typeof types.engine_error>['code']

/** A request that the engine refused or could not do. */
export class EngineRequestError extends Error {
  readonly code: EngineErrorCode | 'invalidResponse'

  constructor(code: EngineErrorCode | 'invalidResponse', message: string) {
    super(message)
    this.name = 'EngineRequestError'
    this.code = code
  }
}

/**
 * Sends one request to the engine, and parses its answer, because a value
 * from another process can be wrong (the type alone does not check it).
 *
 * @throws {EngineRequestError} With the code of the engine, or with
 *   `invalidResponse` when the answer does not match the protocol.
 */
async function request<T>(
  command: string,
  body: unknown,
  answer: z.ZodType<T>,
): Promise<T> {
  let value: unknown
  try {
    value = await invoke(command, { request: body })
  } catch (thrown) {
    const refused = types.engine_error.safeParse(thrown)
    if (refused.success)
      throw new EngineRequestError(refused.data.code, refused.data.message)
    throw new EngineRequestError('invalidResponse', String(thrown))
  }
  const parsed = answer.safeParse(value)
  if (!parsed.success)
    throw new EngineRequestError('invalidResponse', parsed.error.message)
  return parsed.data
}

/**
 * Opens a folder in the engine. After it, the requests can reach the folder
 * and each worktree of its repository.
 *
 * @returns The repository and its worktrees; a plain folder has `git: false`.
 */
export function openFolder(path: string): Promise<Repository> {
  return request('open_folder', { path }, types.repository)
}

/**
 * Lists one folder of an open worktree: the folders first, then the files.
 *
 * @param path The folder relative to the worktree; empty for the worktree.
 */
export function listDirectory(
  worktree: string,
  path: string,
): Promise<DirectoryEntry[]> {
  return request(
    'list_directory',
    { worktree, path },
    types.directory_entry.array(),
  )
}

/**
 * Reads the git status of an open worktree.
 *
 * @returns Each changed path; an ignored or untracked folder ends with `/`.
 */
export function readStatus(worktree: string): Promise<ChangedPath[]> {
  return request('read_status', { worktree }, types.changed_path.array())
}

/**
 * The folders that the app opens at start: the paths of its command line.
 *
 * @returns Absolute paths, or none.
 */
export async function startupFolders(): Promise<string[]> {
  const parsed = z.array(z.string()).safeParse(await invoke('startup_folders'))
  if (!parsed.success)
    throw new EngineRequestError('invalidResponse', parsed.error.message)
  return parsed.data
}
