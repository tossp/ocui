import { describe, expect, it } from 'vitest'
import { splitMarkdownStream } from './markdownStream'

describe('splitMarkdownStream', () => {
  it('keeps non-streaming markdown as one full block', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1', false)).toEqual([
      expect.objectContaining({ src: 'before\n\n```ts\nconst x = 1', mode: 'full' }),
    ])
  })

  it('keeps regular streaming markdown as one live block', () => {
    expect(splitMarkdownStream('hello **world', true)).toEqual([
      expect.objectContaining({ src: 'hello **world', mode: 'live' }),
    ])
  })

  it('splits stable content from an unfinished trailing code fence while streaming', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'live' }),
      expect.objectContaining({ src: '```ts\nconst x = 1', mode: 'live' }),
    ])
  })

  it('keeps the stable block key while the trailing code fence grows', () => {
    const first = splitMarkdownStream('before\n\n```ts\nconst x = 1', true)
    const next = splitMarkdownStream('before\n\n```ts\nconst x = 12', true)

    expect(first[0].key).toBe(next[0].key)
    expect(first[0].src).toBe(next[0].src)
    expect(first[1].key).toBe(next[1].key)
    expect(first[1].src).not.toBe(next[1].src)
  })

  it('keeps completed code fences in one live block while streaming', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1\n```', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n```ts\nconst x = 1\n```', mode: 'live' }),
    ])
  })

  it('keeps reference-style markdown as one live block', () => {
    expect(splitMarkdownStream('[docs][1]\n\n[1]: https://example.com', true)).toEqual([
      expect.objectContaining({ src: '[docs][1]\n\n[1]: https://example.com', mode: 'live' }),
    ])
  })
})
