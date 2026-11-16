import { Unlink } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card, ErrorText, LinkBtn, Note } from '../../ui.tsx'
import type { LeakResult } from './debug-types.ts'
import { LeakList } from './DebugViews.tsx'

/**
 * Lua 持有的已销毁 UObject（设计稿四.4）：专查「关了界面控件释放不掉」。走一遍 Lua 堆会卡一下游戏线程，只在点按钮时扫
 */
export function DebugLeaks() {
  const { project, target } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [res, setRes] = useState<LeakResult>()
  const [error, setError] = useState('')
  const scan = () =>
    run('scan', async () => {
      try {
        setRes(await op<LeakResult>(project.id, 'lua.leaks', { limit: 200 }, target, 60000))
        setError('')
      } catch (e) {
        setError((e as Error).message)
      }
    })
  return (
    <Card
      title={
        <>
          <Unlink className="ue:h-4 ue:w-4 ue:text-subtle" /> {t('Lua 持有的已销毁对象')}
        </>
      }
      aside={
        res?.report && (
          <LinkBtn onClick={() => void navigator.clipboard?.writeText(res.report!)}>{t('复制完整结果路径')}</LinkBtn>
        )
      }
      bodyClass="ue:flex ue:flex-col"
    >
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <ui.Button size="sm" disabled={busy === 'scan'} onClick={() => void scan()}>
          {busy === 'scan' ? t('扫描中…') : t('扫描')}
        </ui.Button>
        {res && (
          <span className="ue:text-caption ue:text-subtle">
            {t('{n} 项 · 走了 {v} 个表和函数 · {ms} ms', {
              n: res.total,
              v: res.visited.toLocaleString(),
              ms: res.ms,
            })}
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {res?.truncated && (
        <div className="ue:px-3 ue:pt-3">
          <Note>{t('Lua 堆太大，只走了前一部分，结果可能不全')}</Note>
        </div>
      )}
      {!res && !error && (
        <p className="ue:px-3 ue:py-3 ue:text-footnote ue:text-subtle">
          {t('列出 Lua 还拿着、但 UObject 已经销毁或所在世界已经关了的对象。先关掉要查的界面，再扫描')}
        </p>
      )}
      {res && !res.items.length && (
        <p className="ue:px-3 ue:py-3 ue:text-footnote ue:text-subtle">{t('没找到：Lua 没有拿着已经销毁的对象')}</p>
      )}
      {!!res?.items.length && (
        <div className="ue:max-h-[420px] ue:overflow-auto">
          <LeakList items={res.items} />
        </div>
      )}
      {res?.note && <p className="ue:px-3 ue:py-2 ue:text-caption ue:text-subtle">{res.note}</p>}
    </Card>
  )
}
