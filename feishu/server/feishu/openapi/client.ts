import { t } from '../../../shared/i18n.ts'
import type { LarkResult } from '../cli.ts'

/**
 * 直接调飞书开放接口（用户 2026-11-24：没装 lark-cli 时用登录好的 user_access_token）。
 * 只用用户身份（Authorization: Bearer user_access_token），和 lark-cli 的 --as user 一样，权限就是用户本人在飞书里的权限。
 *
 * 令牌：保密项（面板 ctx.secrets，加密存本机、不进设置和环境变量）。user_access_token 大约 2 小时过期，
 * 填了 refresh_token 和应用的 App ID / App Secret 时，过期（或接口说令牌失效）就用 /authen/v2/oauth/token 换新的、存回去。
 * 结果统一成和 lark-cli 一样的 LarkResult，权限闸、审计、结果整理都不用分两套
 */

export interface TokenStore {
  get: (key: 'userToken' | 'refreshToken' | 'appSecret') => Promise<string>
  set: (key: 'userToken' | 'refreshToken', value: string) => Promise<void>
}

export interface ApiDeps {
  /** 开放接口的根地址：飞书 https://open.feishu.cn，Lark https://open.larksuite.com */
  base: () => string | Promise<string>
  /** App ID 和平台都在面板「账号授权」的备用登录里（插件接口 19），读取是异步的 */
  appId: () => string | Promise<string>
  secrets: TokenStore
  /** 令牌过期时间（毫秒时间戳，不是机密，存插件数据目录） */
  expiry: { get: () => Promise<number>; set: (at: number) => Promise<void> }
  fetch: (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>
}

export interface ApiCall {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** 下载类接口：返回二进制 */
  binary?: boolean
  signal?: AbortSignal
}

/** 接口说「令牌过期 / 无效」的错误码（飞书开放平台通用错误码） */
const TOKEN_CODES = new Set([99991677, 99991668, 99991663, 99991664, 99991669, 20005, 20026])
/** 过期前这么久就先换，免得用到一半失效 */
const EARLY_MS = 5 * 60_000

const err = (message: string, type = 'api', code?: number, hint?: string): LarkResult => ({
  ok: false,
  error: { type, code, message, ...(hint ? { hint } : {}) },
})

export const noToken = (): LarkResult =>
  err(
    t('没有可用的飞书登录：本机没找到 lark-cli，设置里也没填 user_access_token。'),
    'not_installed',
    undefined,
    t(
      '请用户打开面板 设置 →「账号授权」→ 飞书 CLI，二选一：一键安装 lark-cli 并浏览器授权；或在「备用登录」里填 user_access_token（想自动续期再填 refresh_token、App ID 和 App Secret）。',
    ),
  )

export class FeishuApi {
  // 同一时间只换一次令牌：几个调用同时发现过期时共用一次刷新
  private refreshing: Promise<boolean> | undefined
  constructor(private d: ApiDeps) {}

  async hasToken() {
    return !!(await this.d.secrets.get('userToken')) || !!(await this.d.secrets.get('refreshToken'))
  }

  /** 能不能自动续期：refresh_token、App ID、App Secret 三样都要有 */
  async canRefresh() {
    return !!((await this.d.appId()) && (await this.d.secrets.get('refreshToken')) && (await this.d.secrets.get('appSecret')))
  }

  async expiresAt() {
    return this.d.expiry.get()
  }

  /** 用 refresh_token 换新令牌，成功后新的 access / refresh 都存回保密项 */
  refresh(signal?: AbortSignal): Promise<boolean> {
    this.refreshing ??= this.doRefresh(signal).finally(() => (this.refreshing = undefined))
    return this.refreshing
  }

