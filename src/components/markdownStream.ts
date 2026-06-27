import { parseMarkdownIntoBlocks } from 'streamdown'

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

function splitMarkdownBlocks(markdown: string) {
  const blocks: Array<{ start: number; src: string }> = []
  let offset = 0

  for (const src of parseMarkdownIntoBlocks(markdown)) {
    const start = offset
    offset += src.length
    if (!src) continue

    if (src.trim() === '' && blocks.length > 0) {
      blocks[blocks.length - 1].src += src
      continue
    }

    blocks.push({ start, src })
  }

  return blocks.length > 0 ? blocks : [{ start: 0, src: markdown }]
}

export function splitMarkdownStream(markdown: string, isStreaming: boolean): MarkdownStreamBlock[] {
  if (!isStreaming) return [{ key: `full:${hashString(markdown)}`, src: markdown, mode: 'full' }]
  if (!markdown) return [{ key: 'live:empty', src: '', mode: 'live' }]
  if (hasReferenceDefinitions(markdown)) return [{ key: 'live:0:references', src: markdown, mode: 'live' }]

  const fenceStart = getTrailingOpenFenceStart(markdown)
  const blocks = splitMarkdownBlocks(markdown)
  if (blocks.length === 1) return [{ key: 'live:0:', src: markdown, mode: 'live' }]

  return blocks.map((block, index) => {
    const isLiveTail = index === blocks.length - 1 || (fenceStart != null && block.start >= fenceStart)
    return {
      key: `${isLiveTail ? 'live' : 'stable'}:${block.start}:${isLiveTail ? '' : hashString(block.src)}`,
      src: block.src,
      mode: isLiveTail ? 'live' : 'full',
    }
  })
}
