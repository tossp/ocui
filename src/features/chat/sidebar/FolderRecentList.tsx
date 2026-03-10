import { useCallback, useEffect, useState } from 'react'
import type { ApiSession } from '../../../api'
import { ArrowDownIcon, ArrowUpIcon, FolderIcon, FolderOpenIcon, SpinnerIcon } from '../../../components/Icons'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useSessions } from '../../../hooks'
import { useInView } from '../../../hooks/useInView'
import { getDirectoryName, isSameDirectory } from '../../../utils'
import { SessionListItem } from '../../sessions'

const DIRECTORY_PAGE_SIZE = 5

export interface FolderRecentProject {
  id: string
  name: string
  worktree: string
  canReorder?: boolean
}

interface FolderRecentListProps {
  projects: FolderRecentProject[]
  currentDirectory?: string
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
  onReorderProject: (draggedPath: string, targetPath: string) => void
}

interface PendingDeleteSession {
  session: ApiSession
  removeLocal: () => void
}

function getInitialExpandedProjectIds(projects: FolderRecentProject[], currentDirectory?: string): string[] {
  if (projects.length === 0) return []

  const currentProject = currentDirectory
    ? projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    : undefined

  return [currentProject?.id || projects[0].id]
}

export function FolderRecentList({
  projects,
  currentDirectory,
  selectedSessionId,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onReorderProject,
}: FolderRecentListProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    getInitialExpandedProjectIds(projects, currentDirectory),
  )
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteSession | null>(null)

  // 当 projects 列表变化时，过滤掉已不存在的展开项
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 响应 prop 变化同步 derived state
    setExpandedProjectIds(prev => {
      const next = prev.filter(id => projects.some(project => project.id === id))
      return next.length > 0 ? next : getInitialExpandedProjectIds(projects, currentDirectory)
    })
  }, [projects, currentDirectory])

  // 确保当前目录对应的 project 展开
  useEffect(() => {
    if (!currentDirectory) return
    const currentProject = projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    if (!currentProject) return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 响应 prop 变化同步 derived state
    setExpandedProjectIds(prev => (prev.includes(currentProject.id) ? prev : [currentProject.id, ...prev]))
  }, [projects, currentDirectory])

  const handleToggleProject = useCallback((projectId: string) => {
    setExpandedProjectIds(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId],
    )
  }, [])

  return (
    <>
      <div className="h-full overflow-y-auto custom-scrollbar px-2 py-2">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-400 opacity-70">
            <p className="text-xs font-medium text-text-300">No project folders yet</p>
            <p className="mt-1 text-[11px] text-text-400/70">Add a project to browse recent chats by folder.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project, index) => (
              <FolderRecentSection
                key={project.id}
                project={project}
                canMoveUp={!!project.canReorder && index > 0 && !!projects[index - 1]?.canReorder}
                canMoveDown={!!project.canReorder && index < projects.length - 1 && !!projects[index + 1]?.canReorder}
                isExpanded={expandedProjectIds.includes(project.id)}
                isCurrent={isSameDirectory(project.worktree, currentDirectory)}
                selectedSessionId={selectedSessionId}
                onToggle={() => handleToggleProject(project.id)}
                onMoveUp={() => {
                  const target = projects[index - 1]
                  if (target) onReorderProject(project.worktree, target.worktree)
                }}
                onMoveDown={() => {
                  const target = projects[index + 1]
                  if (target) onReorderProject(project.worktree, target.worktree)
                }}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onRequestDeleteSession={setPendingDelete}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await onDeleteSession(pendingDelete.session)
            pendingDelete.removeLocal()
          }
          setPendingDelete(null)
        }}
        title="Delete Chat"
        description="Are you sure you want to delete this chat? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />
    </>
  )
}

interface FolderRecentSectionProps {
  project: FolderRecentProject
  canMoveUp: boolean
  canMoveDown: boolean
  isExpanded: boolean
  isCurrent: boolean
  selectedSessionId: string | null
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
}

function FolderRecentSection({
  project,
  canMoveUp,
  canMoveDown,
  isExpanded,
  isCurrent,
  selectedSessionId,
  onToggle,
  onMoveUp,
  onMoveDown,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
}: FolderRecentSectionProps) {
  const { ref, inView } = useInView({ rootMargin: '200px 0px', triggerOnce: true })
  const [hasActivated, setHasActivated] = useState(false)

  useEffect(() => {
    if (isExpanded && inView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 延迟加载闸门，只从 false→true
      setHasActivated(true)
    }
  }, [isExpanded, inView])

  const { sessions, isLoading, isLoadingMore, hasMore, loadMore, patchLocalSession, removeLocalSession } = useSessions({
    directory: project.worktree,
    pageSize: DIRECTORY_PAGE_SIZE,
    enabled: hasActivated,
  })

  const handleRename = useCallback(
    async (sessionId: string, newTitle: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      await onRenameSession(session, newTitle)
      patchLocalSession(sessionId, { title: newTitle })
    },
    [sessions, onRenameSession, patchLocalSession],
  )

  const handleDelete = useCallback(
    (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      onRequestDeleteSession({
        session,
        removeLocal: () => removeLocalSession(sessionId),
      })
    },
    [sessions, onRequestDeleteSession, removeLocalSession],
  )

  const projectName = project.name || getDirectoryName(project.worktree) || project.worktree
  const FolderDisplayIcon = isExpanded ? FolderOpenIcon : FolderIcon

  return (
    <div ref={ref}>
      <div className="group relative">
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-[56px] text-left transition-all duration-200 hover:bg-bg-200/50"
          title={project.worktree}
        >
          <FolderDisplayIcon
            size={15}
            className={isCurrent ? 'shrink-0 text-accent-main-100' : 'shrink-0 text-text-400/90'}
          />
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-100">{projectName}</div>
        </button>

        {(canMoveUp || canMoveDown) && (
          <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => {
                e.stopPropagation()
                onMoveUp()
              }}
              disabled={!canMoveUp}
              className="rounded-md p-1 text-text-400 transition-colors hover:bg-bg-300 hover:text-text-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-400"
              title="Move folder up"
            >
              <ArrowUpIcon size={12} />
            </button>
            <button
              onClick={e => {
                e.stopPropagation()
                onMoveDown()
              }}
              disabled={!canMoveDown}
              className="rounded-md p-1 text-text-400 transition-colors hover:bg-bg-300 hover:text-text-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-400"
              title="Move folder down"
            >
              <ArrowDownIcon size={12} />
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-0.5 pt-0.5">
          {!hasActivated || isLoading ? (
            <div className="flex items-center px-2 py-1.5 text-[12px] text-text-400/70">
              <SpinnerIcon size={13} className="animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-1.5 text-[12px] text-text-400/70">No chats in this folder</div>
          ) : (
            <>
              {sessions.map(session => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  isSelected={session.id === selectedSessionId}
                  onSelect={() => onSelectSession(session)}
                  onRename={newTitle => handleRename(session.id, newTitle)}
                  onDelete={() => handleDelete(session.id)}
                  density="compact"
                  showStats
                  showDirectory={false}
                />
              ))}

              {hasMore && (
                <button
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-medium text-text-400/80 transition-colors hover:bg-bg-200/35 hover:text-text-300 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {isLoadingMore ? 'Loading more...' : 'Show more chats'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
