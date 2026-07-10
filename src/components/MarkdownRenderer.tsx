import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import morphdom from 'morphdom'
import { CodeBlock } from './CodeBlock'
import { HandIcon, RetryIcon, ZoomInIcon, ZoomOutIcon } from './Icons'
import { CopyButton } from './ui'
import { useTheme } from '../hooks/useTheme'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { detectLanguage } from '../utils/languageUtils'
import { isTauri } from '../utils/tauri'
import { marked } from 'marked'
import type { Tokens } from 'marked'
import { projectMarkdownStream, type MarkdownStreamProjection } from './markdownStream'
import { renderMarkdownToHtml } from './markdownHtmlRenderer'
import { getCachedMermaidSvg, getOrRenderMermaidSvg } from './mermaidRenderCache'
import { inferImageDimensions } from './imageDimensions'

interface MarkdownRendererProps {
  content: string
  className?: string
  isStreaming?: boolean
  variant?: 'default' | 'reasoning'
}

const MERMAID_MIN_SCALE = 0.5
const MERMAID_MAX_SCALE = 3
const MERMAID_SCALE_STEP = 0.15
const MERMAID_CONTROL_BUTTON_BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-300/70 backdrop-blur-md transition-colors duration-150 hover:bg-bg-300/85 disabled:opacity-40 disabled:cursor-not-allowed'
const MERMAID_CONTROL_BUTTON_CLASS = `${MERMAID_CONTROL_BUTTON_BASE_CLASS} text-text-400 hover:text-text-200`
const LOCAL_FILE_LINK_PREFIX = '#opencode-local-file:'

type DiagramPointer = { x: number; y: number }

type PinchGesture = {
  startDistance: number
  startScale: number
  startOffset: { x: number; y: number }
  startCenter: { x: number; y: number }
}

let mermaidRenderCounter = 0
const markdownProjectionCache = new Map<string, MarkdownStreamProjection>()

const htmlCache = new Map<string, string>()
const HTML_CACHE_MAX = 64
const MARKDOWN_BLOCK_CONTENT_CLASS = 'space-y-4 whitespace-normal [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'

function getCachedHtml(src: string, isReasoning: boolean): string {
  const key = `${isReasoning ? 'r' : 'd'}:${src}`
  const cached = htmlCache.get(key)
  if (cached !== undefined) return cached
  const html = renderMarkdownToHtml(src, isReasoning)
  if (htmlCache.size >= HTML_CACHE_MAX) {
    const firstKey = htmlCache.keys().next().value
    if (firstKey !== undefined) htmlCache.delete(firstKey)
  }
  htmlCache.set(key, html)
  return html
}

function createMermaidRenderId(prefix: string) {
  mermaidRenderCounter += 1
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'diagram'
  return `mermaid-${safePrefix}-${mermaidRenderCounter}`
}

function scopeMermaidSvg(svg: string, instanceId: string) {
  const ids = Array.from(svg.matchAll(/\bid=["']([^"']+)["']/gi), match => match[1])
  let scoped = svg
  Array.from(new Set(ids)).forEach((id, index) => {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const nextId = `${instanceId}-${index}`
    scoped = scoped.replace(new RegExp(`\\bid=(["'])${escapedId}\\1`, 'g'), `id="${nextId}"`)
    scoped = scoped.replace(new RegExp(`#${escapedId}(?![a-zA-Z0-9_.:-])`, 'g'), `#${nextId}`)
    scoped = scoped.replace(
      /\b(aria-labelledby|aria-describedby)=(["'])([^"']*)\2/gi,
      (_attribute, name: string, quote: string, value: string) => {
        const tokens = value.split(/\s+/).map(token => (token === id ? nextId : token))
        return `${name}=${quote}${tokens.join(' ')}${quote}`
      },
    )
  })
  return scoped
}

async function getMermaidSvg(code: string, theme: 'dark' | 'default', renderPrefix: string) {
  const cacheKey = `${theme}:${code}`
  return getOrRenderMermaidSvg(cacheKey, async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
    const result = await mermaid.render(createMermaidRenderId(renderPrefix), code)
    return result.svg
  })
}

function clampMermaidScale(scale: number) {
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, Number(scale.toFixed(2))))
}

