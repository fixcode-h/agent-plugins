import { Box, Copy, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../../host.ts'
import { copyText } from '@panel/web/src/components/ui/item-menu'
import { ErrorText } from '../../../ui.tsx'
import type { PropsData } from '../gt-ref/live.ts'
import { normalizeGroups } from '../gt-ref/props-shape.ts'
import { PropDetails } from '../gt-ref/PropDetails.tsx'

const noop = () => {}

/**
 * 失败证据里「这一步用到的对象」（测试页梳理 F4，GameTest 2.3.1 起）：失败那一刻按路径读了一次它的属性存成 object.json，
 * 点开按细节面板画（和抓取、判断属性同一个 PropDetails），不用再开游戏重跑去看当时它是什么状态。只读，不连 UE
 */
export function EvidenceObject({
  o,
  loadText,
}: {
  o: { path: string; name?: string; class?: string; props?: string; error?: string }
  loadText?: (path: string) => Promise<{ text: string; truncated?: boolean }>
}) {
  const { ui } = h()
  const [data, setData] = useState<PropsData>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const open = () => {
    if (!o.props || !loadText) return
    setLoading(true)
    setError('')
    loadText(o.props)
      .then((r) => {
        // 读文件接口太长会截断：截断的 JSON 解析不了，说清楚去哪看全文
        if (r.truncated) throw new Error(t('属性文件太大，这里读不全：复制路径用编辑器打开 {p}', { p: o.props! }))
        const raw = JSON.parse(r.text) as PropsData
        setData({ ...raw, groups: normalizeGroups(raw) })
      })
      .catch((x: Error) => setError(x.message))
      .finally(() => setLoading(false))
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
        <Box className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
        <span className="ue:min-w-0 ue:truncate ue:text-fg">
          {t('这一步用到的对象：{n}', { n: o.name || o.path })}
          {o.class && <span className="ue:ml-1 ue:text-subtle">{o.class}</span>}
        </span>
        <ui.IconButton icon={Copy} size="sm" label={t('复制对象路径')} onClick={() => copyText(o.path)} />
        {o.props && (
          <ui.Button
            size="sm"
            variant="secondary"
            className="ue:ml-auto"
            disabled={!loadText || loading}
            onClick={open}
          >
            {loading && <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />}
            {data ? t('重新读') : t('看失败时的属性')}
          </ui.Button>
        )}
      </div>
      {o.error && <p className="ue:text-subtle">{t('没读到它的属性：{e}', { e: o.error })}</p>}
      <ErrorText>{error}</ErrorText>
      {data && (
        <div className="ue:flex ue:h-80 ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
          <PropDetails data={data} picked={[]} onPick={noop} className="ue:flex-1" />
        </div>
      )}
    </div>
  )
}
