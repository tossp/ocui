import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_MACOS_FULLSCREEN_HEADER_LEFT_INSET } from '../constants'
import { FullscreenViewer } from './FullscreenViewer'

const { getDesktopPlatformMock, usesCustomDesktopTitlebarMock } = vi.hoisted(() => ({
  getDesktopPlatformMock: vi.fn(() => 'other'),
  usesCustomDesktopTitlebarMock: vi.fn(() => false),
}))

vi.mock('../utils/tauri', () => ({
  getDesktopPlatform: getDesktopPlatformMock,
  usesCustomDesktopTitlebar: usesCustomDesktopTitlebarMock,
}))

describe('FullscreenViewer', () => {
  beforeEach(() => {
    getDesktopPlatformMock.mockReset()
    usesCustomDesktopTitlebarMock.mockReset()
    getDesktopPlatformMock.mockReturnValue('other')
    usesCustomDesktopTitlebarMock.mockReturnValue(false)
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      return window.setTimeout(() => cb(performance.now()), 0)
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps viewer mounted during exit animation', () => {
    const { rerender } = render(
      <FullscreenViewer isOpen={true} onClose={vi.fn()} title="app.ts">
        <div data-testid="content">hello</div>
      </FullscreenViewer>,
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByTestId('content')).toBeInTheDocument()

    rerender(
      <FullscreenViewer isOpen={false} onClose={vi.fn()} title="app.ts">
        <div data-testid="content">hello</div>
      </FullscreenViewer>,
    )

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders without header when showHeader is false', () => {
    render(
      <FullscreenViewer isOpen={true} onClose={vi.fn()} showHeader={false}>
        <div data-testid="content">full custom</div>
      </FullscreenViewer>,
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('content')).toBeInTheDocument()
    // header 不应该存在
    expect(screen.queryByText('closeEsc')).not.toBeInTheDocument()
  })

  it('reserves space for macOS traffic lights in the fullscreen header', () => {
    getDesktopPlatformMock.mockReturnValue('macos')
    usesCustomDesktopTitlebarMock.mockReturnValue(true)

    render(
      <FullscreenViewer isOpen={true} onClose={vi.fn()} title="app.ts">
        <div data-testid="content">hello</div>
      </FullscreenViewer>,
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(screen.getByTestId('fullscreen-viewer-header')).toHaveStyle({
      paddingLeft: `${DESKTOP_MACOS_FULLSCREEN_HEADER_LEFT_INSET}px`,
    })
  })
})