function getPointerDistance(first: DiagramPointer, second: DiagramPointer) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getPointerCenter(first: DiagramPointer, second: DiagramPointer) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

function getRelativeCenter(target: HTMLDivElement, first: DiagramPointer, second: DiagramPointer) {
  const center = getPointerCenter(first, second)
  const rect = target.parentElement?.getBoundingClientRect()
  if (!rect) return center
  return {
    x: center.x - rect.left,
    y: center.y - rect.top,
  }
}

function decodeLocalFileHref(href?: string): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length))
  } catch {
    return null
  }
}

function openLocalFilePath(filePath: string) {
  if (!isTauri()) return
  import('@tauri-apps/plugin-opener').then(mod => mod.openPath(filePath)).catch(() => {})
}

function getOrderedListPadding(start: number, itemCount: number): string {
  const endNumber = Math.max(start + itemCount - 1, start)
  const markerChars = String(Math.abs(endNumber)).length + (endNumber < 0 ? 1 : 0)
  return `${Math.max(3, markerChars + 2)}ch`
}

// ─── Mermaid ────────────────────────────────────────────────────

const MarkdownMermaid = memo(function MarkdownMermaid({ code, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default'
  const { hasCoarsePointer, hasTouch, preferTouchUi } = useInputCapabilities()
  const supportsTouchGestures = hasCoarsePointer || hasTouch
  const renderPrefix = useId()
  const instanceSvgId = `mermaid-instance-${renderPrefix.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const touchPointersRef = useRef<Map<number, DiagramPointer>>(new Map())
  const pinchRef = useRef<PinchGesture | null>(null)
  const [svg, setSvg] = useState(() => (isIncomplete ? '' : (getCachedMermaidSvg(`${mermaidTheme}:${code}`) ?? '')))
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isTouchPanEnabled, setIsTouchPanEnabled] = useState(false)

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])
  const scopedSvg = useMemo(() => scopeMermaidSvg(svg, instanceSvgId), [instanceSvgId, svg])

  const zoomBy = useCallback((delta: number) => {
    setScale(current => clampMermaidScale(current + delta))
  }, [])

  const clearTouchGesture = useCallback(() => {
    touchPointersRef.current.clear()
    pinchRef.current = null
    dragRef.current = null
  }, [])

  const beginPinchGesture = useCallback(
    (target: HTMLDivElement) => {
      const pointers = Array.from(touchPointersRef.current.values())
      if (pointers.length < 2) return
      const [first, second] = pointers
      pinchRef.current = {
        startDistance: Math.max(1, getPointerDistance(first, second)),
        startScale: scale,
        startOffset: offset,
        startCenter: getRelativeCenter(target, first, second),
      }
      dragRef.current = null
    },
    [offset, scale],
  )

  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      if (event.target instanceof HTMLElement && event.target.closest('button')) return
      event.currentTarget.focus({ preventScroll: true })
    },
    [preferTouchUi],
  )

  const handleContainerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      setIsTouchPanEnabled(false)
      clearTouchGesture()
    },
    [clearTouchGesture, preferTouchUi],
  )

  useEffect(() => {
    if (isTouchPanEnabled) return
    clearTouchGesture()
  }, [clearTouchGesture, isTouchPanEnabled])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (supportsTouchGestures && event.pointerType !== 'mouse' && !isTouchPanEnabled) return
      if (event.pointerType !== 'mouse') {
        touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touchPointersRef.current.size >= 2) {
          beginPinchGesture(event.currentTarget)
          event.currentTarget.setPointerCapture?.(event.pointerId)
          return
        }
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [beginPinchGesture, supportsTouchGestures, isTouchPanEnabled, offset.x, offset.y],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pointers = Array.from(touchPointersRef.current.values())
      const pinch = pinchRef.current
      if (pointers.length >= 2 && pinch) {
        const [first, second] = pointers
        const distance = Math.max(1, getPointerDistance(first, second))
        const center = getRelativeCenter(event.currentTarget, first, second)
        const nextScale = clampMermaidScale(pinch.startScale * (distance / pinch.startDistance))
        const anchorX = (pinch.startCenter.x - pinch.startOffset.x) / pinch.startScale
        const anchorY = (pinch.startCenter.y - pinch.startOffset.y) / pinch.startScale

        event.preventDefault()
        setScale(nextScale)
        setOffset({
          x: center.x - anchorX * nextScale,
          y: center.y - anchorY * nextScale,
        })
        return
      }
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }, [])

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') {
      touchPointersRef.current.delete(event.pointerId)
      if (touchPointersRef.current.size < 2) pinchRef.current = null
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  useEffect(() => {
    if (isIncomplete || !code.trim()) {
      return
    }

    let cancelled = false

    async function renderDiagram() {
      try {
        const cached = getCachedMermaidSvg(`${mermaidTheme}:${code}`)
        setSvg(cached ?? '')
        setError('')
        resetView()
        if (cached !== undefined) return
        const result = await getMermaidSvg(code, mermaidTheme, renderPrefix)
        if (!cancelled) setSvg(result)
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[Markdown] Mermaid render failed:', err)
        }
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram')
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [code, isIncomplete, mermaidTheme, renderPrefix, resetView])

  if (isIncomplete) {
    return <CodeBlock code={code} language="mermaid" deferHighlight />
  }

  if (error) {
    return (
      <div className="my-4 first:mt-0 last:mb-0 rounded-md border border-danger-100/30 bg-danger-bg/40 p-3">
        <p className="mb-2 text-[length:var(--fs-sm)] font-medium text-danger-100">Mermaid render failed</p>
        <CodeBlock code={code} language="mermaid" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className="my-4 first:mt-0 last:mb-0 flex min-h-40 items-center justify-center"
        aria-label="Rendering diagram"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-400/25 border-t-text-400" />
      </div>
    )
  }

  return (
    <div
      className={`group/mermaid relative my-4 first:mt-0 last:mb-0 overflow-hidden ${preferTouchUi ? 'focus:outline-none' : ''}`}
      tabIndex={preferTouchUi ? 0 : undefined}
      onClick={preferTouchUi ? handleContainerClick : undefined}
      onBlur={preferTouchUi ? handleContainerBlur : undefined}
    >
      <div
        className={`absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 ${preferTouchUi ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'}`}
        onMouseDown={event => event.preventDefault()}
      >
        <CopyButton text={code} position="static" className={`!h-8 !w-8 !p-2 ${MERMAID_CONTROL_BUTTON_BASE_CLASS}`} />
        {preferTouchUi && (
          <button
            type="button"
            className={`${MERMAID_CONTROL_BUTTON_CLASS} ${isTouchPanEnabled ? 'ring-1 ring-accent-main-100/60 !text-accent-main-100' : ''}`}
            onClick={() => setIsTouchPanEnabled(current => !current)}
            title={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-label={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-pressed={isTouchPanEnabled}
          >
            <HandIcon />
          </button>
        )}
        {!preferTouchUi && (
          <>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(-MERMAID_SCALE_STEP)}
              disabled={scale <= MERMAID_MIN_SCALE}
              title="Zoom out"
              aria-label="Zoom out diagram"
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(MERMAID_SCALE_STEP)}
              disabled={scale >= MERMAID_MAX_SCALE}
              title="Zoom in"
              aria-label="Zoom in diagram"
            >
              <ZoomInIcon />
            </button>
          </>
        )}
        <button
          type="button"
          className={MERMAID_CONTROL_BUTTON_CLASS}
          onClick={resetView}
          title="Reset view"
          aria-label="Reset diagram view"
        >
          <RetryIcon />
        </button>
      </div>
      <div
        className={`mermaid-diagram min-h-40 min-w-fit select-none overflow-hidden p-1 [&_svg]:max-w-full [&_svg]:h-auto ${supportsTouchGestures && !isTouchPanEnabled ? 'cursor-default touch-pan-y' : 'cursor-grab touch-none active:cursor-grabbing'}`}
        role="img"
        aria-label="Mermaid diagram"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
        dangerouslySetInnerHTML={{ __html: scopedSvg }}
      />
    </div>
  )
})

// ─── Markdown Table (React) ─────────────────────────────────────

const MarkdownTable = memo(function MarkdownTable({
  children,
  isReasoning,
}: {
  children: React.ReactNode
  isReasoning: boolean
}) {
  if (isReasoning) {
    return (
      <div className="overflow-x-auto my-2 first:mt-0 last:mb-0 w-full">
        <table className="min-w-full border-collapse text-[length:var(--fs-sm)]">
          {children}
        </table>
      </div>
    )
  }

  return (
    <div className="group/table relative my-5 first:mt-0 last:mb-0 rounded-md border border-border-200/35 w-full">
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--fs-md)] border-collapse">
          {children}
        </table>
      </div>
    </div>
  )
})

