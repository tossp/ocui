import { describe, expect, it } from 'vitest'
import { projectMarkdownStream, splitMarkdownStream } from './markdownStream'

describe('splitMarkdownStream', () => {
  it('splits non-streaming markdown into full and code blocks', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1', false)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1', mode: 'code', language: 'ts' }),
    ])
  })

  it('keeps incomplete single-block streaming markdown as one live block', () => {
    expect(splitMarkdownStream('hello **world', true)).toEqual([
      expect.objectContaining({ src: 'hello **world', mode: 'live' }),
    ])
  })

  it('keeps the single live block key stable while streaming grows', () => {
    const first = splitMarkdownStream('```md\n# title', true)
    const next = splitMarkdownStream('```md\n# title\n\n- item', true)

    expect(first).toHaveLength(1)
    expect(next).toHaveLength(1)
    expect(first[0].key).toBe(next[0].key)
    expect(next[0]).toEqual(expect.objectContaining({ mode: 'code', language: 'md', src: '# title\n\n- item' }))
  })

  it('splits stable paragraphs from the live tail while streaming', () => {
    expect(splitMarkdownStream('first paragraph\n\nsecond **live', true)).toEqual([
      expect.objectContaining({ src: 'first paragraph\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'second **live', mode: 'live' }),
    ])
  })

  it('keeps the stable paragraph key while only the live tail grows', () => {
    const first = splitMarkdownStream('first paragraph\n\nsecond', true)
    const next = splitMarkdownStream('first paragraph\n\nsecond grows', true)

    expect(first[0].key).toBe(next[0].key)
    expect(first[0].src).toBe(next[0].src)
    expect(first[1].key).toBe(next[1].key)
    expect(first[1].src).not.toBe(next[1].src)
  })

  it('keeps multiple completed blocks stable while only the tail is live', () => {
    expect(splitMarkdownStream('one\n\ntwo\n\nthree live', true)).toEqual([
      expect.objectContaining({ src: 'one\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'two\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'three live', mode: 'live' }),
    ])
  })

  it('does not split on blank lines inside fenced code blocks', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const a = 1\n\nconst b = 2', raw: '```ts\nconst a = 1\n\nconst b = 2\n```\n\n', mode: 'code', complete: true }),
      expect.objectContaining({ src: 'after', mode: 'live' }),
    ])
  })

  it('splits stable content from an unfinished trailing code fence while streaming', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1', mode: 'code', complete: false }),
    ])
  })

  it('keeps the stable block key while the trailing code fence grows', () => {
    const first = splitMarkdownStream('before\n\n```ts\nconst x = 1', true)
    const next = splitMarkdownStream('before\n\n```ts\nconst x = 12', true)

    expect(first[0].key).toBe(next[0].key)
    expect(first[0].src).toBe(next[0].src)
    expect(first[1].key).toBe(next[1].key)
    expect(first[1].src).not.toBe(next[1].src)
    expect(next[1].src).toBe('const x = 12')
  })

  it('splits stable content before a completed code fence while streaming', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1\n```', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1\n```', mode: 'code', complete: true }),
    ])
  })

  it('keeps reference-style markdown as one live block', () => {
    expect(splitMarkdownStream('[docs][1]\n\n[1]: https://example.com', true)).toEqual([
      expect.objectContaining({ src: '[docs][1]\n\n[1]: https://example.com', mode: 'live' }),
    ])
  })

  it('does not treat footnotes as reference definitions that disable block splitting', () => {
    expect(splitMarkdownStream('text[^ref]\n\n[^ref]: footnote\n\n```ts\nconst x = 1\n```', false)).toEqual([
      expect.objectContaining({ src: 'text[^ref]\n\n', mode: 'full' }),
      expect.objectContaining({ src: '[^ref]: footnote\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1\n```', mode: 'code', language: 'ts' }),
    ])
  })

  it('keeps reference-style live block key stable while streaming grows', () => {
    const first = splitMarkdownStream('[docs][1]\n\n[1]: https://example.com', true)
    const next = splitMarkdownStream('[docs][1]\n\n[1]: https://example.com "title"', true)

    expect(first[0].key).toBe(next[0].key)
  })

  it('does not append reference definitions to standalone display math blocks', () => {
    const markdown = String.raw`[docs][1]

$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$

[1]: https://example.com`
    const blocks = splitMarkdownStream(markdown, false)
    const mathBlock = blocks.find(block => block.src.trimStart().startsWith('$$'))

    expect(mathBlock?.src.trim()).toBe(String.raw`$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$`)
  })

  it('projects appended open code fences without rebuilding stable blocks', () => {
    const first = projectMarkdownStream(undefined, 'before\n\n```ts\nconst x = 1', true)
    const next = projectMarkdownStream(first, 'before\n\n```ts\nconst x = 12', true)

    expect(next.blocks).toHaveLength(2)
    expect(next.blocks[0]).toBe(first.blocks[0])
    expect(next.blocks[1].key).toBe(first.blocks[1].key)
    expect(next.blocks[1].src).toBe('const x = 12')
    expect(next.blocks[1].raw).toBe('```ts\nconst x = 12')
  })

  it('falls back to full splitting when appended text closes an open code fence', () => {
    const first = projectMarkdownStream(undefined, 'before\n\n```ts\nconst x = 1', true)
    const next = projectMarkdownStream(first, 'before\n\n```ts\nconst x = 1\n```', true)

    expect(next.blocks).toEqual(splitMarkdownStream('before\n\n```ts\nconst x = 1\n```', true))
  })
})
