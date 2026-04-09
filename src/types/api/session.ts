import type { Session as SDKSession, SessionStatus as SDKSessionStatus } from '@opencode-ai/sdk/v2/client'

export type SessionStatus = SDKSessionStatus

export type SessionStatusMap = Record<string, SessionStatus>

export type SessionSummary = NonNullable<SDKSession['summary']>

export type SessionShare = NonNullable<SDKSession['share']>

export type SessionRevert = NonNullable<SDKSession['revert']>

export type Session = SDKSession

export interface SessionListParams {
  directory?: string
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}

export interface SessionCreateParams {
  title?: string
  directory?: string
}

export interface SessionUpdateParams {
  title?: string
  summary?: SessionSummary
}

export interface SessionForkParams {
  messageID?: string
  directory?: string
}
