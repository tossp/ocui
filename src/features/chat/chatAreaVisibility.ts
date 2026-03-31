import type { Message, Part, TextPart, ReasoningPart } from '../../types/message'

function messageHasContent(message: Message): boolean {
  if (message.parts.length === 0) {
    // 有非 abort 错误的助手消息仍然可见（展示错误信息）
    if (message.info.role === 'assistant' && 'error' in message.info && message.info.error) {
      return message.info.error.name !== 'MessageAbortedError'
    }
    // 任何角色的空消息都不可见：没有内容可展示
    // part 到达后自动进入可见列表；abort 后永远不会有 part → 永远不可见
    return false
  }
  return message.parts.some(part => {
    switch (part.type) {
      case 'text':
        return !!(part as TextPart).text?.trim() && !(part as TextPart).synthetic
      case 'reasoning':
        return !!(part as ReasoningPart).text?.trim()
      case 'tool':
      case 'file':
      case 'agent':
      case 'step-finish':
      case 'subtask':
      case 'retry':
      case 'compaction':
        return true
      default:
        return false
    }
  })
}

function isVisibleThinking(part: Part): boolean {
  return part.type === 'reasoning' && !!(part as ReasoningPart).text?.trim()
}

function isVisibleText(part: Part): boolean {
  return part.type === 'text' && !!(part as TextPart).text?.trim() && !(part as TextPart).synthetic
}

function endsWithTool(msg: Message): boolean {
  if (msg.info.role !== 'assistant' || msg.parts.length === 0) return false
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    const p = msg.parts[i]
    if (p.type === 'snapshot' || p.type === 'patch' || p.type === 'step-start' || p.type === 'step-finish') continue
    // skip empty reasoning / empty text — they carry no visible content
    if (p.type === 'reasoning' && !(p as ReasoningPart).text?.trim()) continue
    if (p.type === 'text' && (!(p as TextPart).text?.trim() || (p as TextPart).synthetic)) continue
    return p.type === 'tool'
  }
  return false
}

function isToolOnlyFollowUp(msg: Message): boolean {
  if (msg.info.role !== 'assistant') return false
  let sawTool = false
  for (const p of msg.parts) {
    if (p.type === 'snapshot' || p.type === 'patch' || p.type === 'step-start' || p.type === 'step-finish') continue
    if (isVisibleThinking(p) || isVisibleText(p)) return false
    if (p.type === 'tool') sawTool = true
    else if (p.type === 'subtask' || p.type === 'retry' || p.type === 'compaction') return false
  }
  return sawTool
}

function isMergeableTrailing(msg: Message): boolean {
  if (msg.info.role !== 'assistant') return false
  let sawTool = false
  let sawVisibleText = false
  for (const p of msg.parts) {
    if (p.type === 'snapshot' || p.type === 'patch' || p.type === 'step-start' || p.type === 'step-finish') continue
    if (isVisibleThinking(p)) return false
    if (p.type === 'tool') {
      sawTool = true
      continue
    }
    if (isVisibleText(p)) {
      sawVisibleText = true
      continue
    }
    if (p.type === 'subtask' || p.type === 'retry' || p.type === 'compaction') return false
  }
  return sawTool && sawVisibleText
}

export interface VisibleMessageEntry {
  message: Message
  sourceIds: string[]
}

export function getVisibleMessageForkTargetId(entry: VisibleMessageEntry): string {
  return entry.sourceIds[entry.sourceIds.length - 1] || entry.message.info.id
}

export function buildVisibleMessageEntries(messages: Message[]): VisibleMessageEntry[] {
  // 防御性去重：保证输入无重复 ID
  const seenIds = new Set<string>()
  const unique: Message[] = []
  for (const m of messages) {
    if (!seenIds.has(m.info.id)) {
      seenIds.add(m.info.id)
      unique.push(m)
    }
  }
  const filteredMessages = unique.filter(messageHasContent)
  const result: VisibleMessageEntry[] = []

  for (let i = 0; i < filteredMessages.length; i++) {
    const msg = filteredMessages[i]
    if (!endsWithTool(msg)) {
      result.push({ message: msg, sourceIds: [msg.info.id] })
      continue
    }

    const sourceIds = [msg.info.id]
    let j = i + 1

    while (j < filteredMessages.length) {
      if (isToolOnlyFollowUp(filteredMessages[j])) {
        sourceIds.push(filteredMessages[j].info.id)
        j++
      } else if (isMergeableTrailing(filteredMessages[j])) {
        sourceIds.push(filteredMessages[j].info.id)
        j++
        // 如果该消息也以 tool 结尾（text 在 tool 前面，是中间说明不是结论），
        // 继续合并链；只有 text 在 tool 后面（真正收尾）才终止
        if (!endsWithTool(filteredMessages[j - 1])) break
      } else {
        break
      }
    }

    if (j === i + 1) {
      result.push({ message: msg, sourceIds })
    } else {
      const mergedMessages = filteredMessages.slice(i + 1, j)
      const tailParts = mergedMessages.flatMap(message => message.parts)
      // 合并后如果任何源消息在 streaming，合并结果也应该是 streaming
      const anyStreaming = msg.isStreaming || mergedMessages.some(m => m.isStreaming)
      result.push({
        message: { ...msg, parts: [...msg.parts, ...tailParts], isStreaming: anyStreaming },
        sourceIds,
      })
      i = j - 1
    }
  }

  return result
}
