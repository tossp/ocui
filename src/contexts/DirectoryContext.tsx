// ============================================
// DirectoryContext - 管理当前工作目录
// ============================================

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { getPath, getPendingPermissions, getPendingQuestions, type ApiPath } from '../api'
import { useRouter } from '../hooks/useRouter'
import { handleError, normalizeToForwardSlash, getDirectoryName, isSameDirectory, serverStorage } from '../utils'
import { layoutStore, useLayoutStore } from '../store/layoutStore'
import { activeSessionStore } from '../store/activeSessionStore'
import { serverStore } from '../store/serverStore'
import { isTauri } from '../utils/tauri'
import { DirectoryContext, type DirectoryContextValue, type SavedDirectory } from './DirectoryContext.shared'

const STORAGE_KEY_SAVED = 'opencode-saved-directories'
const STORAGE_KEY_RECENT = 'opencode-recent-projects'

// 最近使用记录: { [path]: lastUsedAt }
type RecentProjects = Record<string, number>

export function DirectoryProvider({ children }: { children: ReactNode }) {
  // 从 URL 获取 directory（替代 localStorage）
  const { directory: urlDirectory, setDirectory: setUrlDirectory } = useRouter()

  // 从 layoutStore 获取 sidebarExpanded
  const { sidebarExpanded } = useLayoutStore()

  const [savedDirectories, setSavedDirectories] = useState<SavedDirectory[]>(() => {
    return serverStorage.getJSON<SavedDirectory[]>(STORAGE_KEY_SAVED) ?? []
  })

  const [recentProjects, setRecentProjects] = useState<RecentProjects>(() => {
    return serverStorage.getJSON<RecentProjects>(STORAGE_KEY_RECENT) ?? {}
  })

  const [pathInfo, setPathInfo] = useState<ApiPath | null>(null)

  // 服务器切换时，重新从 serverStorage 读取（key 前缀已变）
  useEffect(() => {
    return serverStore.onServerChange(() => {
      setSavedDirectories(serverStorage.getJSON<SavedDirectory[]>(STORAGE_KEY_SAVED) ?? [])
      setRecentProjects(serverStorage.getJSON<RecentProjects>(STORAGE_KEY_RECENT) ?? {})
      setPathInfo(null) // 重置，等待重新加载
      setUrlDirectory(undefined) // 清除当前目录选择
    })
  }, [setUrlDirectory])

  // 加载路径信息
  useEffect(() => {
    getPath().then(setPathInfo).catch(handleError('get path info', 'api'))
  }, [])

  // 页面加载时，如果 URL 已有目录，拉取该目录下的 pending requests 补充 active 列表
  useEffect(() => {
    if (!urlDirectory) return
    Promise.all([
      getPendingPermissions(undefined, urlDirectory).catch(() => []),
      getPendingQuestions(undefined, urlDirectory).catch(() => []),
    ]).then(([permissions, questions]) => {
      if (permissions.length > 0 || questions.length > 0) {
        activeSessionStore.initializePendingRequests(permissions, questions)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在挂载时跑一次

  // 保存 savedDirectories 到 per-server storage
  useEffect(() => {
    serverStorage.setJSON(STORAGE_KEY_SAVED, savedDirectories)
  }, [savedDirectories])

  // 保存 recentProjects 到 per-server storage
  useEffect(() => {
    serverStorage.setJSON(STORAGE_KEY_RECENT, recentProjects)
  }, [recentProjects])

  // 设置当前目录（更新 URL + 记录最近使用 + 拉取 pending requests）
  const setCurrentDirectory = useCallback(
    (directory: string | undefined) => {
      setUrlDirectory(directory)
      if (directory) {
        setRecentProjects(prev => ({ ...prev, [directory]: Date.now() }))
      }
      // 切换目录后拉取该目录下的 pending permission/question，补充到 active 列表
      Promise.all([
        getPendingPermissions(undefined, directory).catch(() => []),
        getPendingQuestions(undefined, directory).catch(() => []),
      ]).then(([permissions, questions]) => {
        if (permissions.length > 0 || questions.length > 0) {
          activeSessionStore.initializePendingRequests(permissions, questions)
        }
      })
    },
    [setUrlDirectory],
  )

  // 添加目录
  const addDirectory = useCallback(
    (path: string) => {
      let normalized = normalizeToForwardSlash(path)

      // normalizeToForwardSlash 会去掉尾斜杠，导致根路径 "/" → "" 和 "C:/" → "C:"
      // 需要修正：如果原始路径是根路径，恢复正确的值
      const trimmed = path.replace(/\\/g, '/').replace(/\/+$/, '/')
      if (!normalized && (trimmed === '/' || /^[a-zA-Z]:\/$/.test(trimmed))) {
        normalized = trimmed.slice(0, -1) || '/'
      }

      // 验证路径非空（只阻止空字符串和 "."）
      if (!normalized || normalized === '.') return

      // 使用 isSameDirectory 检查是否已存在（处理大小写和斜杠差异）
      if (savedDirectories.some(d => isSameDirectory(d.path, normalized))) {
        setCurrentDirectory(normalized)
        return
      }

      const newDir: SavedDirectory = {
        path: normalized,
        name: getDirectoryName(normalized) || normalized,
        addedAt: Date.now(),
      }

      setSavedDirectories(prev => [...prev, newDir])
      setCurrentDirectory(normalized)
    },
    [savedDirectories, setCurrentDirectory],
  )

  // 移除目录
  const removeDirectory = useCallback(
    (path: string) => {
      const normalized = normalizeToForwardSlash(path)
      setSavedDirectories(prev => prev.filter(d => !isSameDirectory(d.path, normalized)))
      if (isSameDirectory(urlDirectory, normalized)) {
        setCurrentDirectory(undefined)
      }
    },
    [urlDirectory, setCurrentDirectory],
  )

  const reorderDirectories = useCallback((draggedPath: string, targetPath: string) => {
    const normalizedDragged = normalizeToForwardSlash(draggedPath)
    const normalizedTarget = normalizeToForwardSlash(targetPath)

    if (!normalizedDragged || !normalizedTarget || isSameDirectory(normalizedDragged, normalizedTarget)) {
      return
    }

    setSavedDirectories(prev => {
      const next = [...prev]
      const draggedIndex = next.findIndex(directory => isSameDirectory(directory.path, normalizedDragged))
      const targetIndex = next.findIndex(directory => isSameDirectory(directory.path, normalizedTarget))

      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
        return prev
      }

      const [draggedDirectory] = next.splice(draggedIndex, 1)
      next.splice(targetIndex, 0, draggedDirectory)
      return next
    })
  }, [])

  // Tauri: 启动时获取 CLI 传入的目录 + 监听后续 open-directory 事件
  // 用 ref 持有最新的 addDirectory 避免 stale closure
  const addDirectoryRef = useRef(addDirectory)
  addDirectoryRef.current = addDirectory

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined

    // 拉取启动时的 CLI 目录（一次性）
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string | null>('get_cli_directory')
        .then(dir => {
          if (dir) addDirectoryRef.current(dir)
        })
        .catch(() => {})
    })

    // 监听后续的 open-directory 事件（single-instance / macOS RunEvent::Opened）
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('open-directory', event => {
        addDirectoryRef.current(event.payload)
      }).then(fn => {
        unlisten = fn
      })
    })

    return () => {
      unlisten?.()
    }
  }, [])

  // 设置侧边栏展开 - 委托给 layoutStore
  const setSidebarExpanded = useCallback((expanded: boolean) => {
    layoutStore.setSidebarExpanded(expanded)
  }, [])

  // 稳定化 Provider value，避免每次渲染创建新对象导致子组件不必要重渲染
  const value = useMemo<DirectoryContextValue>(
    () => ({
      currentDirectory: urlDirectory,
      setCurrentDirectory,
      savedDirectories,
      addDirectory,
      removeDirectory,
      reorderDirectories,
      pathInfo,
      sidebarExpanded,
      setSidebarExpanded,
      recentProjects,
    }),
    [
      urlDirectory,
      setCurrentDirectory,
      savedDirectories,
      addDirectory,
      removeDirectory,
      reorderDirectories,
      pathInfo,
      sidebarExpanded,
      setSidebarExpanded,
      recentProjects,
    ],
  )

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
}
