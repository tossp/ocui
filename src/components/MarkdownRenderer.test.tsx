import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'
import { clearMermaidRenderCache } from './mermaidRenderCache'

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
    clearMermaidRenderCache()
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

  it('renders inline code inside list items as code elements', () => {
    const { container } = render(<MarkdownRenderer content={'- `单行代码`'} />)

    const codeEl = container.querySelector('li code')
    expect(codeEl).toBeInTheDocument()
    expect(codeEl).toHaveTextContent('单行代码')
    expect(codeEl).toHaveClass('font-mono')
    expect(codeEl).toHaveClass('text-accent-main-100')
  })

  it('keeps inline emphasis styles on the markdown path', () => {
    render(<MarkdownRenderer content={'**bold** *em* ~~gone~~'} />)

    expect(screen.getByText('bold').className).toMatch(/text-text-100/)
    expect(screen.getByText('em').className).toMatch(/text-text-200/)
    expect(screen.getByText('gone').className).toMatch(/text-text-400/)
  })

  it('renders common markdown extension inline styles', () => {
    const { container } = render(<MarkdownRenderer content={'H~2~O X^2^ ==mark=='} />)

    expect(container.querySelector('sub')).toHaveTextContent('2')
    expect(container.querySelector('sup')).toHaveTextContent('2')
    expect(container.querySelector('mark')).toHaveTextContent('mark')
  })

  it('renders footnote references and definitions', () => {
    const content = '这是一段需要说明的文字[^ref1]。这里还有另一个引用[^ref2]。\n\n[^ref2]: 第二个脚注，来自某文献第 42 页。'
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelector('#fnref-ref1')).toHaveTextContent('ref1')
    expect(container.querySelector('#fnref-ref2')).toHaveTextContent('ref2')
    expect(container.querySelector('#fn-ref2')).toHaveTextContent('第二个脚注，来自某文献第 42 页。')
  })

  it('keeps task checkboxes on the markdown path', () => {
    const { container } = render(<MarkdownRenderer content={'- [x] done'} />)

    const checkbox = container.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeInTheDocument()
  })

  it('renders fenced code blocks via CodeBlock', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} />)

    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
  })

  it('renders consecutive fenced code blocks via CodeBlock', () => {
    const fence = '```'
    const content = [
      `${fence}python`,
      'print("py")',
      fence,
      '',
      `${fence}javascript`,
      'console.log("js")',
      fence,
      '',
      `${fence}rust`,
      'fn main() {}',
      fence,
      '',
      `${fence}go`,
      'package main',
      fence,
      '',
      `${fence}sql`,
      'SELECT 1;',
      fence,
      '',
      `${fence}json`,
      '{"name":"test"}',
      fence,
      '',
      `${fence}bash`,
      'echo ok',
      fence,
    ].join('\n')

    render(<MarkdownRenderer content={content} />)

    expect(screen.getAllByTestId('code-block')).toHaveLength(7)
  })

  it('renders the comprehensive markdown fixture core elements', () => {
    const fence = '```'
    const content = [
      '# Markdown 综合性能测试文档',
      '',
      '> 用于测试 Markdown 解析器的流式渲染性能。',
      '',
      '**粗体** · *斜体* · ~~删除线~~ · `行内代码` · H~2~O · X^2^ · ==高亮==',
      '',
      '## 三、代码块',
      '',
      `${fence}python`,
      'def quicksort(arr):',
      '    if len(arr) <= 1:',
      '        return arr',
      fence,
      '',
      `${fence}javascript`,
      'async function fetchData(url) {',
      '    const resp = await fetch(url);',
      '    return resp.json();',
      '}',
      fence,
      '',
      `${fence}rust`,
      'fn main() {',
      '    println!("ok");',
      '}',
      fence,
      '',
      `${fence}go`,
      'package main',
      'import "fmt"',
      fence,
      '',
      `${fence}sql`,
      'SELECT u.name, COUNT(o.id) AS order_count',
      'FROM users u',
      'GROUP BY u.id, u.name;',
      fence,
      '',
      `${fence}json`,
      '{',
      '  "name": "测试"',
      '}',
      fence,
      '',
      `${fence}bash`,
      '#!/bin/bash',
      'for f in *.py; do',
      '    python3 "$f"',
      'done',
      fence,
      '',
      '## 四、表格',
      '',
      '| 语言 | 类型 | 速度 |',
      '|:---|:---:|:---:|',
      '| Rust | 静态 | ★★★★★ |',
      '| Go | 静态 | ★★★★ |',
      '',
      '| 服务 | QPS | 状态 |',
      '|:---|---:|:---:|',
      '| api-gateway | 45000 | ✅ |',
      '| notification | 5200 | ⚠️ |',
      '',
      '## 五、列表',
      '',
      '- 容器化',
      '  - [x] Docker',
      '  - [ ] Podman',
      '',
      '## 六、数学公式',
      '',
      '行内：$e^{i\\pi} + 1 = 0$ · $\\nabla \\times \\vec{E} = -\\partial\\vec{B}/\\partial t$',
      '',
      '$$',
      '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
      '$$',
      '',
      '$$',
      '\\begin{pmatrix}',
      '1 & 0 & 0 \\\\',
      '0 & 1 & 0 \\\\',
      '0 & 0 & 1',
      '\\end{pmatrix}',
      '$$',
      '',
      '$$',
      '\\begin{aligned}',
      '\\nabla \\cdot \\vec{E} &= \\rho / \\varepsilon_0 \\\\',
      '\\nabla \\cdot \\vec{B} &= 0',
      '\\end{aligned}',
      '$$',
      '',
      '## 八、HTML 组件',
      '',
      '<progress value="72" max="100" style="width:100%;height:20px"></progress> 72%',
      '',
      '<details>',
      '<summary>项目结构</summary>',
      '<div><pre>src/</pre></div>',
      '</details>',
      '',
      '## 九、脚注',
      '',
      '这是一段需要说明的文字[^ref1]。这里还有另一个引用[^ref2]。',
      '',
      '[^ref1]: 这是第一个脚注的内容，可以写很长。',
      '[^ref2]: 第二个脚注，来自某文献第 42 页。',
    ].join('\n')

    const { container } = render(<MarkdownRenderer content={content} />)

    expect(screen.getAllByTestId('code-block')).toHaveLength(7)
    expect(container.querySelectorAll('table')).toHaveLength(2)
    expect(screen.getAllByTestId('copy-button')).toHaveLength(2)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(3)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('progress')).toBeInTheDocument()
    expect(container.querySelector('details')).toBeInTheDocument()
    expect(container.querySelector('sub')).toHaveTextContent('2')
    expect(container.querySelector('sup')).toHaveTextContent('2')
    expect(container.querySelector('mark')).toHaveTextContent('高亮')
    expect(container.querySelector('#fnref-ref1')).toBeInTheDocument()
    expect(container.querySelector('#fn-ref2')).toHaveTextContent('第二个脚注')
  })

  it('accepts isStreaming prop without crashing', () => {
    render(<MarkdownRenderer content={'Hello **world**'} isStreaming={true} />)

    expect(screen.getByRole('paragraph')).toHaveTextContent('Hello world')
  })

  it('renders streaming inline math through the markdown renderer', () => {
    const { container } = render(<MarkdownRenderer content={'Inline $x + y$ math'} isStreaming />)

    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders sanitized streaming raw HTML through the markdown renderer', () => {
    render(<MarkdownRenderer content={'<div><span>Python</span></div>'} isStreaming />)

    expect(screen.getByText('Python')).toBeInTheDocument()
  })

  it('blocks unsafe streaming markdown links through the markdown renderer', () => {
    render(<MarkdownRenderer content={'[bad](javascript:alert(1))'} isStreaming />)

    expect(screen.getByText('bad [blocked]')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument()
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

  it('renders multiline display math blocks', () => {
    const content = String.raw`$$
\begin{aligned}
\nabla \cdot \vec{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \vec{B} &= 0 \\
\nabla \times \vec{E} &= -\frac{\partial\vec{B}}{\partial t}
\end{aligned}
$$`
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelector('.katex-display')).toBeInTheDocument()
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('renders multiple one-line display math blocks', () => {
    const content = String.raw`$$ \begin{pmatrix} 1 & 0 & 0 \ 0 & 1 & 0 \ 0 & 0 & 1 \end{pmatrix} $$

$$ \begin{aligned} \nabla \cdot \vec{E} &= \rho / \varepsilon_0 \ \nabla \cdot \vec{B} &= 0 \ \nabla \times \vec{E} &= -\partial\vec{B}/\partial t \ \nabla \times \vec{B} &= \mu_0\vec{J} + \mu_0\varepsilon_0\partial\vec{E}/\partial t \end{aligned} $$`

    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
  })

  it('renders multiple one-line display math blocks while streaming', () => {
    const content = String.raw`$$ \begin{pmatrix} 1 & 0 & 0 \ 0 & 1 & 0 \ 0 & 0 & 1 \end{pmatrix} $$

$$ \begin{aligned} \nabla \cdot \vec{E} &= \rho / \varepsilon_0 \ \nabla \cdot \vec{B} &= 0 \ \nabla \times \vec{E} &= -\partial\vec{B}/\partial t \ \nabla \times \vec{B} &= \mu_0\vec{J} + \mu_0\varepsilon_0\partial\vec{E}/\partial t \end{aligned} $$`

    const { container } = render(<MarkdownRenderer content={content} isStreaming />)

    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
  })

  it('renders sanitized raw HTML content', () => {
    render(<MarkdownRenderer content={'<div><span>Python</span></div>'} />)

    expect(screen.getByText('Python')).toBeInTheDocument()
  })

  it('sanitizes unsafe raw HTML attributes and URLs', () => {
    const { container } = render(
      <MarkdownRenderer content={'<a href="javascript:alert(1)" onclick="alert(1)">bad</a>'} />,
    )

    const link = container.querySelector('a')
    expect(link).not.toBeInTheDocument()
    expect(screen.getByText(/bad\s+\[blocked\]/)).toBeInTheDocument()
  })

  it('rewrites raw HTML Windows path links to local file links', () => {
    const filePath = 'C:/Users/test/project/file.ts'
    render(<MarkdownRenderer content={`<a href="${filePath}">file.ts</a>`} />)

    const link = screen.getByRole('link', { name: 'file.ts' })
    expect(link).toHaveAttribute('href', `#opencode-local-file:${encodeURIComponent(filePath)}`)
    expect(link).toHaveAttribute('title', filePath)
  })

  it('keeps inline HTML structure inside markdown paragraphs', () => {
    const { container } = render(<MarkdownRenderer content={'Press <kbd>Ctrl</kbd> and **enter**'} />)

    const kbd = container.querySelector('kbd')
    expect(kbd).toHaveTextContent('Ctrl')
    expect(screen.getByText('enter').tagName).toBe('STRONG')
  })

  it('removes unsafe CSS URLs from raw HTML styles', () => {
    const { container } = render(
      <MarkdownRenderer content={'<div style="background: url(javascript:alert(1)); color: red">bad</div>'} />,
    )

    const element = container.querySelector('div div')
    expect(element).toBeInTheDocument()
    expect(element).not.toHaveAttribute('style')
  })

  it('preserves safe inline styles in raw HTML', () => {
    render(<MarkdownRenderer content={'<div style="color:red;font-weight:bold">styled</div>'} />)

    const element = screen.getByText('styled')
    expect(element).toHaveAttribute('style')
    expect(element.getAttribute('style')).toMatch(/color:\s*red/i)
  })

  it('keeps external markdown links isolated from the app webview', () => {
    render(<MarkdownRenderer content={'[site](https://example.com/docs)'} />)

    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps external markdown image links isolated from the app webview', () => {
    render(<MarkdownRenderer content={'![avatar](https://example.com/avatar.png)'} />)

    const link = screen.getByRole('img', { name: 'avatar' }).closest('a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps React code and table renderers when reference definitions are present', () => {
    const content = [
      '[OpenCode][docs]',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '[docs]: https://example.com/docs',
    ].join('\n')

    render(<MarkdownRenderer content={content} />)

    expect(screen.getByRole('link', { name: 'OpenCode' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('renders mermaid code fences as diagrams', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument()
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false, theme: 'default' }),
    )
  })

  it('renders completed mermaid diagrams in stable streaming blocks', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```\n\nstill typing'} isStreaming />)

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.getByText('still typing')).toBeInTheDocument()
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
  })

  it('reuses cached mermaid output after remounting', async () => {
    const content = '```mermaid\ngraph TD\n  A-->B\n```'
    const first = render(<MarkdownRenderer content={content} />)
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    first.unmount()

    render(<MarkdownRenderer content={content} />)

    expect(screen.getByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Rendering diagram')).not.toBeInTheDocument()
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
  })

  it('scopes cached mermaid ids for each mounted diagram', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg id="diagram"><defs><marker id="diagram-arrow"></marker></defs><path marker-end="url(#diagram-arrow)"></path></svg>',
    })
    render(
      <MarkdownRenderer
        content={'```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph TD\n  A-->B\n```'}
      />,
    )

    const diagrams = await screen.findAllByRole('img', { name: 'Mermaid diagram' })
    const firstSvg = diagrams[0].querySelector('svg')
    const secondSvg = diagrams[1].querySelector('svg')
    const firstMarker = firstSvg?.querySelector('marker')
    const secondMarker = secondSvg?.querySelector('marker')

    expect(firstSvg?.id).not.toBe(secondSvg?.id)
    expect(firstMarker?.id).not.toBe(secondMarker?.id)
    expect(firstSvg?.querySelector('path')).toHaveAttribute('marker-end', `url(#${firstMarker?.id})`)
    expect(secondSvg?.querySelector('path')).toHaveAttribute('marker-end', `url(#${secondMarker?.id})`)
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
  })

  it('defers incomplete streaming mermaid diagrams as code blocks', () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveTextContent(/mermaid:graph TD\s+A-->B/)
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-defer-highlight', 'true')
    expect(mermaidMocks.render).not.toHaveBeenCalled()
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
    const copyButton = screen.getByTestId('copy-button')
    expect(copyButton).toBeInTheDocument()
    expect(copyButton.closest('th')).toBeInTheDocument()
    expect(copyButton.parentElement).toHaveClass('absolute')
    expect(copyButton.parentElement).toHaveClass('inset-y-0')
    expect(copyButton.closest('th')?.querySelector('.pr-8')).toBeInTheDocument()
    expect(copyButton.closest('tr')).toHaveClass('hover:bg-bg-200/12')
  })

  it('keeps table text cells unwrapped and ignores alignment styles like the old renderer', () => {
    const md = '| 类别 | 数量 |\n|:---|---:|\n| 代码块 | 7 |\n| 表格 | 2 |'
    const { container } = render(<MarkdownRenderer content={md} />)

    const cells = Array.from(container.querySelectorAll('th, td'))
    expect(cells).toHaveLength(6)
    for (const cell of cells) {
      expect(cell).not.toHaveAttribute('style')
    }

    expect(container.querySelector('thead th:first-child span')).not.toBeInTheDocument()
    expect(container.querySelector('tbody td span')).not.toBeInTheDocument()

    const lastHeaderText = container.querySelector('thead th:last-child .pr-8')
    expect(lastHeaderText).toHaveTextContent('数量')
    expect(lastHeaderText?.querySelector('span')).not.toBeInTheDocument()
  })

  it('keeps legacy spacing structure for consecutive markdown tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n\n| C | D |\n|---|---|\n| 3 | 4 |'
    const { container } = render(<MarkdownRenderer content={md} />)

    const tableWrappers = Array.from(container.querySelectorAll('table')).map(table => table.parentElement?.parentElement)
    expect(tableWrappers).toHaveLength(2)
    for (const wrapper of tableWrappers) {
      expect(wrapper).toBeInTheDocument()
      if (!wrapper) continue
      expect(wrapper).toHaveClass('my-5')
      expect(wrapper.className).toContain('first:mt-0')
      expect(wrapper.className).toContain('last:mb-0')
      expect(wrapper.parentElement).toHaveClass('space-y-4')
      expect(wrapper.parentElement).toHaveClass('whitespace-normal')
    }
  })

  it('renders streaming markdown table with copy button in default mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} isStreaming />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('renders markdown table without copy button in reasoning mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} variant="reasoning" />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument()
  })

  it('renders markdown images as plain img links without wrapper controls', () => {
    render(<MarkdownRenderer content={'![avatar](https://example.com/avatar.png)'} />)

    const img = screen.getByRole('img', { name: 'avatar' })
    expect(img).toBeInTheDocument()
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(screen.queryByTitle('Download image')).not.toBeInTheDocument()
  })

  it('reserves image dimensions when the source URL includes them', () => {
    render(<MarkdownRenderer content={'![sample](https://picsum.photos/400/200)'} />)

    expect(screen.getByRole('img', { name: 'sample' })).toHaveAttribute('width', '400')
    expect(screen.getByRole('img', { name: 'sample' })).toHaveAttribute('height', '200')
  })

  it('blocks data image markdown sources through hardening', () => {
    render(<MarkdownRenderer content={'![dot](data:image/png;base64,iVBORw0KGgo=)'} />)

    expect(screen.queryByRole('img', { name: 'dot' })).not.toBeInTheDocument()
    expect(screen.getByText('[Image blocked: dot]')).toBeInTheDocument()
  })

  it('blocks unsafe markdown image sources', () => {
    render(<MarkdownRenderer content={'![bad](javascript:alert(1))'} />)

    expect(screen.queryByRole('img', { name: 'bad' })).not.toBeInTheDocument()
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