function MarkdownTableCell({
  children,
  isHeader,
  isReasoning,
}: {
  children: React.ReactNode
  isHeader: boolean
  isReasoning: boolean
}) {
  if (isHeader) {
    return (
      <th
        className={isReasoning
          ? 'px-3 py-1.5 text-left text-[length:var(--fs-sm)] font-medium whitespace-nowrap border-b border-border-200/32'
          : 'relative px-3 py-2.5 text-left text-[length:var(--fs-md)] font-semibold whitespace-nowrap border-b border-border-200/38'
        }
      >
        {children}
      </th>
    )
  }
  return (
    <td
      className={isReasoning
        ? 'px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 w-max border-b border-border-200/18'
        : 'px-3 py-2 text-[length:var(--fs-md)] text-text-300 leading-[1.55] w-max border-b border-border-200/14'
      }
    >
      {children}
    </td>
  )
}

function MarkdownTableRow({ children, isReasoning }: { children: React.ReactNode; isReasoning: boolean }) {
  return (
    <tr className={isReasoning ? 'hover:bg-bg-200/10 transition-colors' : 'hover:bg-bg-200/12 transition-colors'}>
      {children}
    </tr>
  )
}

function MarkdownTableHeader({ children, isReasoning }: { children: React.ReactNode; isReasoning: boolean }) {
  return <thead className={isReasoning ? 'text-text-400' : 'text-text-200'}>{children}</thead>
}

