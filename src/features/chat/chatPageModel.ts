import type { Message } from '../../types/message'

export const PAGE_MESSAGE_COUNT = 20
export const EXPANDED_PAGE_RADIUS = 0
export const PREMEASURE_PAGE_RADIUS = 1
export const PREMEASURE_MIN_MESSAGE_BUDGET = 20
export const PREMEASURE_MAX_MESSAGE_BUDGET = 60
const PREMEASURE_TARGET_VIEWPORTS = 2
const ESTIMATED_PREMEASURE_MESSAGE_HEIGHT = 80

export interface MessageGroupRow {
  key: string
  messages: Message[]
  messageIds: string[]
  estimatedHeight: number
}

export interface ChatPage {
  key: string
  rows: MessageGroupRow[]
  messageIds: string[]
  estimatedHeight: number
}

export interface StableChatPage extends ChatPage {
  key: string
}

export interface PageRange {
  startIndex: number
  endIndex: number
}

export type PageRenderSegment =
  | {
      kind: 'expanded'
      key: string
      page: StableChatPage
      measuredHeight: number
    }
  | {
      kind: 'collapsed'
      key: string
      height: number
    }

export type ExpandedPageSelection = Set<number>

export function computeAnchorRestoreScrollDelta(previousTopOffset: number, nextTopOffset: number): number {
  return nextTopOffset - previousTopOffset
}

function estimateMessageHeight(message: Message): number {
  if (message.info.role === 'user') {
    return Math.max(72, message.parts.length * 40)
  }
  return Math.max(160, message.parts.length * 80)
}

function estimateGroupHeight(messages: Message[]): number {
  let total = 24
  for (let index = 0; index < messages.length; index++) {
    if (index > 0) total += 8
    total += estimateMessageHeight(messages[index])
  }
  return total
}

function buildMessageGroups(messages: Message[]): MessageGroupRow[] {
  const groups: Message[][] = []
  for (const message of messages) {
    const previous = groups[groups.length - 1]
    if (previous && message.info.role === 'assistant' && previous[0].info.role === 'assistant') {
      previous.push(message)
    } else {
      groups.push([message])
    }
  }

  return groups.map(group => {
    const firstId = group[0]?.info.id ?? 'empty'
    const lastId = group[group.length - 1]?.info.id ?? firstId
    return {
      key: `${firstId}:${lastId}:${group.length}`,
      messages: group,
      messageIds: group.map(message => message.info.id),
      estimatedHeight: estimateGroupHeight(group),
    }
  })
}

export function buildChatPages(messages: Message[], pageMessageCount = PAGE_MESSAGE_COUNT): ChatPage[] {
  const rows = buildMessageGroups(messages)
  const renderPages: ChatPage[] = []

  let currentRows: MessageGroupRow[] = []
  let currentMessageCount = 0
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
    const row = rows[rowIndex]
    if (currentRows.length > 0 && currentMessageCount + row.messages.length > pageMessageCount) {
      renderPages.push(buildChatPage(currentRows))
      currentRows = []
      currentMessageCount = 0
    }
    currentRows.unshift(row)
    currentMessageCount += row.messages.length
  }

  if (currentRows.length > 0) {
    renderPages.push(buildChatPage(currentRows))
  }

  return renderPages
}

function buildChatPage(rows: MessageGroupRow[]): ChatPage {
  const messageIds = rows.flatMap(row => row.messageIds)
  const newestId = messageIds[messageIds.length - 1] ?? 'empty'
  const oldestId = messageIds[0] ?? newestId
  return {
    key: `${newestId}:${oldestId}:${messageIds.length}`,
    rows,
    messageIds,
    estimatedHeight: rows.reduce((sum, row) => sum + row.estimatedHeight, 0),
  }
}

export function buildStableChatPages(messages: Message[], allocateKey: () => string, pageMessageCount = PAGE_MESSAGE_COUNT): StableChatPage[] {
  return buildChatPages(messages, pageMessageCount).map(page => ({ ...page, key: allocateKey() }))
}

export function buildContentKeyedChatPages(messages: Message[], pageMessageCount = PAGE_MESSAGE_COUNT): StableChatPage[] {
  return buildChatPages(messages, pageMessageCount)
}

function flattenPageMessagesChronological(page: ChatPage): Message[] {
  return page.rows.flatMap(row => row.messages)
}

function flattenPagesMessageIdsChronological(pages: ChatPage[]): string[] {
  return pages
    .slice()
    .reverse()
    .flatMap(page => page.messageIds)
}

