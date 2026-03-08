import { useCallback, useEffect, useState, useRef } from 'react'
import type { ApiSession } from '../../../api'
import { FolderIcon, FolderOpenIcon, PencilIcon, SpinnerIcon, TrashIcon } from '../../../components/Icons'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useIsMobile, useSessions } from '../../../hooks'
import { useInView } from '../../../hooks/useInView'
import { formatRelativeTime } from '../../../utils/dateUtils'
import { getDirectoryName, isSameDirectory } from '../../../utils'

const DIRECTORY_PAGE_SIZE = 5

export interface FolderRecentProject {
  id: string
  name: string
  worktree: string
}

interface FolderRecentListProps {
  projects: FolderRecentProject[]
  currentDirectory?: string
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
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
}: FolderRecentListProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    getInitialExpandedProjectIds(projects, currentDirectory),
  )
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteSession | null>(null)

  useEffect(() => {
    setExpandedProjectIds(prev => {
      const next = prev.filter(id => projects.some(project => project.id === id))
      return next.length > 0 ? next : getInitialExpandedProjectIds(projects, currentDirectory)
    })
  }, [projects, currentDirectory])

  useEffect(() => {
    if (!currentDirectory) return
    const currentProject = projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    if (!currentProject) return

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
            {projects.map(project => (
              <FolderRecentSection
                key={project.id}
                project={project}
                isExpanded={expandedProjectIds.includes(project.id)}
                isCurrent={isSameDirectory(project.worktree, currentDirectory)}
                selectedSessionId={selectedSessionId}
                onToggle={() => handleToggleProject(project.id)}
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
  isExpanded: boolean
  isCurrent: boolean
  selectedSessionId: string | null
  onToggle: () => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
}

function FolderRecentSection({
  project,
  isExpanded,
  isCurrent,
  selectedSessionId,
  onToggle,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
}: FolderRecentSectionProps) {
  const { ref, inView } = useInView({ rootMargin: '200px 0px', triggerOnce: true })
  const [hasActivated, setHasActivated] = useState(false)

  useEffect(() => {
    if (isExpanded && inView) {
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
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-200/25"
        title={project.worktree}
      >
        <FolderDisplayIcon
          size={15}
          className={isCurrent ? 'shrink-0 text-accent-main-100' : 'shrink-0 text-text-400/90'}
        />
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-100">{projectName}</div>
      </button>

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
                <FolderSessionRow
                  key={session.id}
                  session={session}
                  isSelected={session.id === selectedSessionId}
                  onSelect={() => onSelectSession(session)}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}

              {hasMore && (
                <button
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  className="w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-text-400/75 transition-colors hover:bg-bg-200/20 hover:text-text-300 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {isLoadingMore ? 'Loading...' : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface FolderSessionRowProps {
  session: ApiSession
  isSelected: boolean
  onSelect: () => void
  onRename: (sessionId: string, newTitle: string) => Promise<void>
  onDelete: (sessionId: string) => void
}

function FolderSessionRow({ session, isSelected, onSelect, onRename, onDelete }: FolderSessionRowProps) {
  const isMobile = useIsMobile()
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title || '')
  const [showActions, setShowActions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMoved = useRef(false)

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowActions(false)
    setEditTitle(session.title || '')
    setIsEditing(true)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowActions(false)
    onDelete(session.id)
  }

  const handleSaveEdit = async () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      await onRename(session.id, trimmed)
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(session.title || '')
    setIsEditing(false)
  }

  const handleTouchStart = useCallback(() => {
    touchMoved.current = false
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        setShowActions(true)
      }
    }, 500)
  }, [])

  const handleTouchMove = useCallback(() => {
    touchMoved.current = true
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    if (!showActions) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
        setShowActions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [showActions])

  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
      }
    }
  }, [])

  if (isEditing) {
    return (
      <div className="px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onBlur={() => void handleSaveEdit()}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              void handleSaveEdit()
            } else if (e.key === 'Escape') {
              handleCancelEdit()
            }
          }}
          onClick={e => e.stopPropagation()}
          className="w-full rounded-md border border-accent-main-100/40 bg-bg-000 px-2 py-1.5 text-[12px] text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-main-100/30"
        />
      </div>
    )
  }

  const actionsVisible = isMobile ? showActions : false

  return (
    <div
      ref={itemRef}
      onClick={() => {
        if (showActions) {
          setShowActions(false)
          return
        }
        onSelect()
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`group relative flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 select-none ${
        isSelected ? 'bg-bg-000/80' : 'hover:bg-bg-200/25'
      } ${showActions ? 'bg-bg-200/35' : ''}`}
    >
      <div className={`min-w-0 flex-1 transition-[padding] duration-200 ${showActions ? 'pr-[56px]' : 'pr-[64px]'}`}>
        <p
          className={`truncate text-[12px] font-medium ${
            isSelected ? 'text-text-100' : 'text-text-200 group-hover:text-text-100'
          }`}
          title={session.title || 'Untitled Chat'}
        >
          {session.title || 'Untitled Chat'}
        </p>
      </div>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <span
          className={`text-[10px] text-text-400/80 whitespace-nowrap transition-all duration-200 ${
            actionsVisible ? 'opacity-0 pointer-events-none' : 'opacity-100 group-hover:opacity-0'
          }`}
        >
          {session.time?.updated ? formatRelativeTime(session.time.updated) : ''}
        </span>

        <div
          className={`absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-all duration-200 ${
            actionsVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
          }`}
        >
          <button
            onClick={handleStartEdit}
            className="rounded-md p-1.5 text-text-400 transition-colors hover:bg-bg-300 hover:text-text-100"
            title="Rename"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDelete}
            className="rounded-md p-1.5 text-text-400 transition-colors hover:bg-danger-bg hover:text-danger-100"
            title="Delete"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