function renderTableFromSrc(src: string, isReasoning: boolean): React.ReactNode {
  const tokens = marked.lexer(src)
  const tableToken = tokens.find(t => t.type === 'table') as Tokens.Table | undefined
  if (!tableToken) return null

  const headerTexts = tableToken.header.map(cell => cell.text)
  const rowTexts = tableToken.rows.map(row => row.map(cell => cell.text))
  const copyText = [
    `| ${headerTexts.join(' | ')} |`,
    `| ${headerTexts.map(() => '---').join(' | ')} |`,
    ...rowTexts.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')

  return (
    <MarkdownTable isReasoning={isReasoning}>
      <MarkdownTableHeader isReasoning={isReasoning}>
        <MarkdownTableRow isReasoning={isReasoning}>
          {tableToken.header.map((cell, i) => {
            const isLastHeader = i === tableToken.header.length - 1
            return (
              <MarkdownTableCell key={i} isHeader isReasoning={isReasoning}>
                {isLastHeader && copyText && !isReasoning ? (
                  <>
                    <span className="block pr-8">
                      {cell.tokens ? renderInlineTokensToReact(cell.tokens, isReasoning) : cell.text}
                    </span>
                    <span className="absolute inset-y-0 right-0 flex items-center px-2">
                      <CopyButton
                        text={copyText}
                        position="static"
                        className="!p-1 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                      />
                    </span>
                  </>
                ) : cell.tokens ? (
                  renderInlineTokensToReact(cell.tokens, isReasoning)
                ) : (
                  cell.text
                )}
              </MarkdownTableCell>
            )
          })}
        </MarkdownTableRow>
      </MarkdownTableHeader>
      <tbody>
        {tableToken.rows.map((row, rowIndex) => (
          <MarkdownTableRow key={rowIndex} isReasoning={isReasoning}>
            {row.map((cell, cellIndex) => (
              <MarkdownTableCell key={cellIndex} isHeader={false} isReasoning={isReasoning}>
                {cell.tokens ? renderInlineTokensToReact(cell.tokens, isReasoning) : cell.text}
              </MarkdownTableCell>
            ))}
          </MarkdownTableRow>
        ))}
      </tbody>
    </MarkdownTable>
  )
}

function renderInlineTokensToReact(tokens: unknown[], _isReasoning: boolean): React.ReactNode {
  return tokens.map((token, index) => {
    const item = token as Record<string, unknown>
    if (item.type === 'text') {
      const nested = item.tokens as unknown[] | undefined
      if (nested?.length) return <Fragment key={index}>{renderInlineTokensToReact(nested, _isReasoning)}</Fragment>
      return renderTextExtensionsToReact(String(item.text ?? ''), `text-${index}`, _isReasoning)
    }
    if (item.type === 'strong') return <strong key={index} className={_isReasoning ? 'font-semibold text-text-300' : 'font-semibold text-text-100'}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</strong>
    if (item.type === 'em') return <em key={index} className={_isReasoning ? 'italic text-text-300' : 'italic text-text-200'}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</em>
    if (item.type === 'del') {
      const raw = typeof item.raw === 'string' ? item.raw : ''
      if (raw.startsWith('~') && !raw.startsWith('~~') && !raw.endsWith('~~')) return <sub key={index}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</sub>
      return <del key={index} className={_isReasoning ? 'text-text-500 line-through decoration-text-500/50' : 'text-text-400 line-through decoration-text-400/50'}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</del>
    }
    if (item.type === 'codespan') return <code key={index} className={_isReasoning ? 'font-mono text-accent-main-100 text-[0.9em] align-baseline break-words' : 'text-accent-main-100 text-[0.9em] font-mono align-baseline break-words'}>{String(item.text ?? '')}</code>
    if (item.type === 'link') {
      const href = typeof item.href === 'string' ? item.href : undefined
      if (isUnsafeHrefInline(href)) return <span key={index}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)} [blocked]</span>
      const localPath = decodeLocalFileHrefInline(href) ?? getWindowsAbsolutePathInline(href)
      const className = _isReasoning
        ? 'text-[length:var(--fs-sm)] font-medium text-accent-main-200/80 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
        : 'font-medium text-accent-main-100 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
      if (localPath) {
        return (
          <a key={index} href={encodeLocalFileHrefInline(localPath)} title={localPath} className={className} onClick={e => { e.preventDefault(); openLocalFilePath(localPath) }}>
            {renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}
          </a>
        )
      }
      return <a key={index} href={href} target="_blank" rel="noopener noreferrer" className={className}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</a>
    }
    if (item.type === 'image') {
      const src = typeof item.href === 'string' ? item.href : undefined
      if (!src || isUnsafeImageSrcInline(src)) return <span key={index}>[Image blocked: {String(item.text ?? '')}]</span>
      const dimensions = inferImageDimensions(src)
      return <img key={index} src={src} alt={String(item.text ?? '')} width={dimensions?.width} height={dimensions?.height} loading="eager" decoding="async" className="block max-w-full rounded-md" />
    }
    if (item.type === 'br') return <br key={index} />
    return <span key={index}>{String(item.text ?? item.raw ?? '')}</span>
  })
}

