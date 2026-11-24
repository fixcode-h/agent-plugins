import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { request } from '@/lib/api'
import { useNav } from '@/lib/data'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/ui/empty-panel'
import { IconButton } from '@/components/ui/icon-button'
import { SearchBox } from '@/components/ui/search-box'
import { StatusPill, type StatusTone } from '@/components/ui/status-pill'

interface Status {
  cli?: string
  bin?: string
  /** 在哪找到的：integration（账号授权）、config（设置里填的）、path、npm、common */
  binFrom?: string
  /** 账号授权报告的登录账号 */
  account?: string
  /** 设置里填的路径（空表示自动找） */
  configured?: string
  login?: string
  loginError?: string
  /** 设置里选的登录方式和这次实际走的路 */
  mode?: 'auto' | 'cli' | 'token'
  route?: 'cli' | 'api'
  token?: { set?: boolean; canRefresh?: boolean; expiresAt?: number; user?: string; error?: string }
}

/** token 登录的状态行（用户 2026-11-24 加「用 token 登录」） */
function TokenLine({ s }: { s: Status }) {
  const tk = s.token
  if (!tk) return null
  const using = s.route === 'api'
  const exp = tk.expiresAt ? new Date(tk.expiresAt).toLocaleString() : ''
  return (
    <div className="fs:flex fs:flex-col fs:gap-1 fs:rounded-lg fs:border fs:border-line fs:bg-card fs:px-3.5 fs:py-2.5">
      <div className="fs:flex fs:items-center fs:gap-2 fs:text-body fs:text-fg">
        <StatusPill tone={!tk.set ? 'idle' : tk.error ? 'wait' : 'ok'}>
          {!tk.set ? t('没填') : tk.error ? t('不能用') : t('可用')}
        </StatusPill>
        <span>{t('token 登录')}</span>
        {using && <span className="fs:text-footnote fs:text-subtle">{t('（现在用的是这个）')}</span>}
      </div>
      {tk.set && tk.user && (
        <p className="fs:text-footnote fs:text-subtle">{t('登录的飞书用户：{name}', { name: tk.user })}</p>
      )}
      {tk.set && tk.error && <p className="fs:text-footnote fs:text-warning">{tk.error}</p>}
      {tk.set && (
        <p className="fs:text-footnote fs:text-subtle">
          {tk.canRefresh
            ? exp
              ? t('会自动续期，当前令牌 {at} 过期', { at: exp })
              : t('会自动续期')
            : t(
                '不会自动续期：大约 2 小时后要重新填；在账号授权里同时填 refresh_token、App ID、App Secret 就能自动续期',
              )}
        </p>
      )}
      {!tk.set && using && (
        <p className="fs:text-footnote fs:text-warning">
          {t('登录方式选了只用 token，但账号授权的备用登录里还没填 user_access_token')}
        </p>
      )}
    </div>
  )
}

interface AuditEntry {
  at: string
  taskId: string
  label: string
  level: string
  target?: string
  title?: string
  result: 'auto' | 'once' | 'always' | 'denied' | 'error'
  detail?: string
}

/** 插件的接口挂在面板给插件的 /api/plugins/feishu/api/ 下 */
const BASE = '/plugins/feishu/api'

const RESULT: Record<AuditEntry['result'], { tone: StatusTone; text: () => string }> = {
  auto: { tone: 'ok', text: () => t('在范围内') },
  once: { tone: 'run', text: () => t('允许一次') },
  always: { tone: 'run', text: () => t('一直允许') },
  denied: { tone: 'wait', text: () => t('拒绝') },
  error: { tone: 'err', text: () => t('出错') },
}

/** lark-cli 在哪找到的 */
const FROM: Record<string, () => string> = {
  integration: () => t('账号授权检测到'),
  config: () => t('设置里填的路径'),
  path: () => t('自动找到（PATH）'),
  npm: () => t('自动找到（npm 全局目录）'),
  common: () => t('自动找到（常见安装目录）'),
}

/** 放行原因给人看的说法（审计里记的是代号） */
const WHY: Record<string, () => string> = {
  link: () => t('你贴过的链接'),
  card: () => t('卡片上允许'),
  created: () => t('这个对话新建的'),
  inherited: () => t('父对话允许过'),
  trusted: () => t('信任的知识库'),
  ref: () => t('引用（设置里关了询问）'),
  permission_denied: () => t('没允许'),
}

