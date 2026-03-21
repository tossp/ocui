import { memo, useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolPart, StepFinishPart, TextPart } from '../../../types/message'
import type { Message } from '../../../types/message'
import { useDelayedRender, useResponsiveMaxHeight } from '../../../hooks'
import { formatToolName, formatDuration } from '../../../utils/formatUtils'
import {
  extractToolData,
  getToolConfig,
  getToolCategory,
  DefaultRenderer,
  TodoRenderer,
  hasTodos,
  categorizeTools,
} from '../tools'
import { SmoothHeight } from '../../../components/ui'
import { ContentBlock } from '../../../components'
import { ExternalLinkIcon, StopIcon } from '../../../components/Icons'
import { StepFinishPartView } from './StepFinishPartView'
import { useAmbientPermission, findPermissionForTool, findQuestionForTool } from '../../chat/AmbientPermissionContext'
import { InlinePermission } from '../../chat/InlinePermission'
import { InlineQuestion } from '../../chat/InlineQuestion'
import { useSessionState, messageStore, childSessionStore } from '../../../store'
import { abortSession, getSessionMessages } from '../../../api'
import { sessionErrorHandler } from '../../../utils'

// ============================================
// AmbientToolGroup — 融入正文的工具调用摘要
//
// 设计原则：
// 1. 和正文同字号、同行高、同 font-family、同字体样式
// 2. 用 text-300 略淡于正文，但不跳出阅读流
// 3. running 时用 reasoning-shimmer-text 扫光动画
// 4. 错误信息自然融入句子："执行了 8 次，失败 1 次"
// 5. 没有 icon、没有箭头、没有控件外观
// ============================================

interface AmbientToolGroupProps {
  parts: ToolPart[]
  stepFinish?: StepFinishPart
  duration?: number
  turnDuration?: number
  isStreaming?: boolean
}

export const AmbientToolGroup = memo(function AmbientToolGroup({
  parts,
  stepFinish,
  duration,
  turnDuration,
  isStreaming,
}: AmbientToolGroupProps) {
  const { t } = useTranslation('message')

  const hasRunning = parts.some(p => p.state.status === 'running' || p.state.status === 'pending')
  const errorCount = parts.filter(p => p.state.status === 'error').length

  // 如果组内有 pending 权限/提问，强制展开（用户必须交互，不可收起）
  const { pendingPermissions, pendingQuestions } = useAmbientPermission()
  const hasPendingInteraction = parts.some(p => {
    const childSessionId = getTaskChildSessionId(p)
    return (
      findPermissionForTool(pendingPermissions, p.callID, childSessionId) ||
      findQuestionForTool(pendingQuestions, p.callID, childSessionId)
    )
  })

  // 新内容（streaming）：编辑/写入/todo 默认展开，其他收起
  // question 不在这里——它靠 hasPendingInteraction 驱动，回答后自动收起
  // 历史加载（非 streaming）：全部收起
  const needsUserAttention =
    !!isStreaming &&
    parts.some(p => {
      const cat = getToolCategory(p.tool)
      return cat === 'edit' || cat === 'todo'
    })

  const [expanded, setExpanded] = useState(needsUserAttention)
  const effectiveExpanded = expanded || hasPendingInteraction
  const shouldRenderBody = useDelayedRender(effectiveExpanded)

  // 按实际状态分组统计
  const summaryText = useMemo(() => {
    const doneParts = parts.filter(p => p.state.status === 'completed' || p.state.status === 'error')
    const activeParts = parts.filter(p => p.state.status === 'running' || p.state.status === 'pending')

    const segments: string[] = []

    if (doneParts.length > 0) {
      const cats = categorizeTools(doneParts.map(p => p.tool))
      segments.push(cats.map(({ category, count }) => t(`ambient.${category}`, { count })).join(t('ambient.separator')))
    }

    if (activeParts.length > 0) {
      const cats = categorizeTools(activeParts.map(p => p.tool))
      segments.push(
        cats
          .map(({ category, count }) =>
            t(`ambient.${category}_active`, { count, defaultValue: t(`ambient.${category}`, { count }) }),
          )
          .join(t('ambient.separator')),
      )
    }

    let text = segments.join(t('ambient.separator'))

    if (errorCount > 0) {
      text += t('ambient.errorSuffix', { count: errorCount })
    }

    if (hasRunning) {
      text += t('ambient.runningSuffix')
    }

    return text
  }, [parts, errorCount, hasRunning, t])

  // 摘要文案变化时的淡入过渡
  const summaryRef = useRef<HTMLSpanElement>(null)
  const prevTextRef = useRef(summaryText)
  useEffect(() => {
    if (prevTextRef.current !== summaryText && summaryRef.current) {
      prevTextRef.current = summaryText
      const el = summaryRef.current
      el.style.opacity = '0.4'
      requestAnimationFrame(() => {
        el.style.transition = 'opacity 0.3s ease-out'
        el.style.opacity = '1'
      })
    }
  }, [summaryText])

  // 扫光：有 running 的工具
  const showShimmer = hasRunning

  return (
    <SmoothHeight isActive={!!isStreaming}>
      <div className="py-1">
        {/* 摘要 — 纯文字，点击展开 */}
        <span
          ref={summaryRef}
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded)
          }}
          aria-expanded={effectiveExpanded}
          className={`text-sm leading-5 cursor-pointer hover:text-text-200 transition-colors ${
            showShimmer ? 'reasoning-shimmer-text' : 'text-text-300'
          }`}
        >
          {summaryText}
        </span>

        {/* 展开后的工具详情列表 */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            effectiveExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
            {shouldRenderBody && (
              <div className="flex flex-col">
                {parts.map(part => (
                  <AmbientToolItem key={part.id} part={part} />
                ))}
              </div>
            )}
          </div>
        </div>

        {stepFinish && (
          <div className="mt-1">
            <StepFinishPartView part={stepFinish} duration={duration} turnDuration={turnDuration} />
          </div>
        )}
      </div>
    </SmoothHeight>
  )
})

