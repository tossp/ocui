/**
 * FullscreenViewer - 通用全屏查看器
 *
 * 设计理念：
 * - 卡片居中而非全屏铺满，内容少时不会显得空洞
 * - 优雅的暗色背景 + 微弱光晕效果
 * - 支持代码预览和 Diff 两种模式
 * - 自适应内容大小，有最大尺寸限制
 */

import { memo, useState, useEffect, useMemo } from 'react'
import { diffLines } from 'diff'
import { CloseIcon } from './Icons'
import { CopyButton } from './ui'
import { detectLanguage } from '../utils/languageUtils'
import { extractContentFromUnifiedDiff } from '../utils/diffUtils'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { CodePreview } from './CodePreview'
import { ModalShell } from './ui/ModalShell'

// ============================================
// Types
// ============================================

export type ViewerMode = 'code' | 'diff'

interface BaseProps {
  isOpen: boolean
  onClose: () => void
  filePath?: string
  language?: string
}

interface CodeViewerProps extends BaseProps {
  mode: 'code'
  content: string
}

interface DiffViewerProps extends BaseProps {
  mode: 'diff'
  diff: { before: string; after: string } | string
  diffStats?: { additions: number; deletions: number }
}

export type FullscreenViewerProps = CodeViewerProps | DiffViewerProps

// ============================================
// Main Component
// ============================================

export const FullscreenViewer = memo(function FullscreenViewer(props: FullscreenViewerProps) {
  const { isOpen, onClose, filePath, language } = props

  const [diffViewMode, setDiffViewMode] = useState<ViewMode>('split')

  // 响应式 diff view mode
  useEffect(() => {
    if (props.mode !== 'diff') return
    const checkWidth = () => setDiffViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [props.mode])

  // 解析内容
  const { content, resolvedDiff, diffStats, lang, fileName, lineCount } = useMemo(() => {
    const lang = language || detectLanguage(filePath) || 'text'
    const fileName = filePath?.split(/[/\\]/).pop()

    if (props.mode === 'code') {
      const lines = props.content.split('\n').length
      return {
        content: props.content,
        resolvedDiff: null,
        diffStats: null,
        lang,
        fileName,
        lineCount: lines,
      }
    }

    // Diff mode
    const diff = props.diff
    const resolved = typeof diff === 'object' ? diff : extractContentFromUnifiedDiff(diff)

    // 计算 diff stats
    let stats = props.diffStats
    if (!stats) {
      const changes = diffLines(resolved.before, resolved.after)
      let additions = 0,
        deletions = 0
      for (const c of changes) {
        if (c.added) additions += c.count || 0
        if (c.removed) deletions += c.count || 0
      }
      stats = { additions, deletions }
    }

    const maxLines = Math.max(resolved.before.split('\n').length, resolved.after.split('\n').length)

    return {
      content: null,
      resolvedDiff: resolved,
      diffStats: stats,
      lang,
      fileName,
      lineCount: maxLines,
    }
  }, [props, language, filePath])

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} variant="card" closeOnBackdrop>
      {/* Header */}
      <div className="flex items-center h-11 px-4 border-b border-border-100/60 bg-bg-200/30 shrink-0 gap-3">
        {/* Left: file info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {fileName && (
            <span className="text-text-100 font-mono text-[13px] font-medium truncate min-w-0 flex-1">{fileName}</span>
          )}
          {filePath && fileName && filePath !== fileName && (
            <span className="text-text-500 font-mono text-[11px] truncate hidden sm:block min-w-0">{filePath}</span>
          )}

          {/* Diff stats */}
          {diffStats && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums shrink-0">
              {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
              {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
            </div>
          )}

          {/* Line count for code */}
          {props.mode === 'code' && (
            <span className="text-text-500 text-[11px] font-mono shrink-0">{lineCount} lines</span>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Copy button for code */}
          {props.mode === 'code' && content && <CopyButton text={content} position="static" />}

          {/* View mode switch for diff */}
          {props.mode === 'diff' && (
            <>
              <ViewModeSwitch viewMode={diffViewMode} onChange={setDiffViewMode} />
              <div className="w-px h-4 bg-border-200/40" />
            </>
          )}

          <button
            onClick={onClose}
            className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-300/60 rounded-lg transition-colors"
            title="Close (Esc)"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      {/* Content - 用 max-height 限制，减去 header 44px */}
      <div className="overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(min(90vh, 1000px) - 44px)' }}>
        {props.mode === 'diff' && resolvedDiff ? (
          <DiffViewer
            before={resolvedDiff.before}
            after={resolvedDiff.after}
            language={lang}
            viewMode={diffViewMode}
            autoHeight
          />
        ) : props.mode === 'code' && content ? (
          <CodePreview code={content} language={lang} truncateLines={false} />
        ) : null}
      </div>
    </ModalShell>
  )
})

// ============================================
// ViewModeSwitch - 导出供其他组件使用
// ============================================

export function ViewModeSwitch({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="flex items-center bg-bg-300/50 rounded-lg p-0.5 text-[11px]">
      <button
        className={`px-2.5 py-1 rounded-md transition-all ${
          viewMode === 'split' ? 'bg-bg-100 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('split')}
      >
        Split
      </button>
      <button
        className={`px-2.5 py-1 rounded-md transition-all ${
          viewMode === 'unified' ? 'bg-bg-100 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('unified')}
      >
        Unified
      </button>
    </div>
  )
}

// ============================================
// Convenience exports
// ============================================

/** 简化的代码查看器 */
export function CodeViewer(props: Omit<CodeViewerProps, 'mode'>) {
  return <FullscreenViewer {...props} mode="code" />
}

/** 简化的 Diff 查看器 */
export function DiffModalViewer(props: Omit<DiffViewerProps, 'mode'>) {
  return <FullscreenViewer {...props} mode="diff" />
}
