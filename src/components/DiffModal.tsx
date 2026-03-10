/**
 * DiffModal - 全屏 Diff 查看器
 *
 * VSCode 风格：全屏铺满 + 毛玻璃背景 + 顶部操作栏
 */

import { memo, useState, useEffect, useMemo } from 'react'
import { diffLines } from 'diff'
import { CloseIcon } from './Icons'
import { detectLanguage } from '../utils/languageUtils'
import { extractContentFromUnifiedDiff } from '../utils/diffUtils'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { ModalShell } from './ui/ModalShell'
import { ViewModeSwitch } from './FullscreenViewer'

// ============================================
// Types
// ============================================

interface DiffModalProps {
  isOpen: boolean
  onClose: () => void
  diff: { before: string; after: string } | string
  filePath?: string
  language?: string
  diffStats?: { additions: number; deletions: number }
}

// ============================================
// Main Component
// ============================================

export const DiffModal = memo(function DiffModal({
  isOpen,
  onClose,
  diff,
  filePath,
  language,
  diffStats: providedStats,
}: DiffModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split')

  useEffect(() => {
    const checkWidth = () => setViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  const { before, after } = useMemo(() => {
    if (typeof diff === 'object') return diff
    return extractContentFromUnifiedDiff(diff)
  }, [diff])

  const lang = language || detectLanguage(filePath) || 'text'
  const fileName = filePath?.split(/[/\\]/).pop()

  const diffStats = useMemo(() => {
    if (providedStats) return providedStats
    const changes = diffLines(before, after)
    let additions = 0,
      deletions = 0
    for (const c of changes) {
      if (c.added) additions += c.count || 0
      if (c.removed) deletions += c.count || 0
    }
    return { additions, deletions }
  }, [before, after, providedStats])

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} variant="fullscreen">
      {/* Toolbar */}
      <div className="flex items-center h-11 px-4 border-b border-border-100/40 shrink-0 gap-3">
        {/* Left: file info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {fileName && (
            <span className="text-text-100 font-mono text-[13px] font-medium truncate min-w-0 flex-1">{fileName}</span>
          )}
          {filePath && fileName && filePath !== fileName && (
            <span className="text-text-500 font-mono text-[11px] truncate hidden sm:block min-w-0">{filePath}</span>
          )}
          <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums shrink-0">
            {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
            {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 shrink-0">
          <ViewModeSwitch viewMode={viewMode} onChange={setViewMode} />
          <div className="w-px h-4 bg-border-200/30" />
          <button
            onClick={onClose}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200/60 rounded-md transition-colors"
            title="Close (Esc)"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      {/* Diff — 填满剩余空间 */}
      <div className="flex-1 min-h-0">
        <DiffViewer before={before} after={after} language={lang} viewMode={viewMode} />
      </div>
    </ModalShell>
  )
})