function isEscapedTextAt(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function findUnescapedText(text: string, marker: string, start: number): number {
  let cursor = start
  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor)
    if (index === -1) return -1
    if (!isEscapedTextAt(text, index)) return index
    cursor = index + marker.length
  }
  return -1
}

function getFootnoteIdInline(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized || 'note'
}

function renderTextExtensionsToReact(text: string, keyPrefix: string, isReasoning: boolean): React.ReactNode {
  const parts: React.ReactNode[] = []
  let cursor = 0
  let lastIndex = 0

  const pushText = (end: number) => {
    if (end > lastIndex) parts.push(text.slice(lastIndex, end))
  }

  while (cursor < text.length) {
    if (isEscapedTextAt(text, cursor)) {
      cursor += 1
      continue
    }

    if (text.startsWith('[^', cursor)) {
      const close = text.indexOf(']', cursor + 2)
      const label = close === -1 ? '' : text.slice(cursor + 2, close)
      if (label && !/\s/.test(label)) {
        const id = getFootnoteIdInline(label)
        const className = isReasoning ? 'align-super text-[0.75em] text-accent-main-200/80' : 'align-super text-[0.75em] text-accent-main-100'
        pushText(cursor)
        parts.push(
          <sup key={`${keyPrefix}-fn-${cursor}`} id={`fnref-${id}`} className={className}>
            <a href={`#fn-${id}`} className="font-medium underline underline-offset-2">
              {label}
            </a>
          </sup>,
        )
        cursor = close + 1
        lastIndex = cursor
        continue
      }
    }

    if (text.startsWith('==', cursor)) {
      const close = findUnescapedText(text, '==', cursor + 2)
      const content = close === -1 ? '' : text.slice(cursor + 2, close)
      if (content && !content.includes('\n')) {
        const className = isReasoning ? 'rounded-sm bg-bg-300/70 px-0.5 text-text-300' : 'rounded-sm bg-accent-main-100/15 px-0.5 text-text-100'
        pushText(cursor)
        parts.push(
          <mark key={`${keyPrefix}-mark-${cursor}`} className={className}>
            {renderTextExtensionsToReact(content, `${keyPrefix}-mark-${cursor}`, isReasoning)}
          </mark>,
        )
        cursor = close + 2
        lastIndex = cursor
        continue
      }
    }

    if (text[cursor] === '^') {
      const close = findUnescapedText(text, '^', cursor + 1)
      const content = close === -1 ? '' : text.slice(cursor + 1, close)
      if (content && !/\s/.test(content)) {
        pushText(cursor)
        parts.push(<sup key={`${keyPrefix}-sup-${cursor}`}>{renderTextExtensionsToReact(content, `${keyPrefix}-sup-${cursor}`, isReasoning)}</sup>)
        cursor = close + 1
        lastIndex = cursor
        continue
      }
    }

    if (text[cursor] === '~' && text[cursor + 1] !== '~') {
      const close = findUnescapedText(text, '~', cursor + 1)
      const content = close === -1 ? '' : text.slice(cursor + 1, close)
      if (content && !/\s/.test(content)) {
        pushText(cursor)
        parts.push(<sub key={`${keyPrefix}-sub-${cursor}`}>{renderTextExtensionsToReact(content, `${keyPrefix}-sub-${cursor}`, isReasoning)}</sub>)
        cursor = close + 1
        lastIndex = cursor
        continue
      }
    }

    cursor += 1
  }

  pushText(text.length)
  if (parts.length === 0) return text
  if (parts.length === 1) return parts[0]
  return parts
}

