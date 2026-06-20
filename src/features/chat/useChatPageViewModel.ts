import { useMemo } from 'react'
import { getMessageText, type Message } from '../../types/message'
import { buildOutlineSourceEntries, type OutlineSourceEntry } from '../../components/outlineIndexModel'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { buildContentKeyedChatPages, buildTurnDurationMap, type StableChatPage } from './chatPageModel'

export interface ChatPageViewModel {
  visibleMessages: Message[]
  pageRecords: StableChatPage[]
  outlineSourceEntries: OutlineSourceEntry[]
  outlineOwnerByMessageId: Map<string, string>
  forkTargetIdMap: Map<string, string | undefined>
  turnDurationMap: Map<string, number>
}

interface StableOutlineModel {
  signature: string
  entries: OutlineSourceEntry[]
  ownerByMessageId: Map<string, string>
}

const OUTLINE_MODEL_CACHE_LIMIT = 16
const outlineModelCache = new Map<string, StableOutlineModel>()

function buildOutlineSignature(messages: Message[]): string {
  let signature = ''
  for (const message of messages) {
    signature += `${message.info.id}:${message.info.role}|`
    if (message.info.role === 'user') {
      signature += `${message.info.summary?.title ?? getMessageText(message)}|`
    }
  }
  return signature
}

function buildOutlineOwnerByMessageId(messages: Message[]): Map<string, string> {
  const ownerByMessageId = new Map<string, string>()
  let lastUserMessageId: string | null = null

  for (const message of messages) {
    if (message.info.role === 'user') lastUserMessageId = message.info.id
    if (lastUserMessageId) ownerByMessageId.set(message.info.id, lastUserMessageId)
  }

  return ownerByMessageId
}

function getStableOutlineModel(messages: Message[]): StableOutlineModel {
  const signature = buildOutlineSignature(messages)
  const cached = outlineModelCache.get(signature)
  if (cached) {
    outlineModelCache.delete(signature)
    outlineModelCache.set(signature, cached)
    return cached
  }

  const next: StableOutlineModel = {
    signature,
    entries: buildOutlineSourceEntries(messages),
    ownerByMessageId: buildOutlineOwnerByMessageId(messages),
  }
  outlineModelCache.set(signature, next)
  if (outlineModelCache.size > OUTLINE_MODEL_CACHE_LIMIT) {
    const oldestKey = outlineModelCache.keys().next().value
    if (oldestKey) outlineModelCache.delete(oldestKey)
  }
  return next
}

export function useChatPageViewModel(messages: Message[]): ChatPageViewModel {
  const visibleMessageEntries = useMemo(() => buildVisibleMessageEntries(messages), [messages])
  const visibleMessages = useMemo(() => visibleMessageEntries.map(entry => entry.message), [visibleMessageEntries])
  const pageRecords = useMemo(() => buildContentKeyedChatPages(visibleMessages), [visibleMessages])
  const forkTargetIdMap = useMemo(
    () => new Map(visibleMessageEntries.map(entry => [entry.message.info.id, getVisibleMessageForkTargetId(entry)])),
    [visibleMessageEntries],
  )
  const outlineModel = useMemo(() => getStableOutlineModel(visibleMessages), [visibleMessages])
  const turnDurationMap = useMemo(() => buildTurnDurationMap(messages, visibleMessages), [messages, visibleMessages])

  return {
    visibleMessages,
    pageRecords,
    outlineSourceEntries: outlineModel.entries,
    outlineOwnerByMessageId: outlineModel.ownerByMessageId,
    forkTargetIdMap,
    turnDurationMap,
  }
}
