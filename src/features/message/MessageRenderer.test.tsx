import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageRenderer } from './MessageRenderer'
import type { Message } from '../../types/message'

vi.mock('motion/mini', () => ({
  animate: () => Promise.resolve(),
}))

vi.mock('../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
}))

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    collapseUserMessages: false,
    stepFinishDisplay: { turnDuration: false },
    descriptiveToolSteps: false,
    inlineToolRequests: false,
    immersiveMode: false,
  }),
}))

vi.mock('../../components/ui', () => ({
  CopyButton: ({ text }: { text: string }) => <button type="button">copy:{text}</button>,
  SmoothHeight: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./parts', () => ({
  TextPartView: ({ part }: { part: { text: string } }) => <div>{part.text}</div>,
  ReasoningPartView: () => null,
  ToolPartView: () => null,
  FilePartView: () => null,
  AgentPartView: () => null,
  SyntheticTextPartView: () => null,
  StepFinishPartView: () => null,
  SubtaskPartView: () => null,
  RetryPartView: () => null,
  CompactionPartView: () => null,
  MessageErrorView: () => null,
}))

function createAssistantMessage(): Message {
  return {
    info: {
      id: 'assistant-1',
      sessionID: 'session-1',
      role: 'assistant',
      parentID: 'user-1',
      modelID: 'model-1',
      providerID: 'provider-1',
      mode: 'chat',
      agent: 'build',
      path: { cwd: '/workspace', root: '/workspace' },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: 1 },
    },
    parts: [
      {
        id: 'text-1',
        sessionID: 'session-1',
        messageID: 'assistant-1',
        type: 'text',
        text: 'assistant reply',
      },
    ],
    isStreaming: false,
  }
}

describe('MessageRenderer assistant fork', () => {
  it('passes the explicit fork target id when forking an assistant message', async () => {
    const onFork = vi.fn()
    const message = createAssistantMessage()

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    fireEvent.click(screen.getByRole('button', { name: /fork|分叉/i }))

    await waitFor(() => {
      expect(onFork).toHaveBeenCalledWith(message, 'assistant-2')
    })
  })
})
