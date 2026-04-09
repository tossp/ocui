// ============================================
// PTY API - 终端管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { getApiBaseUrl, buildQueryString } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import type { Pty, PtyCreateParams, PtyUpdateParams } from '../types/api/pty'

/**
 * 获取所有 PTY 会话列表
 */
export async function listPtySessions(directory?: string): Promise<Pty[]> {
  const sdk = getSDKClient()
  return unwrap(await sdk.pty.list({ directory: formatPathForApi(directory) }))
}

/**
 * 创建新的 PTY 会话
 */
export async function createPtySession(params: PtyCreateParams, directory?: string): Promise<Pty> {
  const sdk = getSDKClient()
  return unwrap(await sdk.pty.create({ directory: formatPathForApi(directory), ...params }))
}

/**
 * 获取单个 PTY 会话信息
 */
export async function getPtySession(ptyId: string, directory?: string): Promise<Pty> {
  const sdk = getSDKClient()
  return unwrap(await sdk.pty.get({ ptyID: ptyId, directory: formatPathForApi(directory) }))
}

/**
 * 更新 PTY 会话
 */
export async function updatePtySession(ptyId: string, params: PtyUpdateParams, directory?: string): Promise<Pty> {
  const sdk = getSDKClient()
  return unwrap(await sdk.pty.update({ ptyID: ptyId, directory: formatPathForApi(directory), ...params }))
}

/**
 * 删除 PTY 会话
 */
export async function removePtySession(ptyId: string, directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.pty.remove({ ptyID: ptyId, directory: formatPathForApi(directory) }))
  return true
}

/**
 * 获取 PTY 连接 WebSocket URL
 *
 * WebSocket 不支持自定义 header，认证通过 URL userinfo 传递
 * 这部分必须手动拼，SDK 不处理 WebSocket
 */
export function getPtyConnectUrl(ptyId: string, directory?: string): string {
  const httpBase = getApiBaseUrl()
  const wsBase = httpBase.replace(/^http/, 'ws')

  const auth = serverStore.getActiveAuth()
  let wsUrl: string
  if (auth?.password) {
    const creds = `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password)}@`
    wsUrl = wsBase.replace('://', `://${creds}`)
  } else {
    wsUrl = wsBase
  }

  const formatted = formatPathForApi(directory)
  const queryString = buildQueryString({ directory: formatted })

  return `${wsUrl}/pty/${ptyId}/connect${queryString}`
}
