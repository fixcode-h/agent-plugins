import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/ui/empty-panel'
import { IconButton } from '@/components/ui/icon-button'
import { SearchBox } from '@/components/ui/search-box'
import { StatusPill, type StatusTone } from '@/components/ui/status-pill'

interface Status {
  cli?: string
  bin?: string
  login?: string
  loginError?: string
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
        <IconButton icon={RefreshCw} label={t('重新检测')} size="2xs" className="fs:ml-auto" onClick={reload} />
      </div>
      <div className="fs:flex fs:flex-col fs:gap-1 fs:rounded-lg fs:border fs:border-line fs:bg-card fs:px-3.5 fs:py-2.5">
        {!s ? (
          <span className="fs:text-footnote fs:text-subtle">{t('检测中…')}</span>
        ) : s.cli ? (
          <>
            <div className="fs:flex fs:items-center fs:gap-2 fs:text-body fs:text-fg">
              <StatusPill tone={s.loginError ? 'wait' : 'ok'}>{s.loginError ? t('没登录') : t('已就绪')}</StatusPill>
              <span className="fs:truncate">{s.cli}</span>
              <span className="fs:truncate fs:text-footnote fs:text-subtle">{s.bin}</span>
            </div>
            {s.loginError && (
              <p className="fs:text-footnote fs:text-warning">
                {t('还没登录飞书：在终端跑 lark-cli auth login（{why}）', { why: s.loginError })}
              </p>
            )}
            {s.login && <p className="fs:truncate fs:font-mono fs:text-footnote fs:text-subtle">{s.login}</p>}
          </>
        ) : (
          <p className="fs:text-footnote fs:text-warning">
            {t(
              '没找到 lark-cli（{bin}）。先在终端装好并登录：npx @larksuite/cli@latest install，然后 lark-cli auth login',
              {
                bin: s.bin ?? 'lark-cli',
              },
            )}
          </p>
        )}
      </div>
      <p className="fs:text-footnote fs:text-subtle">
        {t(
          '只经本机 lark-cli 读写。Agent 能直接读的只有你在对话里贴过的链接；引用的文档、搜索、写入都会弹卡问你。终端里直接调 lark-cli 会被拦下，但 Agent 用 lark-cli 的完整路径从脚本里调时拦不到。',
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