export function findMessageSequenceOffset(nextIds: string[], previousIds: string[]): number {
  if (previousIds.length === 0) return 0
  if (previousIds.length > nextIds.length) return -1

  const firstId = previousIds[0]
  for (let startIndex = 0; startIndex <= nextIds.length - previousIds.length; startIndex++) {
    if (nextIds[startIndex] !== firstId) continue

    let matches = true
    for (let index = 1; index < previousIds.length; index++) {
      if (nextIds[startIndex + index] !== previousIds[index]) {
        matches = false
        break
      }
    }
    if (matches) return startIndex
  }

  return -1
}

function rebuildPageWithFreshMessages(page: StableChatPage, nextById: Map<string, Message>): StableChatPage {
  const rows = page.rows.map(row => {
    const messages = row.messages.map(message => nextById.get(message.info.id) ?? message)
    return {
      key: row.key,
      messages,
      messageIds: messages.map(message => message.info.id),
      estimatedHeight: estimateGroupHeight(messages),
    }
  })

  return {
    key: page.key,
    rows,
    messageIds: rows.flatMap(row => row.messageIds),
    estimatedHeight: rows.reduce((sum, row) => sum + row.estimatedHeight, 0),
  }
}

export function reconcileStableChatPages(options: {
  currentPages: ChatPage[]
  nextMessages: Message[]
  allocateKey: () => string
  pageMessageCount?: number
}): StableChatPage[] {
  const { currentPages, nextMessages, allocateKey } = options
  const pageMessageCount = options.pageMessageCount ?? PAGE_MESSAGE_COUNT
  if (nextMessages.length === 0) return []
  if (currentPages.length === 0) return buildStableChatPages(nextMessages, allocateKey, pageMessageCount)

  const previousIds = flattenPagesMessageIdsChronological(currentPages)
  const nextIds = nextMessages.map(message => message.info.id)
  const offset = findMessageSequenceOffset(nextIds, previousIds)
  if (offset === -1) {
    return buildStableChatPages(nextMessages, allocateKey, pageMessageCount)
  }

  const nextById = new Map(nextMessages.map(message => [message.info.id, message]))
  const refreshedPages = currentPages.map(page => rebuildPageWithFreshMessages(page as StableChatPage, nextById))
  const prefixMessages = nextMessages.slice(0, offset)
  const suffixMessages = nextMessages.slice(offset + previousIds.length)

  let nextPages = refreshedPages
  if (suffixMessages.length > 0) {
    const newestSegmentMessages = [
      ...(refreshedPages.length > 0 ? flattenPageMessagesChronological(refreshedPages[0]) : []),
      ...suffixMessages,
    ]
    const rebuiltNewestPages = buildStableChatPages(newestSegmentMessages, allocateKey, pageMessageCount)
    nextPages = [...rebuiltNewestPages, ...refreshedPages.slice(1)]
  }

  if (prefixMessages.length > 0) {
    const prependedOlderPages = buildStableChatPages(prefixMessages, allocateKey, pageMessageCount)
    nextPages = [...nextPages, ...prependedOlderPages]
  }

  return nextPages
}

export function buildPageOffsets(pages: ChatPage[], measuredPageHeights: Record<string, number>): number[] {
  const offsets = new Array<number>(pages.length + 1)
  offsets[0] = 0
  for (let index = 0; index < pages.length; index++) {
    offsets[index + 1] = offsets[index] + (measuredPageHeights[pages[index].key] ?? pages[index].estimatedHeight)
  }
  return offsets
}

export function seedMeasuredPageHeightsFromPreviousPages(options: {
  pages: ChatPage[]
  previousPages: ChatPage[]
  measuredPageHeights: Record<string, number>
}): Record<string, number> {
  const { pages, previousPages, measuredPageHeights } = options
  if (pages.length === 0 || previousPages.length === 0) return measuredPageHeights

  let nextHeights = measuredPageHeights
  for (const page of pages) {
    if (nextHeights[page.key] != null) continue

    const seedHeight = findMeasuredPageHeightSeed(page, previousPages, measuredPageHeights)
    if (seedHeight == null) continue

    if (nextHeights === measuredPageHeights) nextHeights = { ...measuredPageHeights }
    nextHeights[page.key] = seedHeight
  }

  return nextHeights
}

function findMeasuredPageHeightSeed(
  page: ChatPage,
  previousPages: ChatPage[],
  measuredPageHeights: Record<string, number>,
): number | null {
  let best: { messageCount: number; height: number } | null = null

  for (const previousPage of previousPages) {
    const measuredHeight = measuredPageHeights[previousPage.key]
    if (measuredHeight == null || measuredHeight <= 0) continue
    if (previousPage.messageIds.length === 0 || previousPage.messageIds.length > page.messageIds.length) continue
    if (findMessageSequenceOffset(page.messageIds, previousPage.messageIds) === -1) continue

    const estimatedAddedHeight = Math.max(0, page.estimatedHeight - previousPage.estimatedHeight)
    const height = Math.max(1, Math.ceil(measuredHeight + estimatedAddedHeight))
    if (!best || previousPage.messageIds.length > best.messageCount) {
      best = { messageCount: previousPage.messageIds.length, height }
    }
  }

  return best?.height ?? null
}

