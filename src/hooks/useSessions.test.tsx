import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessions } from './useSessions'

const getSessionsMock = vi.fn()
const createSessionMock = vi.fn()
const deleteSessionMock = vi.fn()

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
}))

function makeSession(id: string, directory = '/workspace/demo') {
  return {
    id,
    projectID: 'project-1',
    directory,
    title: `Session ${id}`,
    time: {
      created: 1,
      updated: 2,
    },
  }
}

describe('useSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    getSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue(makeSession('new'))
    deleteSessionMock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for enabled before fetching', async () => {
    const { rerender } = renderHook(({ enabled }) => useSessions({ directory: '/workspace/demo', enabled }), {
      initialProps: { enabled: false },
    })

    expect(getSessionsMock).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledWith({
      roots: true,
      limit: 20,
      directory: '/workspace/demo',
    })
  })

  it('passes the scoped directory when removing a session', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions).toHaveLength(1)

    await act(async () => {
      await result.current.remove('session-1')
    })

    expect(deleteSessionMock).toHaveBeenCalledWith('session-1', '/workspace/demo')
  })
})
