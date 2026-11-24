import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PluginSecrets, PluginServerContext } from '../../../sdk/server.ts'
import { getSettings } from '../settings.ts'
import { locateLark, type LarkBin } from './locate.ts'

/**
 * 飞书的登录从插件参数搬到面板的「账号授权」（用户 2026-11-24：「账号授权里加飞书，飞书插件用账号授权的」，面板插件接口 19）：
 * - lark-cli 的安装、登录、路径看账号授权（ctx.integrations.get('feishu')）
 * - 不装 lark-cli 时的 token 存在账号授权的备用登录里（ctx.integrations.credentials('feishu')），键名沿用 1.1.0 的
 * 设置里还填着「lark-cli 路径」时照旧用填的（装在面板找不到的地方时的退路）
 */

export const INTEGRATION = 'feishu'

/** 1.1.0 放在插件保密项里的键 → 搬到账号授权的同名键 */
const OLD_SECRETS = ['userToken', 'refreshToken', 'appSecret']
/** 1.1.0 放在插件普通参数里的键 */
const OLD_PLAIN = ['appId', 'brand']

/** 面板设置里这个插件存过的参数原值（含清单里已经去掉的键） */
const savedConfig = async () => ((await getSettings()).plugins?.feishu?.config ?? {}) as Record<string, unknown>

/** 登录信息存哪：账号授权的备用登录；面板太旧没有时退回插件自己的保密项（读得到 1.1.0 存的） */
export function credentialsOf(ctx: PluginServerContext): PluginSecrets | undefined {
  return ctx.integrations?.credentials(INTEGRATION) ?? ctx.secrets
}

/**
 * 一次性把 1.1.0 填在插件里的 token 搬进账号授权：账号授权那边已经有值的不覆盖，搬完清掉插件里的保密项。
 * 搬过记在数据目录里，用户以后在账号授权里清空也不会再搬回来
 */
export async function migrateLogin(ctx: PluginServerContext, saved?: () => Promise<Record<string, unknown>>) {
  const to = ctx.integrations?.credentials(INTEGRATION)
  if (!to) return
  const mark = path.join(ctx.dataDir, 'login-moved.json')
  if (await readFile(mark, 'utf8').catch(() => '')) return
  const moved: string[] = []
  for (const k of OLD_SECRETS) {
    const old = ctx.secrets ? (await ctx.secrets.get(k)).trim() : ''
    if (old && !(await to.get(k))) {
      await to.set(k, old)
      moved.push(k)
    }
    if (old) await ctx.secrets?.set(k, '')
  }
  // 1.2.0 的清单里没有 appId、brand 了，ctx.config() 不再给它们：从面板设置里存的原值读
  const raw = await (saved ?? savedConfig)().catch(() => ({}) as Record<string, unknown>)
  for (const k of OLD_PLAIN) {
    const old = String(raw[k] ?? '').trim()
    if (old && !(await to.get(k))) {
      await to.set(k, old)
      moved.push(k)
    }
  }
  await writeFile(mark, JSON.stringify({ at: new Date().toISOString(), moved }))
  if (moved.length) ctx.log.info('飞书登录信息已搬到账号授权', { keys: moved })
}

export interface LarkFound extends LarkBin {
  /** 账号授权报告的登录状态；设置里填了路径、或面板太旧时没有 */
  authed?: boolean
  account?: string
  version?: string
}

/**
 * 找 lark-cli：设置里填了路径用填的；否则用账号授权检测到的那个（和设置页显示的一致）；面板太旧没有账号授权时自己找。
 * 账号授权给的路径落在插件的拦截垫片目录里时不认（垫片和真命令同名），退回自己找
 */
export async function locateViaIntegration(
  ctx: PluginServerContext,
  configured: string,
  shimDir: string,
  force = false,
): Promise<LarkFound | undefined> {
  if (configured || !ctx.integrations) return locateLark(configured, shimDir, force)
  const s = await ctx.integrations.get(INTEGRATION, force)
  const inShim = !!s?.path && path.resolve(path.dirname(s.path)) === path.resolve(shimDir)
  if (!s?.installed || !s.path || inShim) return locateLark('', shimDir, force)
  return { path: s.path, from: 'integration', authed: s.authed, account: s.account, version: s.version }
}
