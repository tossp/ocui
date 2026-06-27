import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg><title>Diagram</title></svg>' })),
}))
const useInputCapabilitiesMock = vi.hoisted(() =>
  vi.fn(() => ({
    canHover: true,
    hasCoarsePointer: false,
    hasTouch: false,
    preferTouchUi: false,
  })),
)

vi.mock('./CodeBlock', () => ({
  CodeBlock: ({
    code,
    language,
    variant,
    deferHighlight,
    forceHighlight,
    streamingHighlight,
  }: {
    code: string
    language?: string
    variant?: string
    deferHighlight?: boolean
    forceHighlight?: boolean
    streamingHighlight?: boolean
  }) => (
    <div
      data-testid="code-block"
      data-variant={variant ?? 'default'}
      data-defer-highlight={String(!!deferHighlight)}
      data-force-highlight={String(!!forceHighlight)}
      data-streaming-highlight={String(!!streamingHighlight)}
    >
      {`${language ?? 'text'}:${code}`}
    </div>
  ),
}))

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

vi.mock('../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => useInputCapabilitiesMock(),
}))

vi.mock('mermaid', () => ({
  default: mermaidMocks,
}))

vi.mock('./ui', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" aria-label="Copy to clipboard">
      {text.slice(0, 20)}
    </button>
  ),
}))

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    useInputCapabilitiesMock.mockReset()
    useInputCapabilitiesMock.mockReturnValue({
      canHover: true,
      hasCoarsePointer: false,
      hasTouch: false,
      preferTouchUi: false,
    })
    mermaidMocks.initialize.mockClear()
    mermaidMocks.render.mockClear()
    mermaidMocks.render.mockResolvedValue({ svg: '<svg><title>Diagram</title></svg>' })
  })

  it('renders headings and inline code', () => {
    render(<MarkdownRenderer content={'# Title\n\nUse `pnpm`'} />)

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    const codeEl = screen.getByText('pnpm')
    expect(codeEl).toBeInTheDocument()
    expect(codeEl.tagName).toBe('CODE')
  })

  it('renders inline code with accent text styling (no border/bg)', () => {
    render(<MarkdownRenderer content={'Use `code` here'} />)

    const codeEl = screen.getByText('code')
    expect(codeEl.className).not.toMatch(/border/)
    expect(codeEl.className).not.toMatch(/bg-accent-main/)
    expect(codeEl.className).toMatch(/font-mono/)
    expect(codeEl.className).toMatch(/text-accent-main-100/)
  })

  it('renders fenced code blocks via CodeBlock', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} />)

    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
  })

  it('accepts isStreaming prop without crashing', () => {
    render(<MarkdownRenderer content={'Hello **world**'} isStreaming={true} />)

    expect(screen.getByRole('paragraph')).toHaveTextContent('Hello world')
  })

  it('renders with reasoning variant using subdued styles', () => {
    render(<MarkdownRenderer content={'# Heading\n\nSome text with `code`'} variant="reasoning" />)

    const heading = screen.getByRole('heading', { name: 'Heading' })
    expect(heading.className).toMatch(/text-text-300/)

    const paragraph = screen.getByRole('paragraph')
    expect(paragraph.className).toMatch(/text-text-400/)

    const codeEl = screen.getByText('code')
    expect(codeEl.className).not.toMatch(/border/)
    expect(codeEl.className).not.toMatch(/bg-accent/)
  })

  it('passes reasoning variant to CodeBlock', () => {
    render(<MarkdownRenderer content={'```js\nlet a = 1\n```'} variant="reasoning" />)

    const block = screen.getByTestId('code-block')
    expect(block.dataset.variant).toBe('reasoning')
  })

  it('passes default variant to CodeBlock by default', () => {
    render(<MarkdownRenderer content={'```js\nlet a = 1\n```'} />)

    const block = screen.getByTestId('code-block')
    expect(block.dataset.variant).toBe('default')
  })

  it('uses incremental code block highlighting while content is streaming', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveAttribute('data-defer-highlight', 'false')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-force-highlight', 'true')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-streaming-highlight', 'true')
  })

  it('only uses streaming code highlighting for the live markdown block', () => {
    render(<MarkdownRenderer content={'```ts\nconst stable = 1\n```\n\nlive tail'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveAttribute('data-force-highlight', 'false')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-streaming-highlight', 'false')
  })

  it('keeps the declared language for an incomplete streaming code fence', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-streaming-highlight', 'true')
  })

  it('reserves enough marker space for large ordered list numbers', () => {
    const { container } = render(<MarkdownRenderer content={'998. Alpha\n999. Beta\n1000. Gamma'} />)

    expect(container.querySelector('ol')).toHaveStyle({ paddingInlineStart: '6ch' })
  })

  it('renders single-dollar inline math', () => {
    const { container } = render(<MarkdownRenderer content={'Inline $x + y$ math'} />)

    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders mermaid code fences as diagrams', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument()
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false, theme: 'default' }),
    )
  })

  it('supports mermaid zoom, pan, and reset controls', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })

    expect(screen.queryByRole('button', { name: 'Enable diagram pan' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in diagram' }))
    expect(diagram).toHaveStyle({ transform: 'translate(0px, 0px) scale(1.15)' })

    fireEvent.pointerDown(diagram, { button: 0, clientX: 10, clientY: 20, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerMove(diagram, { clientX: 35, clientY: 55, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(diagram, { pointerId: 1, pointerType: 'mouse' })
    expect(diagram).toHaveStyle({ transform: 'translate(25px, 35px) scale(1.15)' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset diagram view' }))
    expect(diagram).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' })
  })

  it('marks streaming markdown chunk boundaries for stable spacing', () => {
    const content = 'first\n\n```ts\nconst a = 1\n```\n\n```ts\nconst b = 2'
    const { container } = render(<MarkdownRenderer content={content} isStreaming />)

    const chunks = container.querySelectorAll('.markdown-stream-block')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toHaveClass('markdown-stream-block-first')
    expect(chunks[0]).toHaveClass('markdown-stream-block-not-last')
    expect(chunks[chunks.length - 1]).toHaveClass('markdown-stream-block-not-first')
    expect(chunks[chunks.length - 1]).toHaveClass('markdown-stream-block-last')
  })

  it('keeps desktop controls for hover-capable touch input', async () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: true,
      hasCoarsePointer: false,
      hasTouch: true,
      preferTouchUi: false,
    })

    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })

    expect(screen.queryByRole('button', { name: 'Enable diagram pan' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in diagram' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out diagram' })).toBeInTheDocument()
    expect(diagram.className).toContain('touch-pan-y')
  })

  it('uses tap-to-reveal mermaid controls for touch-preferred input', async () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: false,
      hasCoarsePointer: true,
      hasTouch: true,
      preferTouchUi: true,
    })

    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })
    const container = diagram.parentElement
    const toolbar = screen.getByRole('button', { name: 'Copy to clipboard' }).parentElement

    expect(container).toHaveAttribute('tabindex', '0')
    expect(toolbar?.className).toContain('[@media(hover:none)]:opacity-0')
    expect(diagram.className).toContain('touch-pan-y')
    expect(screen.queryByRole('button', { name: 'Zoom in diagram' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zoom out diagram' })).not.toBeInTheDocument()

    fireEvent.pointerDown(diagram, { clientX: 10, clientY: 20, pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerMove(diagram, { clientX: 35, clientY: 55, pointerId: 2, pointerType: 'touch' })
    expect(diagram).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' })

    fireEvent.click(diagram)
    expect(container).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Enable diagram pan' }))
    const panButton = screen.getByRole('button', { name: 'Disable diagram pan' })
    expect(panButton).toHaveAttribute('aria-pressed', 'true')
    expect(panButton.className).toContain('ring-accent-main-100')
    expect(diagram.className).toContain('touch-none')

    fireEvent.pointerDown(diagram, { clientX: 10, clientY: 20, pointerId: 3, pointerType: 'touch' })
    fireEvent.pointerMove(diagram, { clientX: 35, clientY: 55, pointerId: 3, pointerType: 'touch' })
    expect(diagram).toHaveStyle({ transform: 'translate(25px, 35px) scale(1)' })
    fireEvent.pointerUp(diagram, { pointerId: 3, pointerType: 'touch' })

    fireEvent.pointerDown(diagram, { clientX: 100, clientY: 100, pointerId: 4, pointerType: 'touch' })
    fireEvent.pointerDown(diagram, { clientX: 140, clientY: 100, pointerId: 5, pointerType: 'touch' })
    fireEvent.pointerMove(diagram, { clientX: 180, clientY: 100, pointerId: 5, pointerType: 'touch' })
    expect(diagram).toHaveStyle({ transform: 'translate(-50px, -30px) scale(2)' })
  })

  it('renders markdown table with copy button in default mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} />)

    // Table should be rendered
    expect(screen.getByRole('table')).toBeInTheDocument()
    // Copy button should exist
    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('renders markdown table without copy button in reasoning mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} variant="reasoning" />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument()
  })

  it('renders markdown images as plain img links without streamdown image wrapper controls', () => {
    render(<MarkdownRenderer content={'![avatar](https://example.com/avatar.png)'} />)

    const img = screen.getByRole('img', { name: 'avatar' })
    expect(img).toBeInTheDocument()
    expect(img.tagName).toBe('IMG')
    expect(screen.queryByTitle('Download image')).not.toBeInTheDocument()
  })

  it('renders Windows absolute path links without blocked indicator', () => {
    const filePath =
      'G:/projects/koishi_projects/koishi-new/external/chatluna/packages/core/src/commands/conversation.ts'
    render(<MarkdownRenderer content={`[conversation.ts](${filePath})`} />)

    const link = screen.getByRole('link', { name: 'conversation.ts' })
    expect(link).toHaveAttribute('href', `#opencode-local-file:${encodeURIComponent(filePath)}`)
    expect(link).toHaveAttribute('title', filePath)
    expect(screen.queryByText(/\[blocked\]/)).not.toBeInTheDocument()
  })

  it('renders Windows backslash path links without blocked indicator', () => {
    const filePath = 'C:\\Users\\test\\projects\\assets\\script.js'
    render(<MarkdownRenderer content={`[script.js](${filePath})`} />)

    const link = screen.getByRole('link', { name: 'script.js' })
    expect(link).toHaveAttribute('href', `#opencode-local-file:${encodeURIComponent(filePath)}`)
    expect(link).toHaveAttribute('title', filePath)
    expect(screen.queryByText(/\[blocked\]/)).not.toBeInTheDocument()
  })

  it('still blocks unsafe javascript links', () => {
    render(<MarkdownRenderer content={'[bad](javascript:alert(1))'} />)

    expect(screen.getByText('bad [blocked]')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument()
  })
})