  private async doRefresh(signal?: AbortSignal) {
    if (!(await this.canRefresh())) return false
    const res = await this.d
      .fetch(`${await this.d.base()}/open-apis/authen/v2/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: await this.d.appId(),
          client_secret: await this.d.secrets.get('appSecret'),
          refresh_token: await this.d.secrets.get('refreshToken'),
        }),
        signal,
        timeoutMs: 20_000,
      })
      .catch(() => undefined)
    const j = (await res?.json().catch(() => undefined)) as Record<string, unknown> | undefined
    // 正式接口的回包是平铺的（官方 SDK OAuthTokenResp），也兼容包在 data 里的
    const body = (j?.access_token ? j : (j?.data as Record<string, unknown> | undefined)) ?? {}
    const access = typeof body.access_token === 'string' ? body.access_token : ''
    if (!access) return false
    await this.d.secrets.set('userToken', access)
    if (typeof body.refresh_token === 'string' && body.refresh_token)
      await this.d.secrets.set('refreshToken', body.refresh_token)
    const sec = Number(body.expires_in)
    await this.d.expiry.set(Number.isFinite(sec) && sec > 0 ? Date.now() + sec * 1000 : 0)
    return true
  }

  private async token(signal?: AbortSignal) {
    const exp = await this.d.expiry.get()
    if (exp && exp - Date.now() < EARLY_MS && (await this.canRefresh())) await this.refresh(signal)
    return this.d.secrets.get('userToken')
  }

  /** 调一次接口；令牌失效时能续期就续一次再试 */
  async call(c: ApiCall): Promise<LarkResult> {
    let tk = await this.token(c.signal)
    if (!tk && (await this.refresh(c.signal))) tk = await this.d.secrets.get('userToken')
    if (!tk) return noToken()
    const first = await this.once(c, tk)
    if (!first.expired) return first.r
    if (!(await this.refresh(c.signal)))
      return err(
        t('飞书登录已过期（user_access_token 失效）。'),
        'auth',
        first.r.error?.code,
        (await this.canRefresh())
          ? t('自动续期也失败了：refresh_token 可能也过期了，请用户重新获取 token 填进设置。')
          : t(
              '请用户在面板 设置 →「账号授权」→ 飞书 CLI →「备用登录」里填新的 user_access_token；同时填 refresh_token、App ID 和 App Secret 就能自动续期。',
            ),
      )
    return (await this.once(c, await this.d.secrets.get('userToken'))).r
  }

  private async once(c: ApiCall, tk: string): Promise<{ r: LarkResult; expired?: boolean }> {
    const url = new URL(`${await this.d.base()}${c.path}`)
    for (const [k, v] of Object.entries(c.query ?? {}))
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    let res: Response
    try {
      res = await this.d.fetch(url.toString(), {
        method: c.method ?? 'GET',
        headers: {
          authorization: `Bearer ${tk}`,
          ...(c.body !== undefined ? { 'content-type': 'application/json; charset=utf-8' } : {}),
        },
        body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
        signal: c.signal,
        timeoutMs: 60_000,
      })
    } catch (e) {
      if (c.signal?.aborted) return { r: err(t('调用被取消'), 'cancelled') }
      return { r: err(t('连不上飞书开放接口：{why}', { why: (e as Error).message }), 'network') }
    }
    const type = res.headers.get('content-type') ?? ''
    if (c.binary && res.ok && !type.includes('application/json'))
      return { r: { ok: true, data: Buffer.from(await res.arrayBuffer()) } }
    const text = await res.text()
    let j: Record<string, unknown> | undefined
    try {
      j = JSON.parse(text) as Record<string, unknown>
    } catch {
      j = undefined
    }
    const code = typeof j?.code === 'number' ? j.code : res.ok ? 0 : -1
    if (res.ok && code === 0) return { r: { ok: true, data: j?.data ?? {} } }
    const msg = String(j?.msg ?? j?.message ?? (text.slice(0, 300) || res.statusText))
    if (res.status === 401 || TOKEN_CODES.has(code)) return { r: err(msg, 'auth', code), expired: true }
    return {
      r: err(
        t('飞书开放接口报错（{code}）：{msg}', { code, msg }),
        res.status === 403 || code === 1254302 || code === 131006 ? 'permission' : 'api',
        code,
      ),
    }
  }
}