/** 设置 → 插件 → 飞书：lark-cli 状态 + 审计日志 */
export function FeishuStatus({ status, reload }: { status: Record<string, unknown> | undefined; reload: () => void }) {
  const s = status as Status | undefined
  const [q, setQ] = useState('')
  const [items, setItems] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const { openSettings } = useNav()

  const load = useCallback(async (query: string) => {
    setError('')
    try {
      setItems(await request<AuditEntry[]>(`${BASE}/audit?limit=200&q=${encodeURIComponent(query)}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => void load(q), [load, q])

  const clear = async () => {
    // 两步确认：第一次点变成「确定清空」，不弹浏览器对话框
    if (!clearing) return setClearing(true)
    setClearing(false)
    await request(`${BASE}/audit`, { method: 'DELETE' }).catch((e) => setError((e as Error).message))
    await load(q)
  }

  return (
    <section aria-label={t('飞书')} className="fs:flex fs:flex-col fs:gap-3">
      <div className="fs:flex fs:items-center fs:gap-2">
        <span className="fs:text-footnote fs:text-subtle">{t('lark-cli')}</span>
        <Button size="sm" variant="ghost" className="fs:ml-auto" onClick={() => openSettings('integrations')}>
          {t('去账号授权登录')}
        </Button>
        <IconButton icon={RefreshCw} label={t('重新检测')} size="2xs" onClick={reload} />
      </div>
      <div className="fs:flex fs:flex-col fs:gap-1 fs:rounded-lg fs:border fs:border-line fs:bg-card fs:px-3.5 fs:py-2.5">
        {!s ? (
          <span className="fs:text-footnote fs:text-subtle">{t('检测中…')}</span>
        ) : s.cli ? (
          <>
            <div className="fs:flex fs:items-center fs:gap-2 fs:text-body fs:text-fg">
              <StatusPill tone={s.loginError ? 'wait' : 'ok'}>{s.loginError ? t('没登录') : t('已就绪')}</StatusPill>
              <span className="fs:truncate">{s.cli}</span>
            </div>
            <p className="fs:truncate fs:text-footnote fs:text-subtle" title={s.bin}>
              {FROM[s.binFrom ?? '']?.() ?? ''}：{s.bin}
            </p>
            {s.account && !s.loginError && (
              <p className="fs:text-footnote fs:text-subtle">{t('登录的飞书用户：{name}', { name: s.account })}</p>
            )}
            {s.loginError && (
              <p className="fs:text-footnote fs:text-warning">
                {s.binFrom === 'integration'
                  ? t('还没登录飞书：点右上角「去账号授权登录」，在飞书 CLI 那张卡片上点「浏览器授权」。')
                  : t('还没登录飞书：在终端跑 lark-cli auth login（{why}）', { why: s.loginError })}
              </p>
            )}
            {s.login && <p className="fs:truncate fs:font-mono fs:text-footnote fs:text-subtle">{s.login}</p>}
          </>
        ) : s.route === 'api' && !s.configured ? (
          <p className="fs:text-footnote fs:text-subtle">
            {t('本机没装 lark-cli，现在用账号授权里填的备用 token 登录。')}
          </p>
        ) : (
          <p className="fs:text-footnote fs:text-warning">
            {s.configured
              ? t('设置里填的 lark-cli 路径不能用：{bin}。改成正确的完整路径，或者清空让面板自动找。', {
                  bin: s.configured,
                })
              : t(
                  '本机没找到 lark-cli。点右上角「去账号授权登录」，在飞书 CLI 那张卡片上一键安装、浏览器授权；不想装的话在同一张卡片的「备用登录」里填 token。',
                )}
          </p>
        )}
      </div>
      <TokenLine s={s ?? {}} />
      <p className="fs:text-footnote fs:text-subtle">
        {t(
          '只经本机 lark-cli 或你在账号授权里填的 token 读写。Agent 能直接读的只有你在对话里贴过的链接；引用的文档、搜索、写入都会弹卡问你。终端里直接调 lark-cli 会被拦下，但 Agent 用 lark-cli 的完整路径从脚本里调时拦不到。',
        )}
      </p>

      <div className="fs:flex fs:items-center fs:gap-2">
        <span className="fs:text-footnote fs:text-subtle">{t('审计日志（不记文档内容）')}</span>
        <Button size="sm" variant={clearing ? 'danger-outline' : 'ghost'} className="fs:ml-auto" onClick={clear}>
          {clearing ? t('确定清空') : t('清空')}
        </Button>
      </div>
      <SearchBox placeholder={t('按标题、token、对话筛选')} allowEmpty onSearch={setQ} />
      {error && <p className="fs:text-footnote fs:text-danger">{error}</p>}
      {items && !items.length ? (
        <EmptyPanel size="sm">{t('还没有飞书调用记录')}</EmptyPanel>
      ) : (
        <ul className="fs:flex fs:max-h-96 fs:flex-col fs:divide-y fs:divide-line fs:overflow-auto fs:rounded-lg fs:border fs:border-line fs:bg-card">
          {(items ?? []).map((e, i) => (
            <li key={`${e.at}-${i}`} className="fs:flex fs:items-center fs:gap-3 fs:px-3.5 fs:py-2">
              <StatusPill tone={RESULT[e.result]?.tone ?? 'idle'}>{RESULT[e.result]?.text() ?? e.result}</StatusPill>
              <div className="fs:min-w-0 fs:flex-1">
                <div className="fs:truncate fs:text-body fs:text-fg">
                  {e.label}
                  {e.title ? ` 《${e.title}》` : e.target ? ` ${e.target}` : ''}
                </div>
                <div className="fs:truncate fs:text-footnote fs:text-subtle">
                  {new Date(e.at).toLocaleString()} · {e.detail ? (WHY[e.detail]?.() ?? e.detail) : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
