import { beforeEach, describe, expect, it, vi } from 'vitest'

// The process boundary: the IPC of Tauri.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
const { openFolder, readStatus, EngineRequestError } =
  await import('../src/shared/api/engine.ts')

// A hook that returns a function gets it called as a cleanup, so return nothing.
beforeEach(() => {
  invoke.mockReset()
})

describe('the engine client', () => {
  it('sends the request and returns the parsed answer', async () => {
    const repository = {
      name: 'app',
      git: true,
      worktrees: [{ path: '/code/app', branch: 'main', current: true }],
    }
    invoke.mockResolvedValue(repository)
    await expect(openFolder('/code/app')).resolves.toEqual(repository)
    expect(invoke).toHaveBeenCalledWith('open_folder', {
      request: { path: '/code/app' },
    })
  })

  it('throws the code and the message of a refusal', async () => {
    invoke.mockRejectedValue({
      code: 'permissionDenied',
      message: '/etc is not an open folder.',
    })
    const error = await readStatus('/etc').catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(EngineRequestError)
    const { code, message } = error as InstanceType<typeof EngineRequestError>
    expect({ code, message }).toEqual({
      code: 'permissionDenied',
      message: '/etc is not an open folder.',
    })
  })

  it('refuses an answer that does not match the protocol', async () => {
    invoke.mockResolvedValue([{ path: 'a.ts', status: 'renamed' }])
    const error = await readStatus('/code/app').catch(
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(EngineRequestError)
    expect((error as InstanceType<typeof EngineRequestError>).code).toBe(
      'invalidResponse',
    )
  })
})
