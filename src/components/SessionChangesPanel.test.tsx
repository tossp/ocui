import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionChangesPanel } from './SessionChangesPanel'

const { getCurrentProject, initGitProject, getSessionDiff, getLastTurnDiff, getVcsInfo, getVcsDiff } = vi.hoisted(
  () => ({
    getCurrentProject: vi.fn(),
    initGitProject: vi.fn(),
    getSessionDiff: vi.fn(),
    getLastTurnDiff: vi.fn(),
    getVcsInfo: vi.fn(),
    getVcsDiff: vi.fn(),
  }),
)

vi.mock('../api/client', () => ({
  getCurrentProject,
  initGitProject,
}))

vi.mock('../api/vcs', () => ({
  getVcsInfo,
  getVcsDiff,
}))

vi.mock('../api/session', () => ({
  getSessionDiff,
  getLastTurnDiff,
}))

vi.mock('./DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer">diff viewer</div>,
}))

describe('SessionChangesPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
    getCurrentProject.mockResolvedValue({
      id: 'project-1',
      worktree: '/repo',
      vcs: 'git',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })
    getVcsInfo.mockResolvedValue({
      branch: 'feature/test',
      default_branch: 'main',
    })
    getVcsDiff.mockImplementation(async mode => {
      if (mode === 'branch') {
        return [
          {
            file: 'src/branch.ts',
            before: 'const branch = 1',
            after: 'const branch = 2',
            additions: 1,
            deletions: 1,
          },
        ]
      }

      return [
        {
          file: 'src/git.ts',
          before: 'const git = 1',
          after: 'const git = 2',
          additions: 1,
          deletions: 1,
        },
      ]
    })
    getSessionDiff.mockResolvedValue([
      {
        file: 'src/app.ts',
        before: 'const a = 1',
        after: 'const a = 2',
        additions: 1,
        deletions: 1,
      },
      {
        file: 'src/components/Button.tsx',
        before: 'export const Button = 1',
        after: 'export const Button = 2',
        additions: 1,
        deletions: 1,
      },
    ])
    getLastTurnDiff.mockResolvedValue([
      {
        file: 'src/turn.ts',
        before: 'const turn = 1',
        after: 'const turn = 2',
        additions: 1,
        deletions: 1,
      },
    ])
    initGitProject.mockResolvedValue({
      id: 'project-1',
      worktree: '/repo',
      vcs: 'git',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads session diffs and shows the first file preview by default', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo')
    expect(screen.getByText('2 files')).toBeInTheDocument()
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0)
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change mode: Session changes/ })).toBeInTheDocument()
    expect(screen.getAllByText('app.ts').length).toBeGreaterThan(0)
  })

  it('switches to current turn changes on demand', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Change mode:/ }))

    await act(async () => {
      vi.advanceTimersByTime(48)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByText('Last turn changes'))

    await act(async () => {
      vi.advanceTimersByTime(240)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getLastTurnDiff).toHaveBeenCalledWith('session-1', '/repo')
    expect(screen.getByText('1 file')).toBeInTheDocument()
    expect(screen.getAllByText('turn.ts').length).toBeGreaterThan(0)
  })

  it('switches to branch changes when available', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Change mode:/ }))

    await act(async () => {
      vi.advanceTimersByTime(48)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByText('Branch changes'))

    await act(async () => {
      vi.advanceTimersByTime(240)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getVcsDiff).toHaveBeenCalledWith('branch', '/repo')
    expect(screen.getAllByText('branch.ts').length).toBeGreaterThan(0)
  })

  it('offers git initialization when the project is not a git repository', async () => {
    getCurrentProject.mockResolvedValueOnce({
      id: 'global',
      worktree: '/repo',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })

    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Initialize Git repository' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(initGitProject).toHaveBeenCalledWith('/repo')
    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo')
  })
})
