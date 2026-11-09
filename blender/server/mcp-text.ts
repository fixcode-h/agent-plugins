import type { McpResult } from '../../sdk/server.ts'

/** 只有一段文字的 MCP 结果 */
export const mcpText = (text: string, isError = false): McpResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})
