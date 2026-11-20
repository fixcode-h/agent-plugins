import { Braces, Component, Copy, Ghost, Recycle } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import { Note } from '../../../ui.tsx'
import type { LeakItem } from '../debug-types.ts'
import { StateBadge, type ShownState } from './parts.tsx'

/** lua.leaks 的种类 → 树和这里显示的状态（stale、destroyed 都是 UObject 已经没了） */
export const leakState = (k: LeakItem['kind']): ShownState =>
  k === 'garbage' ? 'garbage' : k === 'noworld' ? 'noworld' : 'destroyed'

/**
 * 树里点了一个「Lua 还拿着的已销毁对象」（设计稿效果图 3）：左右两张卡分别讲 UE 这边和 Lua 这边，
 * 下面说清后果和怎么改；「跑一次 Lua GC 再查」确认是不是真的收不掉
 */
export function LeakView({ item, onGcAndScan, busy }: { item: LeakItem; onGcAndScan?: () => void; busy?: boolean }) {
  const { ui, toast } = h()
  const st = leakState(item.kind)
  const ue: [string, ReactNode][] =
    st === 'destroyed'
      ? [
          [t('UObject'), <span className="ue:text-danger">{t('已经不在（被 UE 的垃圾回收收掉了）')}</span>],
          [t('影响'), t('Lua 里再调它的 UE 函数会报错；实例表上的字段还能读')],
        ]
      : [
          [t('UObject'), item.object ? <span className="ue:font-mono">{item.object}</span> : '—'],
          [t('UE 类'), item.class ? <span className="ue:font-mono">{item.class}</span> : '—'],
        ]
  const lua: [string, ReactNode][] = [
    [t('实例表'), t('还在，Lua 的垃圾回收收不掉')],
    [
      t('谁拿着'),
      item.path ? <span className="ue:font-mono">{item.path}</span> : t('只有 UnLua 的对象表拿着它'),
    ],
  ]
  return (
    <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-auto">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-3">
        <Ghost className="ue:h-4 ue:w-4 ue:text-danger" />
        <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">
          {item.module || item.class || t('（没认出模块）')}
        </span>
        <StateBadge state={st} />
        <span className="ue:ml-auto" />
        {item.path && (
          <ui.Button
            size="sm"
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(item.path!).then(() => toast.success(t('已复制')))}
          >
            <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制拿着它的路径')}
          </ui.Button>
        )}
        {onGcAndScan && (
          <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onGcAndScan}>
            <Recycle className="ue:h-3.5 ue:w-3.5" /> {t('跑一次 Lua GC 再查')}
          </ui.Button>
        )}
      </div>
      <div className="ue:grid ue:gap-px ue:border-b ue:border-line ue:bg-line ue:lg:grid-cols-2">
        <Side icon={<Component className="ue:h-3.5 ue:w-3.5 ue:text-run" />} title={t('UE 这边')} rows={ue} />
        <Side icon={<Braces className="ue:h-3.5 ue:w-3.5 ue:text-accent-text" />} title={t('Lua 这边')} rows={lua} />
      </div>
      <div className="ue:p-4">
        <Note>
          {item.path
            ? t('关掉界面、切走关卡后，{p} 还拿着这个对象的实例表：把它置 nil 或改成弱表，下次 Lua 垃圾回收就能收掉', {
                p: item.path,
              })
            : t('Lua 里没找到别的引用，只有 UnLua 的对象表还记着它；多半是 UnLua 销毁对象时没删掉这一项')}
        </Note>
      </div>
    </div>
  )
}

function Side({ icon, title, rows }: { icon: ReactNode; title: string; rows: [string, ReactNode][] }) {
  return (
    <div className="ue:bg-card ue:px-4 ue:py-3">
      <div className="ue:mb-2 ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:font-medium ue:text-fg">
        {icon} {title}
      </div>
      <dl className="ue:grid ue:grid-cols-[6rem_1fr] ue:gap-x-3 ue:gap-y-1 ue:text-footnote">
        {rows.map(([k, v]) => (
          <div key={k} className="ue:contents">
            <dt className="ue:text-subtle">{k}</dt>
            <dd className="ue:min-w-0 ue:break-all ue:text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
