export type MarkdownStreamBlock = {
  key: string
  src: string
  mode: 'full' | 'live'
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash.toString(36)
}

function hasReferenceDefinitions(markdown: string) {
  return /^\[[^\]]+\]:\s+\S+/m.test(markdown) || /^\[\^[^\]]+\]:\s+/m.test(markdown)
}

function getTrailingOpenFenceStart(markdown: string) {
  let openFence: { start: number; char: string; size: number } | null = null
  let offset = 0
  const lines = markdown.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? ''
    const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text)

    if (match?.[1] && !openFence) {
      openFence = { start: offset, char: match[1][0], size: match[1].length }
    } else if (openFence) {
      const closePattern = new RegExp(`^[ \\t]{0,3}${openFence.char}{${openFence.size},}[ \\t]*$`)
      if (closePattern.test(text)) openFence = null
    }

    offset += text.length + (index < lines.length - 1 ? 1 : 0)
  }

  return openFence?.start
}

export function splitMarkdownStream(markdown: string, isStreaming: boolean): MarkdownStreamBlock[] {
  if (!isStreaming) return [{ key: `full:${hashString(markdown)}`, src: markdown, mode: 'full' }]
  if (!markdown) return [{ key: 'live:empty', src: '', mode: 'live' }]
  if (hasReferenceDefinitions(markdown)) return [{ key: `live:${hashString(markdown)}`, src: markdown, mode: 'live' }]

  const fenceStart = getTrailingOpenFenceStart(markdown)
  if (fenceStart == null || fenceStart <= 0) {
    return [{ key: `live:${hashString(markdown)}`, src: markdown, mode: 'live' }]
  }

  const stableHead = markdown.slice(0, fenceStart)
  const liveTail = markdown.slice(fenceStart)
  return [
    { key: `stable:${hashString(stableHead)}`, src: stableHead, mode: 'live' },
    { key: `live-code:${fenceStart}`, src: liveTail, mode: 'live' },
  ]
}
