import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyntaxHighlightRef, type HighlightTokens } from '../hooks/useSyntaxHighlight'

const LINE_HEIGHT = 20
const OVERSCAN = 5
const MAX_LINE_LENGTH = 5000

interface CodePreviewProps {
  code: string
  language: string
  truncateLines?: boolean
  maxHeight?: number
  isResizing?: boolean
}

/**
 * CodePreview - 代码预览组件
 *
 * 架构：
 *   外层容器 (overflow: auto) — 原生垂直 + 水平滚动
 *     高度占位 (height: totalHeight, relative) — 虚拟滚动
 *       absolute div (translateY: offsetY) — 可见行
 *         每行 flex row:
 *           gutter (sticky left: 0, bg-inherit) — 行号，水平滚动时钉在左侧
 *           content — 代码，随水平滚动自然移动
 *     probe div (visibility: hidden, h-0) — 包含最长行文本，撑开容器 scrollWidth
 */
export function CodePreview({ code, language, truncateLines = true, maxHeight, isResizing = false }: CodePreviewProps) {
  const lines = useMemo(() => {
    const raw = code.split('\n')
    if (raw.length > 1 && raw[raw.length - 1] === '' && code.endsWith('\n')) {
      raw.pop()
    }
    return raw
  }, [code])
  const totalHeight = lines.length * LINE_HEIGHT
  const gutterCh = Math.max(2, String(lines.length).length)
  const gutterWidth = `calc(${gutterCh}ch + 1.75rem)`

  // 找到最长行的原始文本 — 用于 probe 元素精确撑开 scrollWidth
  const longestLine = useMemo(() => {
    let max = '',
      maxLen = 0
    for (const line of lines) {
      if (line.length > maxLen) {
        maxLen = line.length
        max = line
      }
    }
    return truncateLines && maxLen > MAX_LINE_LENGTH ? max.slice(0, MAX_LINE_LENGTH) : max
  }, [lines, truncateLines])

  const enableHighlight = language !== 'text'
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: enableHighlight,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT)
    const end = Math.min(lines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * LINE_HEIGHT }
  }, [scrollTop, containerHeight, lines.length])

  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    let rafId: number | null = null
    const update = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => setContainerHeight(container.clientHeight))
    }
    setContainerHeight(container.clientHeight)
    const ro = new ResizeObserver(update)
    ro.observe(container)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [isResizing])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const rows = useMemo(() => {
    void version
    const tokens = tokensRef.current
    const result: React.ReactNode[] = []

    for (let i = startIndex; i < endIndex; i++) {
      const rawLine = lines[i] || ' '
      const lineTokens = tokens?.[i]
      let displayContent: React.ReactNode
      let isTruncated = false

      if (lineTokens && lineTokens.length > 0) {
        if (truncateLines) {
          const { elements, truncated } = renderTokensTruncated(lineTokens)
          isTruncated = truncated
          displayContent = <span className="whitespace-pre">{elements}</span>
        } else {
          displayContent = (
            <span className="whitespace-pre">
              {lineTokens.map((token, j) => (
                <span key={j} style={token.color ? { color: token.color } : undefined}>
                  {token.content}
                </span>
              ))}
            </span>
          )
        }
      } else {
        if (truncateLines && rawLine.length > MAX_LINE_LENGTH) {
          isTruncated = true
          displayContent = <span className="text-text-200 whitespace-pre">{rawLine.slice(0, MAX_LINE_LENGTH)}</span>
        } else {
          displayContent = <span className="text-text-200 whitespace-pre">{rawLine}</span>
        }
      }

      result.push(
        <div key={i} className="flex" style={{ height: LINE_HEIGHT }}>
          <div
            className="shrink-0 sticky left-0 z-[1] bg-inherit text-text-500 text-right pr-3 pl-4 leading-5 select-none"
            style={{ width: gutterWidth }}
          >
            {i + 1}
          </div>
          <div className="leading-5 pl-3 pr-4 whitespace-pre">
            {displayContent}
            {isTruncated && <span className="text-text-500 ml-1">… (truncated)</span>}
          </div>
        </div>,
      )
    }
    return result
  }, [startIndex, endIndex, lines, version, tokensRef, truncateLines, gutterWidth])

  return (
    <div
      ref={containerRef}
      className="overflow-auto code-scrollbar h-full font-mono text-[11px] leading-relaxed bg-bg-100"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {/* 虚拟滚动高度占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0" style={{ transform: `translateY(${offsetY}px)` }}>
          {rows}
        </div>
      </div>

      {/* Probe: 包含最长行文本，与行内容同样的 padding，精确撑开容器 scrollWidth。
          visibility:hidden 不可见但参与布局，height:0 不影响垂直滚动。 */}
      <div className="flex" style={{ visibility: 'hidden', height: 0, overflow: 'hidden' }}>
        <div className="shrink-0" style={{ width: gutterWidth }} />
        <div className="pl-3 pr-4 whitespace-pre">{longestLine}</div>
      </div>
    </div>
  )
}

// ============================================
// Token 截断渲染
// ============================================

type HighlightToken = HighlightTokens[number][number]

function renderTokensTruncated(lineTokens: HighlightToken[]): {
  elements: React.ReactNode[]
  truncated: boolean
} {
  const elements: React.ReactNode[] = []
  let charCount = 0
  let truncated = false

  for (let j = 0; j < lineTokens.length; j++) {
    const token = lineTokens[j]
    const remaining = MAX_LINE_LENGTH - charCount

    if (remaining <= 0) {
      truncated = true
      break
    }

    if (token.content.length > remaining) {
      elements.push(
        <span key={j} style={token.color ? { color: token.color } : undefined}>
          {token.content.slice(0, remaining)}
        </span>,
      )
      truncated = true
      break
    }

    elements.push(
      <span key={j} style={token.color ? { color: token.color } : undefined}>
        {token.content}
      </span>,
    )
    charCount += token.content.length
  }

  return { elements, truncated }
}
