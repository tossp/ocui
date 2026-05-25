import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../../types/message'
import { buildOutlineSourceEntries, type OutlineSourceEntry } from '../../components/OutlineIndex'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { buildTurnDurationMap, reconcileStableChatPages, type StableChatPage } from './chatPageModel'

export interface ChatPageViewModel {
  visibleMessages: Message[]
  pageRecords: StableChatPage[]
  outlineSourceEntries: OutlineSourceEntry[]
  forkTargetIdMap: Map<string, string | undefined>
  turnDurationMap: Map<string, number>
}

function arePageRecordsEquivalent(previous: StableChatPage[], next: StableChatPage[]): boolean {
  if (previous === next) return true
  if (previous.length !== next.length) return false

  for (let pageIndex = 0; pageIndex < previous.length; pageIndex++) {
    const previousPage = previous[pageIndex]
    const nextPage = next[pageIndex]
    if (previousPage.key !== nextPage.key) return false
    if (previousPage.rows.length !== nextPage.rows.length) return false

    for (let rowIndex = 0; rowIndex < previousPage.rows.length; rowIndex++) {
      const previousRow = previousPage.rows[rowIndex]
      const nextRow = nextPage.rows[rowIndex]
      if (previousRow.key !== nextRow.key) return false
      if (previousRow.messages.length !== nextRow.messages.length) return false

      for (let messageIndex = 0; messageIndex < previousRow.messages.length; messageIndex++) {
        if (previousRow.messages[messageIndex] !== nextRow.messages[messageIndex]) return false
      }
    }
  }

  return true
}

export function useChatPageViewModel(messages: Message[]): ChatPageViewModel {
  const pageKeyCounterRef = useRef(0)
  const allocatePageKey = useCallback(() => `chat-page:${pageKeyCounterRef.current++}`, [])

  const visibleMessageEntries = useMemo(() => buildVisibleMessageEntries(messages), [messages])
  const visibleMessages = useMemo(() => visibleMessageEntries.map(entry => entry.message), [visibleMessageEntries])
  const forkTargetIdMap = useMemo(
    () => new Map(visibleMessageEntries.map(entry => [entry.message.info.id, getVisibleMessageForkTargetId(entry)])),
    [visibleMessageEntries],
  )
  const outlineSourceEntries = useMemo(() => buildOutlineSourceEntries(visibleMessages), [visibleMessages])
  const turnDurationMap = useMemo(() => buildTurnDurationMap(messages, visibleMessages), [messages, visibleMessages])
  const [pageRecords, setPageRecords] = useState<StableChatPage[]>(() =>
    reconcileStableChatPages({ currentPages: [], nextMessages: visibleMessages, allocateKey: allocatePageKey }),
  )

  useLayoutEffect(() => {
    setPageRecords(currentPages => {
      const nextPages = reconcileStableChatPages({
        currentPages,
        nextMessages: visibleMessages,
        allocateKey: allocatePageKey,
      })
      return arePageRecordsEquivalent(currentPages, nextPages) ? currentPages : nextPages
    })
  }, [allocatePageKey, visibleMessages])

  return { visibleMessages, pageRecords, outlineSourceEntries, forkTargetIdMap, turnDurationMap }
}
