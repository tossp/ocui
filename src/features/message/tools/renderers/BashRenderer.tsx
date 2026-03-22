/**
 * BashRenderer - Bash 工具专用渲染器
 *
 * 整体终端风格：
 * - 统一背景，命令和输出连续排列
 * - $ prompt + 命令
 * - 输出支持 ANSI 颜色
 * - 运行中用光标闪烁
 * - exit code 非 0 时内联显示
 */

import { useMemo } from 'react'
import { CopyButton } from '../../../../components/ui'
import { useSyntaxHighlight } from '../../../../hooks/useSyntaxHighlight'
import { parseAnsi, stripAnsi, type AnsiSegment } from '../../../../utils/ansiUtils'
import type { ToolRendererProps } from '../types'

// ============================================
// Main
// ============================================

export function BashRenderer({ part, data }: ToolRendererProps) {
  const { state } = part
  const isActive = state.status === 'running' || state.status === 'pending'
  const hasError = !!data.error
  const command = data.input?.trim()
  const output = data.output?.trim()
  const exitCode = data.exitCode

  // 解析 ANSI
  const outputSegments = useMemo(() => {
    if (!output) return null
    return parseAnsi(output)
  }, [output])

  const plainOutput = useMemo(() => {
    if (!output) return ''
    return stripAnsi(output)
  }, [output])

  // 空状态
  if (!isActive && !hasError && !command && !output) {
    return null
  }

  return (
    <div className="rounded-lg border border-border-200/40 bg-bg-100 overflow-hidden font-mono text-[11px] leading-[1.6] group/terminal relative">
      <CopyButton
        text={[command && `$ ${command}`, plainOutput, data.error].filter(Boolean).join('\n')}
        position="absolute"
        groupName="terminal"
      />

      <div className="px-3 py-2 space-y-0.5">
        {/* $ command — Shiki 语法高亮 */}
        {command && (
          <div className="flex items-start gap-1.5">
            <span className="text-accent-main-100 shrink-0 select-none font-semibold">$</span>
            <HighlightedCommand command={command} />
          </div>
        )}

        {/* 光标：命令后、输出前，独占一行闪烁 */}
        {isActive && !output && !hasError && (
          <div>
            <TerminalCursor />
          </div>
        )}

        {/* 输出 */}
        {outputSegments && outputSegments.length > 0 && (
          <div className="text-text-300 whitespace-pre-wrap break-all">
            <AnsiOutput segments={outputSegments} />
            {/* 还在运行，输出末尾闪光标 */}
            {isActive && <TerminalCursor />}
          </div>
        )}

        {/* Error */}
        {hasError && <div className="text-danger-100 whitespace-pre-wrap break-all">{data.error}</div>}
      </div>

      {/* Exit code — 只在非 0 时显示 */}
      {exitCode !== undefined && exitCode !== 0 && !isActive && (
        <div className="px-3 pb-2 text-[10px] text-warning-100">exit {exitCode}</div>
      )}
    </div>
  )
}

// ============================================
// Highlighted Command (Shiki)
// ============================================

function HighlightedCommand({ command }: { command: string }) {
  const { output: highlighted } = useSyntaxHighlight(command, { lang: 'bash' })

  if (highlighted) {
    return (
      <span
        className="whitespace-pre-wrap break-all [&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0 [&_code]:!bg-transparent [&_code]:!p-0"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    )
  }

  // fallback: 高亮还没加载时用纯文本
  return <span className="text-text-100 whitespace-pre-wrap break-all">{command}</span>
}

// ============================================
// Terminal Cursor (blinking block)
// ============================================

function TerminalCursor() {
  return (
    <span
      className="inline-block w-[6px] h-[14px] bg-text-300 rounded-[1px] align-middle ml-px"
      style={{ animation: 'terminal-blink 1s step-end infinite' }}
    />
  )
}

// ============================================
// ANSI Output
// ============================================

function AnsiOutput({ segments }: { segments: AnsiSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.fg && !seg.bold && !seg.dim && !seg.italic) {
          return <span key={i}>{seg.text}</span>
        }

        const style: React.CSSProperties = {}
        if (seg.fg) style.color = seg.fg
        if (seg.bold) style.fontWeight = 600
        if (seg.dim) style.opacity = 0.6
        if (seg.italic) style.fontStyle = 'italic'

        return (
          <span key={i} style={style}>
            {seg.text}
          </span>
        )
      })}
    </>
  )
}
