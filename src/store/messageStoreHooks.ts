// ============================================
// MessageStore React Hooks
// ============================================
//
// React 绑定层：snapshot 缓存 + useSyncExternalStore hooks
// 与 messageStore.ts 的纯 store 逻辑分离

import { useSyncExternalStore, useRef, useCallback } from 'react'
import { messageStore } from './messageStore'
import type { MessageStoreSnapshot, SessionStateSnapshot } from './messageStoreTypes'

// ============================================
// Snapshot Cache (避免 useSyncExternalStore 无限循环)
// ============================================

let cachedSnapshot: MessageStoreSnapshot | null = null

function createSnapshot(): MessageStoreSnapshot {
  return {
    sessionId: messageStore.getCurrentSessionId(),
    messages: messageStore.getVisibleMessages(),
    isStreaming: messageStore.getIsStreaming(),
    revertState: messageStore.getRevertState(),
    hasMoreHistory: messageStore.getHasMoreHistory(),
    sessionDirectory: messageStore.getSessionDirectory(),
    sessionTitle: messageStore.getSessionTitle(),
    shareUrl: messageStore.getShareUrl(),
    canUndo: messageStore.canUndo(),
    canRedo: messageStore.canRedo(),
    redoSteps: messageStore.getRedoSteps(),
    revertedContent: messageStore.getCurrentRevertedContent(),
    loadState: messageStore.getLoadState(),
  }
}

function getSnapshot(): MessageStoreSnapshot {
  if (cachedSnapshot === null) {
    cachedSnapshot = createSnapshot()
  }
  return cachedSnapshot
}

// 订阅 store 变化，清除缓存
messageStore.subscribe(() => {
  cachedSnapshot = null
})

// ============================================
// React Hooks
// ============================================

/**
 * React hook to subscribe to message store
 * (Global / Current Session)
 */
export function useMessageStore(): MessageStoreSnapshot {
  return useSyncExternalStore(onStoreChange => messageStore.subscribe(onStoreChange), getSnapshot, getSnapshot)
}

/**
 * 选择器模式 - 只订阅需要的字段，减少不必要的重渲染
 *
 * @example
 * // 只订阅 sessionId 和 isStreaming
 * const { sessionId, isStreaming } = useMessageStoreSelector(
 *   state => ({ sessionId: state.sessionId, isStreaming: state.isStreaming })
 * )
 */
export function useMessageStoreSelector<T>(
  selector: (state: MessageStoreSnapshot) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual,
): T {
  const prevResultRef = useRef<T | undefined>(undefined)

  const getSelectedSnapshot = useCallback(() => {
    const fullSnapshot = getSnapshot()
    const newResult = selector(fullSnapshot)

    // 如果结果相等，返回之前的引用以避免重渲染
    if (prevResultRef.current !== undefined && equalityFn(prevResultRef.current, newResult)) {
      return prevResultRef.current
    }

    prevResultRef.current = newResult
    return newResult
  }, [selector, equalityFn])

  return useSyncExternalStore(
    onStoreChange => messageStore.subscribe(onStoreChange),
    getSelectedSnapshot,
    getSelectedSnapshot,
  )
}

/**
 * 浅比较两个对象
 */
function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false

  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)

  if (keysA.length !== keysB.length) return false

  const recordA = a as Record<string, unknown>
  const recordB = b as Record<string, unknown>

  for (const key of keysA) {
    if (recordA[key] !== recordB[key]) return false
  }

  return true
}

// 缓存：sessionId -> Snapshot
const sessionSnapshots = new Map<string, SessionStateSnapshot>()

// 订阅 store 变化，清除相关缓存
messageStore.subscribe(() => {
  sessionSnapshots.clear()
})

/**
 * React hook to subscribe to a SPECIFIC session state
 */
export function useSessionState(sessionId: string | null): SessionStateSnapshot | null {
  const getSessionSnapshot = (): SessionStateSnapshot | null => {
    if (!sessionId) return null

    // 如果缓存中有，直接返回
    if (sessionSnapshots.has(sessionId)) {
      return sessionSnapshots.get(sessionId) ?? null
    }

    const state = messageStore.getSessionState(sessionId)
    if (!state) return null

    // 构建 snapshot 并缓存
    const snapshot = {
      messages: state.messages,
      isStreaming: state.isStreaming,
      loadState: state.loadState,
      revertState: state.revertState,
      canUndo: state.messages.some(m => m.info.role === 'user' && !state.isStreaming),
    }

    sessionSnapshots.set(sessionId, snapshot)
    return snapshot
  }

  return useSyncExternalStore(
    onStoreChange => messageStore.subscribe(onStoreChange),
    getSessionSnapshot,
    getSessionSnapshot,
  )
}

// ============================================
// 便捷选择器 Hooks
// ============================================

/** 只订阅 sessionId */
export function useCurrentSessionId(): string | null {
  return useMessageStoreSelector(state => state.sessionId)
}

/** 只订阅 isStreaming */
export function useIsStreaming(): boolean {
  return useMessageStoreSelector(state => state.isStreaming)
}

/** 只订阅 messages */
export function useMessages(): Message[] {
  return useMessageStoreSelector(
    state => state.messages,
    (a, b) => a === b,
  )
}

/** 只订阅 canUndo/canRedo */
export function useUndoRedoState() {
  return useMessageStoreSelector(state => ({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    redoSteps: state.redoSteps,
  }))
}

// Re-export types for convenience
import type { Message } from '../types/message'
export type { MessageStoreSnapshot, SessionStateSnapshot }
