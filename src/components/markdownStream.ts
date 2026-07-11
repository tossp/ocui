import { marked } from 'marked'
import type { Tokens } from 'marked'

export type MarkdownStreamBlock = {
  key: string
  src: string
  raw?: string
  mode: 'full' | 'live' | 'code' | 'table'
  language?: string
  complete?: boolean
}

export type MarkdownStreamProjection = {
  text: string
  blocks: MarkdownStreamBlock[]
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash.toString(36)
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

function getOpeningFence(raw: string) {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(raw)
  if (!match?.[1]) return null
  return { char: match[1][0], size: match[1].length }
}

function hasOpenFence(raw: string) {
  return getTrailingOpenFenceStart(raw) === 0
}

function suffixClosesOpenFence(raw: string, suffix: string) {
  const fence = getOpeningFence(raw)
  if (!fence) return suffix.includes('```') || suffix.includes('~~~')
  const prefix = raw.slice(-(fence.size - 1))
  return new RegExp(`^[\\s\\S]*(?:^|\\n)[ \\t]{0,3}${fence.char}{${fence.size},}[ \\t]*(?:\\n|$)`).test(prefix + suffix)
}

function getLanguage(value: string | undefined) {
  return value?.trim().split(/\s+/, 1)[0] || undefined
}

function appendReferenceDefinitions(src: string, referenceDefinitions: string) {
  const trimmed = src.trim()
  if (!referenceDefinitions || (trimmed.startsWith('$$') && trimmed.endsWith('$$'))) return src
  return `${src.replace(/\s+$/, '')}\n\n${referenceDefinitions}`
}

function splitMarkdownBlocks(markdown: string) {
  const blocks: Array<{ start: number; raw: string; src: string; token?: Tokens.Generic }> = []
  const referenceDefinitions: string[] = []
  let offset = 0

  for (const token of marked.lexer(markdown)) {
    const raw = typeof token.raw === 'string' ? token.raw : ''
    const start = offset
    offset += raw.length
    if (!raw) continue
    if (token.type === 'def' && !String((token as Tokens.Def).tag ?? '').startsWith('^')) {
      referenceDefinitions.push(raw)
      continue
    }

    if (raw.trim() === '' && blocks.length > 0) {
      blocks[blocks.length - 1].raw += raw
      if (blocks[blocks.length - 1].token?.type !== 'code') blocks[blocks.length - 1].src += raw
      continue
    }

    blocks.push({
      start,
      raw,
      src: token.type === 'code' ? String((token as Tokens.Code).text ?? '') : raw,
      token: token as Tokens.Generic,
    })
  }

  if (offset < markdown.length) {
    const rest = markdown.slice(offset)
    if (blocks.length > 0) {
      blocks[blocks.length - 1].raw += rest
      blocks[blocks.length - 1].src += rest
    } else blocks.push({ start: offset, raw: rest, src: rest })
  }

  return {
    blocks: blocks.length > 0 ? blocks : [{ start: 0, raw: markdown, src: markdown }],
    referenceDefinitions: referenceDefinitions.join('\n'),
  }
}

export function splitMarkdownStream(markdown: string, isStreaming: boolean): MarkdownStreamBlock[] {
  if (!isStreaming) {
    if (!markdown) return [{ key: 'full:empty', src: '', mode: 'full' }]
    const { blocks, referenceDefinitions } = splitMarkdownBlocks(markdown)
    if (blocks.length === 1 && blocks[0]?.token?.type !== 'code' && blocks[0]?.token?.type !== 'table') {
      return [{ key: `full:${hashString(markdown)}`, src: appendReferenceDefinitions(blocks[0]?.raw ?? markdown, referenceDefinitions), mode: 'full' }]
    }
    return blocks.map(block => {
      if (block.token?.type === 'code') {
        const language = getLanguage((block.token as Tokens.Code).lang)
        return {
          key: `code:${block.start}:${hashString(block.raw)}`,
          raw: block.raw,
          src: block.src,
          mode: 'code' as const,
          language,
          complete: true,
        }
      }
      if (block.token?.type === 'table') {
        return {
          key: `table:${block.start}:${hashString(block.raw)}`,
          raw: block.raw,
          src: block.raw,
          mode: 'table' as const,
        }
      }
      return {
        key: `full:${block.start}:${hashString(block.raw)}`,
        raw: block.raw,
        src: appendReferenceDefinitions(block.raw, referenceDefinitions),
        mode: 'full' as const,
      }
    })
  }

  if (!markdown) return [{ key: 'live:empty', src: '', mode: 'live' }]

  const fenceStart = getTrailingOpenFenceStart(markdown)
  const { blocks, referenceDefinitions } = splitMarkdownBlocks(markdown)
  if (blocks.length === 1 && blocks[0]?.token?.type !== 'code' && blocks[0]?.token?.type !== 'table') {
    return [{ key: 'live:0:', src: appendReferenceDefinitions(blocks[0]?.raw ?? markdown, referenceDefinitions), mode: 'live' }]
  }

  return blocks.map(block => {
    const isLiveTail = block === blocks[blocks.length - 1] || (fenceStart != null && block.start >= fenceStart)
    if (block.token?.type === 'code') {
      const complete = fenceStart == null || block.start < fenceStart
      const language = getLanguage((block.token as Tokens.Code).lang)
      return {
        key: `code:${block.start}:${complete ? hashString(block.raw) : ''}`,
        raw: block.raw,
        src: block.src,
        mode: 'code' as const,
        language,
        complete,
      }
    }
    if (block.token?.type === 'table') {
      return {
        key: `table:${block.start}:${hashString(block.raw)}`,
        raw: block.raw,
        src: block.raw,
        mode: 'table' as const,
      }
    }
    return {
      key: `${isLiveTail ? 'live' : 'stable'}:${block.start}:${isLiveTail ? '' : hashString(block.src)}`,
      src: appendReferenceDefinitions(block.src, referenceDefinitions),
      mode: isLiveTail ? ('live' as const) : ('full' as const),
    }
  })
}

export function projectMarkdownStream(
  previous: MarkdownStreamProjection | undefined,
  markdown: string,
  isStreaming: boolean,
): MarkdownStreamProjection {
  if (!isStreaming || !previous || !markdown.startsWith(previous.text)) {
    return { text: markdown, blocks: splitMarkdownStream(markdown, isStreaming) }
  }

  const suffix = markdown.slice(previous.text.length)
  const tail = previous.blocks.at(-1)
  if (!suffix || tail?.mode !== 'code' || tail.complete || !tail.raw || !hasOpenFence(tail.raw) || suffixClosesOpenFence(tail.raw, suffix)) {
    return { text: markdown, blocks: splitMarkdownStream(markdown, isStreaming) }
  }

  return {
    text: markdown,
    blocks: [
      ...previous.blocks.slice(0, -1),
      {
        ...tail,
        raw: tail.raw + suffix,
        src: tail.src + suffix,
      },
    ],
  }
}
