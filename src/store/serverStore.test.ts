import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('serverStore clock calibration', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives calibrated now from a server timestamp and monotonic time', async () => {
    const { serverStore } = await import('./serverStore')
    const serverTimestamp = Date.parse('2026-04-22T15:00:00.000Z')
    const perfSpy = vi.spyOn(performance, 'now')

    perfSpy.mockReturnValueOnce(1_000)
    expect(
      serverStore.applyServerConnectedTimestamp(
        serverStore.getActiveServerId(),
        new Date(serverTimestamp).toISOString(),
      ),
    ).toBe(true)

    perfSpy.mockReturnValue(1_750)
    expect(serverStore.getActiveCalibratedNow()).toBe(serverTimestamp + 750)
  })

  it('ignores malformed timestamps', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.applyServerConnectedTimestamp(serverStore.getActiveServerId(), 'not-a-date')).toBe(false)
    expect(serverStore.getActiveCalibratedNow()).toBeUndefined()
  })

  it('does not reuse calibration after switching to another server without calibration', async () => {
    const { serverStore } = await import('./serverStore')
    const perfSpy = vi.spyOn(performance, 'now')

    perfSpy.mockReturnValue(500)
    serverStore.applyServerConnectedTimestamp(serverStore.getActiveServerId(), '2026-04-22T15:00:00.000Z')

    const remote = serverStore.addServer({
      name: 'Remote',
      url: 'http://remote.test',
    })
    serverStore.setActiveServer(remote.id)

    expect(serverStore.getActiveCalibratedNow()).toBeUndefined()
  })
})

describe('serverStore local runtime URL', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('uses the detected local service URL without persisting it as the configured URL', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:4096')

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231/')).toBe(true)

    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:58231')
    expect(serverStore.getLocalServerUrl()).toBe('http://127.0.0.1:58231')
    expect(serverStore.getStoredServers().find(server => server.id === 'local')?.url).toBe('http://127.0.0.1:4096')
  })

  it('notifies listeners when the active local runtime URL changes', async () => {
    const { serverStore } = await import('./serverStore')
    const listener = vi.fn()
    serverStore.onServerChange(listener)

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231')).toBe(true)

    expect(listener).toHaveBeenCalledWith('local', 'local-runtime-url')
  })

  it('does not notify active endpoint listeners when local URL changes while remote is active', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })
    const listener = vi.fn()

    serverStore.setActiveServer(remote.id)
    listener.mockClear()
    serverStore.onServerChange(listener)

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231')).toBe(true)

    expect(serverStore.getActiveBaseUrl()).toBe('http://remote.test')
    expect(listener).not.toHaveBeenCalled()
  })
})