function findPageIndexAtOffset(offsets: number[], offset: number): number {
  let low = 0
  let high = offsets.length - 2
  let result = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (offsets[mid] <= offset && offsets[mid + 1] > offset) return mid
    if (offsets[mid] > offset) {
      high = mid - 1
    } else {
      result = mid
      low = mid + 1
    }
  }

  return Math.max(0, Math.min(result, offsets.length - 2))
}

export function computeExpandedPageRange(options: {
  pages: ChatPage[]
  measuredPageHeights: Record<string, number>
  scrollOffsetFromBottom: number
  viewportHeight: number
  radius?: number
}): PageRange {
  const { pages, measuredPageHeights, scrollOffsetFromBottom, viewportHeight } = options
  const radius = options.radius ?? EXPANDED_PAGE_RADIUS
  if (pages.length === 0) return { startIndex: 0, endIndex: -1 }

  const offsets = buildPageOffsets(pages, measuredPageHeights)
  const viewportStart = Math.max(0, scrollOffsetFromBottom)
  const viewportEnd = viewportStart + Math.max(1, viewportHeight)
  const firstVisiblePageIndex = findPageIndexAtOffset(offsets, viewportStart)
  const lastVisiblePageIndex = findPageIndexAtOffset(offsets, Math.max(viewportStart, viewportEnd - 1))

  return {
    startIndex: Math.max(0, firstVisiblePageIndex - radius),
    endIndex: Math.min(pages.length - 1, lastVisiblePageIndex + radius),
  }
}

export function buildExpandedPageSelection(
  range: PageRange,
  forcedPageIndex?: number | readonly number[] | null,
): ExpandedPageSelection {
  const selection = new Set<number>()
  if (range.endIndex >= range.startIndex) {
    for (let index = range.startIndex; index <= range.endIndex; index++) selection.add(index)
  }
  if (typeof forcedPageIndex === 'number') {
    if (forcedPageIndex >= 0) selection.add(forcedPageIndex)
  } else if (forcedPageIndex) {
    for (const index of forcedPageIndex) {
      if (index >= 0) selection.add(index)
    }
  }
  return selection
}

export type PagePremeasureDirection = 'older' | 'newer' | 'idle'

export function computePremeasureMessageBudget(viewportHeight: number): number {
  if (viewportHeight <= 0) return PREMEASURE_MIN_MESSAGE_BUDGET
  const viewportSizedBudget = Math.ceil((viewportHeight * PREMEASURE_TARGET_VIEWPORTS) / ESTIMATED_PREMEASURE_MESSAGE_HEIGHT)
  return Math.max(PREMEASURE_MIN_MESSAGE_BUDGET, Math.min(PREMEASURE_MAX_MESSAGE_BUDGET, viewportSizedBudget))
}

export function findPageToPremeasure(options: {
  pages: StableChatPage[]
  expandedPageRange: PageRange
  measuredPageHeights: Record<string, number>
  stalePageKeys?: ReadonlySet<string>
  direction: PagePremeasureDirection
  radius?: number
}): StableChatPage | null {
  return findPagesToPremeasure(options)[0] ?? null
}