function isUnsafeHrefInline(href?: string): boolean {
  if (!href) return false
  const normalized = Array.from(href.trim()).filter(char => { const code = char.charCodeAt(0); return code > 0x1f && code !== 0x7f && !/\s/.test(char) }).join('').toLowerCase()
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:')
}

function isUnsafeImageSrcInline(src?: string): boolean {
  if (!src) return false
  if (/^data:/i.test(src.trim())) return true
  return isUnsafeHrefInline(src)
}

function getWindowsAbsolutePathInline(value: string | undefined): string | null {
  if (!value) return null
  try { const decoded = decodeURIComponent(value); return /^[A-Za-z]:[\\/]/.test(decoded) ? decoded : null } catch { return value }
}

function encodeLocalFileHrefInline(filePath: string): string {
  return `${LOCAL_FILE_LINK_PREFIX}${encodeURIComponent(filePath)}`
}

function decodeLocalFileHrefInline(href?: string): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null
  try { return decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length)) } catch { return null }
}

// ─── DOM decoration (pure style, no interaction) ────────────────

function decorateMarkdownDom(root: HTMLElement) {
  root.querySelectorAll('img').forEach(image => {
    const dimensions = inferImageDimensions(image.currentSrc || image.src)
    if (dimensions && !image.hasAttribute('width') && !image.hasAttribute('height')) {
      image.width = dimensions.width
      image.height = dimensions.height
    }
    image.loading = 'eager'
    image.decoding = 'async'
  })

  root.querySelectorAll('ol').forEach(list => {
    const startAttr = list.getAttribute('start')
    const start = startAttr ? parseInt(startAttr, 10) : 1
    const itemCount = Math.max(list.children.length, 1)
    list.style.paddingInlineStart = getOrderedListPadding(start, itemCount)
  })

  root.querySelectorAll('input[type="checkbox"]').forEach(input => {
    if (!(input instanceof HTMLInputElement)) return
    input.readOnly = true
    input.className = 'mr-2 align-middle'
  })
}

