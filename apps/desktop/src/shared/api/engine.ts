import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { protocol } from './protocol.gen.ts'

// The types come from `protocol.gen.ts`, which `pnpm generate:protocol` makes
// from the JSON Schema of the Rust crate `vvorkflow-protocol`.
const types = protocol.shape

/** The protocol version of this client, which `hello` sends to the engine. */
export const PROTOCOL_VERSION = 1

/**
 * The params and the value of each method of the engine. The generator types
 * the request union as `any`, so this map gives the types, and a test checks
 * that its methods are those of the schema.
 */
export const methods = {
  hello: { params: types.hello, result: types.welcome },
  'project.list': {
    params: types.list_projects,
    result: types.project.array(),
  },
  'folder.open': { params: types.open_folder, result: types.repository },
  'directory.list': {
    params: types.list_directory,
    result: types.directory_entry.array(),
  },
  'git.status': {
    params: types.read_status,
    result: types.changed_path.array(),
  },
  shutdown: { params: types.shutdown, result: types.done },
} as const

type Method = keyof typeof methods

export type Welcome = z.infer<typeof types.welcome>
export type Project = z.infer<typeof types.project>
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
 * Sends one request to the engine, and parses its value, because a value
 * from another process can be wrong (the type alone does not check it).
 *
 * @throws {EngineRequestError} With the code of the engine, or with
 *   `invalidResponse` when the value does not match the protocol.
 */
async function request<M extends Method>(
  method: M,
  params: z.input<(typeof methods)[M]['params']>,
): Promise<z.output<(typeof methods)[M]['result']>> {
  let value: unknown
  try {
    value = await invoke('request', { request: { method, params } })
  } catch (thrown) {
    const refused = types.engine_error.safeParse(thrown)
    if (refused.success)
      throw new EngineRequestError(refused.data.code, refused.data.message)
    throw new EngineRequestError('invalidResponse', String(thrown))
  }
  const parsed = methods[method].result.safeParse(value)
  if (!parsed.success)
    throw new EngineRequestError('invalidResponse', parsed.error.message)
  return parsed.data as z.output<(typeof methods)[M]['result']>
}

/**
 * Starts the connection: the engine checks the protocol version of the app.
 *
 * @returns The protocol version and the projects root. Throws
 *   `failedPrecondition` when the engine uses another protocol, or did not
 *   start, for example because the projects root is not a folder.
 */
export function hello(): Promise<Welcome> {
  return request('hello', { protocol: PROTOCOL_VERSION })
}

/**
 * Lists the projects: the folders directly in the projects root.
 *
 * @returns The projects in name order; `git` tells if a project has a `.git`
 *   entry.
 */
export function listProjects(): Promise<Project[]> {
  return request('project.list', {})
}

/**
 * Opens a folder in the engine. After it, the requests can reach the folder
 * and each worktree of its repository.
 *
 * @returns The repository and its worktrees; a plain folder has `git: false`.
 */
export function openFolder(path: string): Promise<Repository> {
  return request('folder.open', { path })
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
  return request('directory.list', { worktree, path })
}

/**
 * Reads the git status of an open worktree.
 *
 * @returns Each changed path; an ignored or untracked folder ends with `/`.
 */
export function readStatus(worktree: string): Promise<ChangedPath[]> {
  return request('git.status', { worktree })
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