export function findPagesToPremeasure(options: {
  pages: StableChatPage[]
  expandedPageRange: PageRange
  measuredPageHeights: Record<string, number>
  stalePageKeys?: ReadonlySet<string>
  direction: PagePremeasureDirection
  radius?: number
  messageBudget?: number
  maxPages?: number
}): StableChatPage[] {
  const {
    pages,
    expandedPageRange,
    measuredPageHeights,
    stalePageKeys = new Set<string>(),
    direction,
    messageBudget = PREMEASURE_MIN_MESSAGE_BUDGET,
    maxPages = Math.max(1, Math.ceil(messageBudget)),
  } = options
  const radius = options.radius ?? PREMEASURE_PAGE_RADIUS
  if (pages.length === 0 || expandedPageRange.endIndex < expandedPageRange.startIndex) return []

  const premeasurePageBudget = Math.max(radius, maxPages)
  const minIndex = Math.max(0, expandedPageRange.startIndex - premeasurePageBudget)
  const maxIndex = Math.min(pages.length - 1, expandedPageRange.endIndex + premeasurePageBudget)

  const collectNewer = (limitMessages: number, limitPages: number) => {
    const result: StableChatPage[] = []
    let coveredMessages = 0
    for (
      let index = Math.max(0, expandedPageRange.startIndex - 1);
      index >= minIndex && coveredMessages < limitMessages && result.length < limitPages;
      index--
    ) {
      const page = pages[index]
      coveredMessages += Math.max(1, page.messageIds.length)
      if (measuredPageHeights[page.key] == null || stalePageKeys.has(page.key)) result.push(page)
    }
    return { pages: result, coveredMessages }
  }

  const collectOlder = (limitMessages: number, limitPages: number) => {
    const result: StableChatPage[] = []
    let coveredMessages = 0
    for (
      let index = expandedPageRange.endIndex + 1;
      index <= maxIndex && coveredMessages < limitMessages && result.length < limitPages;
      index++
    ) {
      const page = pages[index]
      coveredMessages += Math.max(1, page.messageIds.length)
      if (measuredPageHeights[page.key] == null || stalePageKeys.has(page.key)) result.push(page)
    }
    return { pages: result, coveredMessages }
  }

  const combine = (
    primary: (limitMessages: number, limitPages: number) => { pages: StableChatPage[]; coveredMessages: number },
    fallback: (limitMessages: number, limitPages: number) => { pages: StableChatPage[]; coveredMessages: number },
  ) => {
    const planned = primary(messageBudget, maxPages)
    if (planned.coveredMessages >= messageBudget || planned.pages.length >= maxPages) return planned.pages

    const remainingMessages = messageBudget - planned.coveredMessages
    const remainingPages = maxPages - planned.pages.length
    return [...planned.pages, ...fallback(remainingMessages, remainingPages).pages]
  }

  if (direction === 'older') return combine(collectOlder, collectNewer)
  if (direction === 'newer') return combine(collectNewer, collectOlder)
  return combine(collectOlder, collectNewer)
}

export function buildPageRenderSegments(options: {
  pages: StableChatPage[]
  expandedPageSelection: ExpandedPageSelection
  measuredPageHeights: Record<string, number>
}): PageRenderSegment[] {
  const { pages, expandedPageSelection, measuredPageHeights } = options
  if (pages.length === 0) return []

  const segments: PageRenderSegment[] = []
  const appendCollapsedSegment = (startPageIndex: number, endPageIndex: number) => {
    if (startPageIndex > endPageIndex) return

    let height = 0
    for (let index = startPageIndex; index <= endPageIndex; index++) {
      height += measuredPageHeights[pages[index].key] ?? pages[index].estimatedHeight
    }

    segments.push({
      kind: 'collapsed',
      key: `collapsed:${pages[startPageIndex].key}:${pages[endPageIndex].key}`,
      height,
    })
  }

  let collapsedStartIndex: number | null = null
  for (let index = 0; index < pages.length; index++) {
    if (!expandedPageSelection.has(index)) {
      if (collapsedStartIndex === null) collapsedStartIndex = index
      continue
    }

    if (collapsedStartIndex !== null) {
      appendCollapsedSegment(collapsedStartIndex, index - 1)
      collapsedStartIndex = null
    }

    const page = pages[index]
    segments.push({
      kind: 'expanded',
      key: page.key,
      page,
      measuredHeight: measuredPageHeights[page.key] ?? page.estimatedHeight,
    })
  }

  if (collapsedStartIndex !== null) appendCollapsedSegment(collapsedStartIndex, pages.length - 1)
  return segments
}

export function buildTurnDurationMap(messages: Message[], visibleMessages: Message[]): Map<string, number> {
  const map = new Map<string, number>()
  const visibleAssistantIds = new Set(
    visibleMessages.filter(message => message.info.role === 'assistant').map(message => message.info.id),
  )

  let currentUserCreated: number | null = null
  let currentVisibleAssistantId: string | null = null
  let currentLastCompleted: number | null = null

  const commitTurn = () => {
    if (currentUserCreated == null || currentVisibleAssistantId == null || currentLastCompleted == null) return
    map.set(currentVisibleAssistantId, currentLastCompleted - currentUserCreated)
  }

  for (const message of messages) {
    if (message.info.role === 'user') {
      commitTurn()
      currentUserCreated = message.info.time.created
      currentVisibleAssistantId = null
      currentLastCompleted = null
      continue
    }

    if (currentUserCreated == null || message.info.role !== 'assistant') continue

    if (visibleAssistantIds.has(message.info.id)) {
      currentVisibleAssistantId = message.info.id
    }
    if (message.info.time.completed != null) {
      currentLastCompleted = message.info.time.completed
    }
  }

  commitTurn()

  return map
}