// ─── DOM Island Block ───────────────────────────────────────────

const MarkdownDomBlock = memo(function MarkdownDomBlock({
  src,
  isReasoning,
  isLive,
}: {
  src: string
  isReasoning: boolean
  isLive?: boolean
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const deferredSrc = useDeferredValue(src)
  const renderSrc = isLive ? deferredSrc : src
  const html = useMemo(() => getCachedHtml(renderSrc, isReasoning), [isReasoning, renderSrc])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (!root.hasChildNodes()) {
      root.innerHTML = html
      decorateMarkdownDom(root)
      return
    }
    const next = document.createElement('div')
    next.innerHTML = html
    decorateMarkdownDom(next)
    morphdom(root, next, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.isEqualNode(toEl)) return false
        return true
      },
    })
  }, [html])

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null

    // Local file link
    const anchor = target?.closest<HTMLAnchorElement>(`a[href^="${LOCAL_FILE_LINK_PREFIX}"]`)
    const localPath = decodeLocalFileHref(anchor?.getAttribute('href') ?? undefined)
    if (anchor && localPath) {
      event.preventDefault()
      openLocalFilePath(localPath)
    }
  }, [])

  return <div ref={rootRef} className={MARKDOWN_BLOCK_CONTENT_CLASS} onClick={handleClick} />
})

// ─── Stream Block ───────────────────────────────────────────────

