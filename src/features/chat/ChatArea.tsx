// ============================================
// ChatArea - 聊天消息显示区域
// ============================================
//
// 简单的滚动容器 + overflow-y:auto
// - IntersectionObserver 触发 loadMore
// - useLayoutEffect 补偿 prepend 滚动偏移
// - setInterval 在 streaming 时自动滚动到底部

import {
  useRef,
  useImperativeHandle,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { animate } from 'motion/mini'
import { MessageRenderer } from '../message'
import { messageStore } from '../../store'
import { useTheme } from '../../hooks/useTheme'
import type { Message } from '../../types/message'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'
import { buildVisibleMessageEntries } from './chatAreaVisibility'
import { AT_BOTTOM_THRESHOLD_PX } from '../../constants'
import { useIsMobile } from '../../hooks'

interface ChatAreaProps {
  messages: Message[]
  sessionId?: string | null
  isStreaming?: boolean
  loadState?: 'idle' | 'loading' | 'loaded' | 'error'
  hasMoreHistory?: boolean
  onLoadMore?: () => void | Promise<void>
  onUndo?: (userMessageId: string) => void
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
  retryStatus?: RetryStatusInlineData | null
  bottomPadding?: number
  onVisibleMessageIdsChange?: (ids: string[]) => void
  onAtBottomChange?: (atBottom: boolean) => void
}

export type ChatAreaHandle = {
  scrollToBottom: (instant?: boolean) => void
  scrollToBottomIfAtBottom: () => void
  scrollToLastMessage: () => void
  suppressAutoScroll: (duration?: number) => void
  scrollToMessageIndex: (index: number) => void
  scrollToMessageId: (messageId: string) => void
}

export const ChatArea = memo(
  forwardRef<ChatAreaHandle, ChatAreaProps>(
    (
      {
        messages,
        sessionId,
        isStreaming: _isStreaming = false,
        loadState = 'idle',
        onLoadMore,
        onUndo,
        canUndo,
        hasMoreHistory: _hasMoreHistory = false,
        registerMessage,
        retryStatus = null,
        bottomPadding = 0,
        onVisibleMessageIdsChange,
        onAtBottomChange,
      },
      ref,
    ) => {
      // ---- Refs ----
      const scrollRef = useRef<HTMLDivElement>(null)
      const topSentinelRef = useRef<HTMLDivElement>(null)
      const isAtBottomRef = useRef(true)
      const suppressScrollRef = useRef(false)
      const loadMoreRef = useRef(onLoadMore)
      loadMoreRef.current = onLoadMore
      const isLoadingRef = useRef(false)
      const messagesRef = useRef<HTMLDivElement>(null)
      const [isLoadingMore, setIsLoadingMore] = useState(false)
      // prepend 补偿用
      const prevScrollHeightRef = useRef(0)
      const prevFirstIdRef = useRef<string | null>(null)

      const { isWideMode } = useTheme()
      const isMobile = useIsMobile()
      const atBottomThreshold = isMobile ? 150 : AT_BOTTOM_THRESHOLD_PX

      // ---- Data ----
      const visibleMessageEntries = useMemo(() => buildVisibleMessageEntries(messages), [messages])
      const visibleMessages = useMemo(() => visibleMessageEntries.map(e => e.message), [visibleMessageEntries])

      const turnDurationMap = useMemo(() => {
        const map = new Map<string, number>()
        for (let i = 0; i < visibleMessages.length; i++) {
          if (visibleMessages[i].info.role !== 'user') continue
          const userCreated = visibleMessages[i].info.time.created
          let lastAssistant: Message | undefined
          for (let j = i + 1; j < visibleMessages.length && visibleMessages[j].info.role !== 'user'; j++) {
            lastAssistant = visibleMessages[j]
          }
          if (lastAssistant?.info.time.completed) {
            map.set(lastAssistant.info.id, lastAssistant.info.time.completed - userCreated)
          }
        }
        return map
      }, [visibleMessages])

      const messageMaxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'

      // ============================================
      // Scroll: isAtBottom tracking
      // ============================================

      useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const onScroll = () => {
          // 内容没有溢出时（scrollHeight <= clientHeight），始终认为在底部
          // 类似滚动条逻辑：没有溢出就没有滚动条，也不需要 scrollToBottom 按钮
          const hasOverflow = el.scrollHeight > el.clientHeight + 1
          const atBottom = !hasOverflow || el.scrollHeight - el.scrollTop - el.clientHeight <= atBottomThreshold
          const prev = isAtBottomRef.current
          isAtBottomRef.current = atBottom
          if (prev !== atBottom) onAtBottomChange?.(atBottom)
        }
        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
      }, [atBottomThreshold, onAtBottomChange])

      // ============================================
      // Scroll: auto-scroll on content resize
      // ============================================
      // ResizeObserver 监听内容高度变化，实时判断是否在底部。
      // 不依赖 isAtBottomRef（scroll 事件异步更新有竞态），
      // 而是每次 resize 时用 resize 前的 scrollHeight 同步计算 gap。

      useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        // 记录上一次已知的 scrollHeight，只在内容变高时才自动滚动
        let prevScrollHeight = el.scrollHeight

        const ro = new ResizeObserver(() => {
          if (suppressScrollRef.current) return
          const currScrollHeight = el.scrollHeight
          // 只在内容变高时触发（排除折叠、删除等缩小场景）
          if (currScrollHeight <= prevScrollHeight) {
            prevScrollHeight = currScrollHeight
            return
          }
          // 用 resize 前的 scrollHeight 判断：resize 前是否在底部
          const gap = prevScrollHeight - el.scrollTop - el.clientHeight
          prevScrollHeight = currScrollHeight
          if (gap <= atBottomThreshold) {
            el.scrollTop = currScrollHeight
          }
        })

        // 监听滚动容器内所有直接子元素的尺寸变化
        for (const child of el.children) {
          ro.observe(child)
        }

        return () => ro.disconnect()
      }, [visibleMessages, atBottomThreshold])

      // ============================================
      // Session switch: snap to bottom
      // ============================================

      const prevSessionIdRef = useRef(sessionId)
      useEffect(() => {
        if (sessionId === prevSessionIdRef.current) return
        prevSessionIdRef.current = sessionId
        isAtBottomRef.current = true
        suppressScrollRef.current = false
        onAtBottomChange?.(true)

        // 延迟一帧确保 DOM 已更新
        requestAnimationFrame(() => {
          const el = scrollRef.current
          if (el) el.scrollTop = el.scrollHeight

          // 消息列表整体淡入 — 一次命令式 animate，零 React 开销
          if (messagesRef.current) {
            animate(
              messagesRef.current,
              { opacity: [0, 1] },
              {
                duration: 0.2,
                ease: 'easeOut',
              },
            )
          }
        })
      }, [sessionId, onAtBottomChange])

      // 加载完成后 snap to bottom
      useEffect(() => {
        if (loadState !== 'loaded') return
        requestAnimationFrame(() => {
          const el = scrollRef.current
          if (el && isAtBottomRef.current) el.scrollTop = el.scrollHeight
        })
      }, [loadState])

      // ============================================
      // Load more: IntersectionObserver on top sentinel
      // ============================================

      useEffect(() => {
        const sentinel = topSentinelRef.current
        const root = scrollRef.current
        if (!sentinel || !root) return

        const observer = new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting || isLoadingRef.current) return
            const fn = loadMoreRef.current
            if (!fn) return

            const sid = sessionId
            if (!sid) return
            const hasMore = messageStore.getSessionState(sid)?.hasMoreHistory ?? false
            if (!hasMore) return

            isLoadingRef.current = true
            setIsLoadingMore(true)
            // 快照 scrollHeight 用于补偿
            prevScrollHeightRef.current = root.scrollHeight
            prevFirstIdRef.current = visibleMessages[0]?.info.id ?? null

            Promise.resolve(fn()).finally(() => {
              isLoadingRef.current = false
              setIsLoadingMore(false)
            })
          },
          { root, rootMargin: '200px 0px 0px 0px' },
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
      }, [sessionId, visibleMessages])

      // ============================================
      // Prepend compensation (useLayoutEffect)
      // ============================================

      useLayoutEffect(() => {
        const el = scrollRef.current
        if (!el) return
        if (!prevFirstIdRef.current) return

        const currentFirstId = visibleMessages[0]?.info.id ?? null
        if (currentFirstId === prevFirstIdRef.current) return

        // 首条 ID 变了 = 有 prepend 发生
        const heightDiff = el.scrollHeight - prevScrollHeightRef.current
        if (heightDiff > 0) {
          el.scrollTop += heightDiff
        }

        prevFirstIdRef.current = currentFirstId
        prevScrollHeightRef.current = el.scrollHeight
      }, [visibleMessages])

      // ============================================
      // Visible message tracking (for outline)
      // ============================================

      const onVisibleIdsChangeRef = useRef(onVisibleMessageIdsChange)
      onVisibleIdsChangeRef.current = onVisibleMessageIdsChange

      useEffect(() => {
        const root = scrollRef.current
        if (!root) return

        const visibleIds = new Set<string>()
        const observer = new IntersectionObserver(
          entries => {
            let changed = false
            for (const entry of entries) {
              const id = entry.target.getAttribute('data-message-id')
              if (!id) continue
              if (entry.isIntersecting) {
                if (!visibleIds.has(id)) {
                  visibleIds.add(id)
                  changed = true
                }
              } else if (visibleIds.has(id)) {
                visibleIds.delete(id)
                changed = true
              }
            }
            if (changed) {
              onVisibleIdsChangeRef.current?.(Array.from(visibleIds))
            }
          },
          { root, rootMargin: '100% 0px' },
        )

        // Observe all current message elements
        const elements = root.querySelectorAll<HTMLElement>('[data-message-id]')
        elements.forEach(el => observer.observe(el))

        return () => observer.disconnect()
      }, [visibleMessages])

      // ============================================
      // Imperative Handle
      // ============================================

      useImperativeHandle(
        ref,
        () => ({
          scrollToBottom: (instant = false) => {
            const el = scrollRef.current
            if (!el) return
            el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' })
          },
          scrollToBottomIfAtBottom: () => {
            if (suppressScrollRef.current || !isAtBottomRef.current) return
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          },
          scrollToLastMessage: () => {
            if (visibleMessages.length === 0) return
            const lastId = visibleMessages[visibleMessages.length - 1].info.id
            scrollRef.current
              ?.querySelector(`[data-message-id="${lastId}"]`)
              ?.scrollIntoView({ block: 'start', behavior: 'auto' })
          },
          suppressAutoScroll: (duration = 500) => {
            suppressScrollRef.current = true
            setTimeout(() => {
              suppressScrollRef.current = false
            }, duration)
          },
          scrollToMessageIndex: (index: number) => {
            const msg = visibleMessages[index]
            if (!msg) return
            scrollRef.current
              ?.querySelector(`[data-message-id="${msg.info.id}"]`)
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          },
          scrollToMessageId: (messageId: string) => {
            scrollRef.current
              ?.querySelector(`[data-message-id="${messageId}"]`)
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          },
        }),
        [visibleMessages],
      )

      // ============================================
      // Render
      // ============================================

      // 将连续助手消息分组，共享容器渲染（浑然一体）
      const messageGroups = useMemo(() => {
        const groups: Message[][] = []
        for (const msg of visibleMessages) {
          const prev = groups[groups.length - 1]
          if (prev && msg.info.role === 'assistant' && prev[0].info.role === 'assistant') {
            prev.push(msg)
          } else {
            groups.push([msg])
          }
        }
        return groups
      }, [visibleMessages])

      const renderMessageGroup = useCallback(
        (messages: Message[]) => {
          const isUser = messages[0].info.role === 'user'
          return (
            <div
              className={`w-full ${messageMaxWidthClass} mx-auto px-4 py-3 transition-[max-width] duration-300 ease-in-out`}
            >
              <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`min-w-0 group ${!isUser ? 'w-full' : ''} flex flex-col gap-2`}>
                  {messages.map(msg => (
                    <div
                      key={msg.info.id}
                      ref={(el: HTMLDivElement | null) => registerMessage?.(msg.info.id, el)}
                      data-message-id={msg.info.id}
                    >
                      <MessageRenderer
                        message={msg}
                        turnDuration={turnDurationMap.get(msg.info.id)}
                        onUndo={onUndo}
                        canUndo={canUndo}
                        onEnsureParts={id => {
                          if (!sessionId) return
                          void messageStore.hydrateMessageParts(sessionId, id)
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        },
        [registerMessage, onUndo, canUndo, messageMaxWidthClass, sessionId, turnDurationMap],
      )

      return (
        <div className="h-full overflow-hidden contain-strict relative">
          {/* Session loading spinner — 延迟 150ms 显示，快速加载时不闪烁 */}
          {loadState === 'loading' && visibleMessages.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-text-400 session-loading-indicator">
                <span className="w-5 h-5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                <span className="text-sm">Loading session...</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar contain-content">
            {/* Top sentinel for loadMore */}
            <div ref={topSentinelRef} className="h-px" aria-hidden="true" />

            {/* Top spacing */}
            <div className="h-20" />

            {/* Loading more indicator */}
            {visibleMessages.length > 0 && isLoadingMore && (
              <div className="flex justify-center py-3">
                <div className="flex items-center gap-2 text-text-400 text-xs">
                  <span className="w-3.5 h-3.5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                  Loading history...
                </div>
              </div>
            )}

            {/* Messages */}
            <div ref={messagesRef}>
              {messageGroups.map(group => {
                const first = group[0]
                return (
                  <div key={first.info.id} className="chat-message-item">
                    {renderMessageGroup(group)}
                  </div>
                )
              })}
            </div>

            {/* Retry status */}
            {retryStatus && (
              <div className={`w-full ${messageMaxWidthClass} mx-auto px-4`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0">
                    <RetryStatusInline status={retryStatus} />
                  </div>
                </div>
              </div>
            )}

            {/* Bottom spacing */}
            <div
              style={{
                height: bottomPadding > 0 ? `${bottomPadding + 16}px` : '256px',
              }}
            />
          </div>
        </div>
      )
    },
  ),
)
