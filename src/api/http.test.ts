import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { buildQueryString } from './http'

// ============================================
// buildQueryString 测试
// ============================================

describe('buildQueryString', () => {
  it('returns empty string for empty params', () => {
    expect(buildQueryString({})).toBe('')
  })

  it('skips undefined values', () => {
    expect(buildQueryString({ a: 'hello', b: undefined })).toBe('?a=hello')
  })

  it('handles string, number, boolean values', () => {
    const result = buildQueryString({ name: 'test', page: 1, active: true })
    expect(result).toBe('?name=test&page=1&active=true')
  })

  it('encodes special characters in values', () => {
    const result = buildQueryString({ directory: 'C:\\Program Files\\app' })
    expect(result).toBe('?directory=C%3A%5CProgram%20Files%5Capp')
  })

  it('encodes special characters in keys', () => {
    const result = buildQueryString({ 'key with spaces': 'value' })
    expect(result).toBe('?key%20with%20spaces=value')
  })

  it('encodes ampersand and equals in values', () => {
    const result = buildQueryString({ q: 'a=1&b=2' })
    expect(result).toBe('?q=a%3D1%26b%3D2')
  })

  it('encodes unicode characters', () => {
    const result = buildQueryString({ path: '/home/用户/project' })
    expect(result).toBe('?path=%2Fhome%2F%E7%94%A8%E6%88%B7%2Fproject')
  })
})

// ============================================
// request timeout 测试
// ============================================

// Mock 底层依赖（不 mock ./http 自身）
vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveBaseUrl: () => 'http://localhost:3000', getActiveAuth: () => null },
  makeBasicAuthHeader: () => '',
}))

// isTauri() → false，让 unifiedFetch 走 globalThis.fetch
vi.mock('../utils/tauri', () => ({ isTauri: () => false }))

describe('request', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it('aborts request after default timeout (30s)', async () => {
    vi.useFakeTimers()

    // fetch 永远不 resolve，模拟网络挂起
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          // 监听 abort 来正确 reject
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    const { request } = await import('./http')
    const promise = request('/test')

    vi.advanceTimersByTime(30_000)

    await expect(promise).rejects.toThrow()
  })

  it('succeeds before timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: 'ok' }), { status: 200 }))

    const { request } = await import('./http')
    const result = await request('/test')
    expect(result).toEqual({ data: 'ok' })
  })

  it('respects custom timeout option', async () => {
    vi.useFakeTimers()

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    const { request } = await import('./http')
    const promise = request('/test', {}, { timeout: 5000 })

    vi.advanceTimersByTime(5000)

    await expect(promise).rejects.toThrow()
  })

  it('passes signal in fetch init', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('"ok"', { status: 200 }))
    globalThis.fetch = fetchSpy

    const { request } = await import('./http')
    await request('/test')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect(init.signal).toBeDefined()
  })

  it('handles 204 No Content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    const { request } = await import('./http')
    const result = await request('/test')
    expect(result).toBeUndefined()
  })

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))

    const { request } = await import('./http')
    await expect(request('/test')).rejects.toThrow('Request failed: 404')
  })
})