const MarkdownStreamBlock = memo(function MarkdownStreamBlock({
  src,
  mode,
  language,
  complete,
  isReasoning,
  isStreaming,
  isFirst,
  isLast,
}: {
  src: string
  mode: 'full' | 'live' | 'code' | 'table'
  language?: string
  complete?: boolean
  isReasoning: boolean
  isStreaming: boolean
  isFirst: boolean
  isLast: boolean
}) {
  if (mode === 'table') {
    return (
      <div className={`markdown-stream-block ${isFirst ? 'markdown-stream-block-first' : 'markdown-stream-block-not-first'} ${isLast ? 'markdown-stream-block-last' : 'markdown-stream-block-not-last'}`}>
        <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>{renderTableFromSrc(src, isReasoning)}</div>
      </div>
    )
  }

  if (mode === 'code') {
    if (language?.toLowerCase() === 'mermaid') {
      return (
        <div className={`markdown-stream-block ${isFirst ? 'markdown-stream-block-first' : 'markdown-stream-block-not-first'} ${isLast ? 'markdown-stream-block-last' : 'markdown-stream-block-not-last'}`}>
          <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>
            <MarkdownMermaid code={src} isIncomplete={isStreaming && !complete} />
          </div>
        </div>
      )
    }
    return (
      <div className={`markdown-stream-block ${isFirst ? 'markdown-stream-block-first' : 'markdown-stream-block-not-first'} ${isLast ? 'markdown-stream-block-last' : 'markdown-stream-block-not-last'}`}>
        <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>
          <div className={isReasoning ? 'my-2 first:mt-0 last:mb-0 w-full' : 'my-4 first:mt-0 last:mb-0 w-full'}>
            <CodeBlock
              code={src}
              language={language}
              variant={isReasoning ? 'reasoning' : 'default'}
              wordwrap={isReasoning}
              forceHighlight={isStreaming && isLast}
              streamingHighlight={isStreaming && isLast}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`markdown-stream-block ${isFirst ? 'markdown-stream-block-first' : 'markdown-stream-block-not-first'} ${isLast ? 'markdown-stream-block-last' : 'markdown-stream-block-not-last'}`}>
      <MarkdownDomBlock src={src} isReasoning={isReasoning} isLive={mode === 'live'} />
    </div>
  )
})

// ─── Smooth stream ──────────────────────────────────────────────

function useSmoothMarkdownStream(content: string, enabled: boolean) {
  const [displayedContent, setDisplayedContent] = useState(content)
  const displayedRef = useRef(content)
  const targetRef = useRef(content)
  const rafRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled) {
      stop()
      if (displayedRef.current !== content) {
        displayedRef.current = content
        setDisplayedContent(content)
      }
      return
    }

    targetRef.current = content
    if (content === displayedRef.current) return

    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const target = targetRef.current
      if (target === displayedRef.current) return
      displayedRef.current = target
      setDisplayedContent(target)
    })
    return stop
  }, [content, enabled, stop])

  return displayedContent
}

// ─── Main Renderer ──────────────────────────────────────────────

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  isStreaming = false,
  variant = 'default',
}: MarkdownRendererProps) {
  const isReasoning = variant === 'reasoning'
  const projectionKey = useId()
  const smoothedContent = useSmoothMarkdownStream(content, isStreaming)
  const renderedContent = isStreaming ? smoothedContent : content
  const streamBlocks = useMemo(() => {
    const projection = projectMarkdownStream(markdownProjectionCache.get(projectionKey), renderedContent, isStreaming)
    markdownProjectionCache.set(projectionKey, projection)
    return projection.blocks
  }, [projectionKey, renderedContent, isStreaming])

  useEffect(() => {
    return () => {
      markdownProjectionCache.delete(projectionKey)
    }
  }, [projectionKey])

  return (
    <div
      className={`markdown-content ${isReasoning ? 'text-[length:var(--fs-sm)] leading-5 text-text-400' : 'text-[length:var(--fs-base)] leading-relaxed text-text-100'} break-words min-w-0 overflow-hidden ${className}`}
    >
      {streamBlocks.map((block, index) => (
        <MarkdownStreamBlock
          key={block.key}
          src={block.src}
          mode={block.mode}
          language={block.language}
          complete={block.complete}
          isReasoning={isReasoning}
          isStreaming={isStreaming}
          isFirst={index === 0}
          isLast={index === streamBlocks.length - 1}
        />
      ))}
    </div>
  )
})

// ─── Standalone Code Highlighter ────────────────────────────────

export const HighlightedCode = memo(function HighlightedCode({
  code,
  filePath,
  language,
  maxHeight,
  className = '',
}: {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  className?: string
}) {
  const lang = useMemo(() => {
    return language || detectLanguage(filePath)
  }, [filePath, language])

  return (
    <div className={`overflow-auto ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <CodeBlock code={code} language={lang} />
    </div>
  )
})

export default MarkdownRenderer