// ============================================
// AmbientToolItem — 工具列表中的一行
// 每个工具有独立的展开/收起，和经典模式 ToolPartView 一致
// running/pending 默认展开，completed 默认收起
// ============================================

const AmbientToolItem = memo(function AmbientToolItem({ part }: { part: ToolPart }) {
  const { state, tool: toolName } = part
  const title = state.title || ''
  const dur = state.time?.start && state.time?.end ? state.time.end - state.time.start : undefined
  const isActive = state.status === 'running' || state.status === 'pending'
  const isError = state.status === 'error'

  // 展开/收起：running 默认展开
  const [expanded, setExpanded] = useState(() => isActive)
  const toggle = useCallback(() => setExpanded(prev => !prev), [])

  // running 时自动展开
  useEffect(() => {
    if (isActive) setExpanded(true)
  }, [isActive])

  const shouldRenderBody = useDelayedRender(expanded)

  // 关联的权限请求 / 提问请求
  const { pendingPermissions, pendingQuestions, onPermissionReply, onQuestionReply, onQuestionReject, isReplying } =
    useAmbientPermission()
  const childSessionId = getTaskChildSessionId(part)
  const permissionRequest = findPermissionForTool(pendingPermissions, part.callID, childSessionId)
  const questionRequest = findQuestionForTool(pendingQuestions, part.callID, childSessionId)

  // 有 pending permission/question 时强制展开
  const hasPending = !!permissionRequest || !!questionRequest
  const effectiveExpanded = expanded || hasPending

  // 有 pending question/permission 时，直接渲染 inline UI（不走 body 折叠）
  if (permissionRequest) {
    return (
      <div className="min-w-0 py-1">
        <InlinePermission request={permissionRequest} onReply={onPermissionReply} isReplying={isReplying} />
      </div>
    )
  }

  if (questionRequest) {
    return (
      <div className="min-w-0 py-1">
        <InlineQuestion
          request={questionRequest}
          onReply={onQuestionReply}
          onReject={onQuestionReject}
          isReplying={isReplying}
        />
      </div>
    )
  }

  return (
    <div className="min-w-0">
      {/* 工具名行 — 可点击切换展开 */}
      <div
        className="flex items-center gap-1.5 w-full text-left py-1 cursor-pointer hover:bg-bg-200/30 rounded-md transition-colors -mx-1 px-1"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') toggle()
        }}
      >
        <span
          className={`text-sm leading-5 shrink-0 ${
            isActive ? 'reasoning-shimmer-text' : isError ? 'text-danger-100' : 'text-text-400'
          }`}
        >
          {formatToolName(toolName)}
        </span>

        {title && <span className="text-sm leading-5 text-text-400 truncate min-w-0 flex-1 opacity-60">{title}</span>}

        <span className="inline-flex items-center gap-1.5 ml-auto shrink-0">
          {dur !== undefined && state.status === 'completed' && (
            <span className="text-[12px] text-text-500 tabular-nums">{formatDuration(dur)}</span>
          )}
        </span>
      </div>

      {/* Body — grid collapse 动画 */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          effectiveExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div>
              <AmbientToolBody part={part} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// AmbientToolBody — 复用现有 renderer，沉浸模式只去掉 input
// edit/write 的 diff、files、diagnostics 全部保留
// ============================================

function AmbientToolBody({ part }: { part: ToolPart }) {
  const { tool } = part
  const lowerTool = tool.toLowerCase()
  const data = extractToolData(part)

  // Task：ambient 专用渲染（不复用经典 TaskRenderer）
  if (lowerTool === 'task') {
    return <AmbientTaskBody part={part} />
  }

  if (lowerTool.includes('todo') && hasTodos(part)) {
    return <TodoRenderer part={part} data={data} />
  }

  // 其他工具：用 DefaultRenderer 的 ambientMode，去掉 input，保留完整 output
  const config = getToolConfig(tool)
  if (config?.renderer) {
    const CustomRenderer = config.renderer
    return <CustomRenderer part={part} data={data} />
  }

  return <DefaultRenderer part={part} data={data} ambientMode />
}

// ============================================
// AmbientTaskBody — 沉浸模式下的 Task 渲染
//
// 不复用经典 TaskRenderer，因为外层 AmbientToolItem 已有展开/收起。
// 只负责：agent badge + description 链接 + 子 session 内容 + 结果/错误
// ============================================

const EMPTY_MESSAGES: Message[] = []

const AmbientTaskBody = memo(function AmbientTaskBody({ part }: { part: ToolPart }) {
  const { t } = useTranslation('message')
  const { state } = part

  const input = state.input as Record<string, unknown> | undefined
  const description = (input?.description as string) || t('task.subtask')
  const agentType = (input?.subagent_type as string) || 'general'

  const metadata = state.metadata as Record<string, unknown> | undefined
  const targetSessionId = metadata?.sessionId as string | undefined

  const isRunning = state.status === 'running' || state.status === 'pending'
  const isCompleted = state.status === 'completed'
  const isError = state.status === 'error'

  const handleOpenSession = useCallback(() => {
    if (!targetSessionId) return
    const childInfo = childSessionStore.getSessionInfo(targetSessionId)
    const parentSessionId = childInfo?.parentID || messageStore.getCurrentSessionId()
    const parentState = parentSessionId ? messageStore.getSessionState(parentSessionId) : null
    const directory = parentState?.directory || ''
    const hash = directory ? `#/session/${targetSessionId}?dir=${directory}` : `#/session/${targetSessionId}`
    window.location.hash = hash
  }, [targetSessionId])

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!targetSessionId) return
      const childInfo = childSessionStore.getSessionInfo(targetSessionId)
      const parentSessionId = childInfo?.parentID || messageStore.getCurrentSessionId()
      const parentState = parentSessionId ? messageStore.getSessionState(parentSessionId) : null
      const directory = parentState?.directory || ''
      abortSession(targetSessionId, directory)
    },
    [targetSessionId],
  )

  return (
    <div className="space-y-2">
      {/* Agent 类型 + 描述 */}
      <div className="flex items-center gap-2 text-sm leading-5">
        <span
          className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
            isRunning
              ? 'bg-accent-main-100/15 text-accent-main-100'
              : isError
                ? 'bg-danger-100/15 text-danger-100'
                : isCompleted
                  ? 'bg-accent-secondary-100/15 text-accent-secondary-100'
                  : 'bg-bg-300 text-text-300'
          }`}
        >
          {agentType}
        </span>

        {targetSessionId ? (
          <span
            role="link"
            tabIndex={0}
            className="text-text-300 hover:text-text-100 cursor-pointer transition-colors truncate flex-1 min-w-0"
            onClick={handleOpenSession}
            onKeyDown={e => {
              if (e.key === 'Enter') handleOpenSession()
            }}
          >
            {description}
            <ExternalLinkIcon size={10} className="inline ml-1 opacity-40" />
          </span>
        ) : (
          <span className={`text-text-300 truncate flex-1 min-w-0 ${isRunning ? 'reasoning-shimmer-text' : ''}`}>
            {description}
          </span>
        )}

        {isRunning && (
          <div
            role="button"
            onClick={handleStop}
            className="shrink-0 w-[18px] h-[18px] flex items-center justify-center bg-accent-main-000 hover:bg-accent-main-200 text-oncolor-100 rounded-sm transition-all active:scale-90 cursor-pointer"
            title={t('task.stop')}
          >
            <StopIcon size={10} />
          </div>
        )}
      </div>

      {/* 子 session 消息流 */}
      {targetSessionId && <AmbientSubSessionView sessionId={targetSessionId} />}

      {/* 完成时的输出 */}
      {isCompleted && state.output !== undefined && state.output !== null && (
        <ContentBlock
          label={t('task.result')}
          content={typeof state.output === 'string' ? state.output : JSON.stringify(state.output, null, 2)}
          defaultCollapsed={true}
        />
      )}

      {/* 错误信息 */}
      {isError && state.error !== undefined && (
        <ContentBlock
          label={t('task.error')}
          content={typeof state.error === 'string' ? state.error : JSON.stringify(state.error)}
          variant="error"
        />
      )}
    </div>
  )
})

// ============================================
// AmbientSubSessionView — 子 session 消息的紧凑展示
// ============================================

const AmbientSubSessionView = memo(function AmbientSubSessionView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('message')
  const loadedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const subSessionMaxHeight = useResponsiveMaxHeight(0.25, 120, 240)

  const sessionState = useSessionState(sessionId)
  const messages = sessionState?.messages ?? EMPTY_MESSAGES
  const isStreaming = sessionState?.isStreaming || false
  const isLoading = sessionState?.loadState === 'loading'

  useEffect(() => {
    if (loadedRef.current) return
    const state = messageStore.getSessionState(sessionId)
    if (state && (state.messages.length > 0 || state.isStreaming)) {
      loadedRef.current = true
      return
    }
    loadedRef.current = true
    messageStore.setLoadState(sessionId, 'loading')
    getSessionMessages(sessionId, 20)
      .then(apiMessages => {
        const currentState = messageStore.getSessionState(sessionId)
        if (currentState && currentState.messages.length > apiMessages.length) {
          messageStore.setLoadState(sessionId, 'loaded')
          return
        }
        messageStore.setMessages(sessionId, apiMessages, {
          directory: '',
          hasMoreHistory: apiMessages.length >= 20,
        })
      })
      .catch(err => {
        sessionErrorHandler('load sub-session', err)
        messageStore.setLoadState(sessionId, 'error')
      })
  }, [sessionId])

  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  const visibleMessages = messages.filter((msg: Message) =>
    msg.parts.some((p: Message['parts'][0]) => {
      if (p.type === 'text') return (p as TextPart).text?.trim()
      if (p.type === 'tool') return true
      if (p.type === 'reasoning') return true
      return false
    }),
  )

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="w-3 h-3 rounded-full bg-bg-300 animate-pulse" />
        <div className="h-3 rounded bg-bg-300 animate-pulse flex-1 max-w-[120px]" />
      </div>
    )
  }

  if (visibleMessages.length === 0) {
    return <div className="text-xs text-text-500 italic py-1">{t('task.waitingForResponse')}</div>
  }

  return (
    <div
      ref={scrollRef}
      className="rounded-lg bg-bg-100/50 border border-border-200/30 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1.5"
      style={{ maxHeight: subSessionMaxHeight }}
    >
      {visibleMessages.map((msg: Message) => {
        const textParts = msg.parts.filter((p): p is TextPart => p.type === 'text' && !!p.text?.trim())
        const toolParts = msg.parts.filter((p): p is ToolPart => p.type === 'tool')
        const textContent = textParts
          .map(p => p.text)
          .join('\n')
          .trim()

        if (msg.info.role === 'user') {
          return (
            <div key={msg.info.id} className="flex justify-end">
              <div className="max-w-[85%] px-2.5 py-1.5 rounded-lg bg-bg-300 text-text-100 text-[11px] whitespace-pre-wrap break-words">
                {textContent}
              </div>
            </div>
          )
        }

        return (
          <div key={msg.info.id} className="space-y-1">
            {textContent && (
              <div className="text-[11px] text-text-200 leading-relaxed whitespace-pre-wrap">
                {textContent.length > 500 ? textContent.slice(0, 500) + '...' : textContent}
              </div>
            )}
            {toolParts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {toolParts.map(tool => (
                  <span
                    key={tool.id}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-mono ${
                      tool.state.status === 'running' || tool.state.status === 'pending'
                        ? 'bg-accent-main-100/10 text-accent-main-100'
                        : tool.state.status === 'error'
                          ? 'bg-danger-100/10 text-danger-100'
                          : 'bg-bg-300/60 text-text-400'
                    }`}
                  >
                    {formatToolName(tool.tool)}
                    {tool.state.title && <span className="opacity-60 max-w-[100px] truncate">{tool.state.title}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

// ============================================
// Helpers
// ============================================

/** 对 task tool，从 metadata 中提取子 session ID */
function getTaskChildSessionId(part: ToolPart): string | undefined {
  if (part.tool.toLowerCase() !== 'task') return undefined
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  return metadata?.sessionId as string | undefined
}

// (end of file)
