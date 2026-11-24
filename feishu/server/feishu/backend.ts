/**
 * 选这次走哪条路（用户 2026-11-24 加「用 token 登录」）：
 * - auto：找得到 lark-cli 就用它（功能最全）；找不到、又填了 token 时直接调开放接口
 * - cli：只用 lark-cli（找不到就报没装）
 * - token：只用 token（本机有 lark-cli 也不用）
 * 两条路的权限闸、审计、结果整理是同一套，只在「怎么归一链接」和「怎么执行」两处分开
 */
export type AuthMode = 'auto' | 'cli' | 'token'

export const authModeOf = (v: unknown): AuthMode => (v === 'cli' || v === 'token' ? v : 'auto')

export async function pickRoute(
  mode: AuthMode,
  hasCli: () => Promise<boolean>,
  hasToken: () => Promise<boolean>,
): Promise<'cli' | 'api'> {
  if (mode === 'cli') return 'cli'
  if (mode === 'token') return 'api'
  if (await hasCli()) return 'cli'
  return (await hasToken()) ? 'api' : 'cli'
}
