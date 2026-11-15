import { Search } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { ppost } from '../../api.ts'
import { h } from '../../host.ts'
import { SplitHandle, usePane } from '../../split.tsx'

/**
 * AssetForge、GameTest 的左边列表栏：照面板的 ListPane（表格页也是它）画——标题和数量、右边的按钮、
 * 搜索框、分段筛选，下面是文件树，底部一行说明或作业进度。宽度可拖、记在本机。
 * 搜索只筛已经拿到的列表，不发请求给 UE。
 */
export function ListCol({
  id,
  title,
  count,
  extra,
  query,
  onQuery,
  placeholder,
  tabs,
  children,
  footer,
}: {
  id: string
  title: string
  count: number | string
  extra?: ReactNode
  query: string
  onQuery: (q: string) => void
  placeholder: string
  tabs?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const pane = usePane(`list-${id}`, '316px', 240)
  const ref = useRef<HTMLElement>(null)
  return (
    <aside
      ref={ref}
      style={pane.style('calc(100% - 420px)')}
      className="ue:relative ue:flex ue:min-h-0 ue:shrink-0 ue:flex-col ue:border-b ue:border-line ue:bg-panel ue:md:w-(--ue-w) ue:md:max-w-(--ue-max) ue:md:border-r ue:md:border-b-0"
    >
      <div className="ue:flex ue:flex-col ue:gap-2.5 ue:px-4 ue:pt-4 ue:pb-2.5">
        <div className="ue:flex ue:items-center ue:gap-2">
          <h1 title={title} className="ue:min-w-0 ue:truncate ue:text-lg ue:font-semibold ue:text-fg">
            {title}
          </h1>
          <span className="ue:shrink-0 ue:rounded-(--c-badge-radius) ue:bg-hover ue:px-1.5 ue:text-footnote ue:text-muted ue:tabular-nums">
            {count}
          </span>
          <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1.5">{extra}</div>
        </div>
        <label className="ue:relative ue:block">
          <Search className="ue:pointer-events-none ue:absolute ue:top-1/2 ue:left-3 ue:h-4 ue:w-4 ue:-translate-y-1/2 ue:text-subtle" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="ue:h-8 ue:w-full ue:rounded-(--c-input-radius) ue:border ue:border-line-strong ue:bg-field ue:pr-3 ue:pl-9 ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle ue:focus:border-focus"
          />
        </label>
        {tabs}
      </div>
      <div className="ue:flex ue:max-h-[50vh] ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-y-auto ue:px-2 ue:pb-2 ue:md:max-h-none">
        {children}
      </div>
      {footer && (
        <div className="ue:flex ue:flex-col ue:gap-1.5 ue:border-t ue:border-line ue:px-4 ue:pt-2.5 ue:pb-3 ue:text-caption ue:leading-relaxed ue:text-subtle">
          {footer}
        </div>
      )}
      <SplitHandle pane={pane} paneRef={ref} reserve={() => 420} edge />
    </aside>
  )
}

/** 推给网页的扩展事件（服务端 uekit/stream.ts）：{ project, event, ...字段 } */
export interface ExtEvent {
  project: string
  event: string
  [k: string]: unknown
}

/**
 * 订阅这个项目的 forge.* / gt.* 实时事件：每次连上面板推送都向服务端登记一次（服务端据此连 UE 的推送通道），
 * 收到的事件按项目过滤后交给 fn。不轮询（面板规则：实时数据用推送）
 */
export function useExtEvents(project: string, fn: (e: ExtEvent) => void) {
  const { events } = h()
  const cb = useRef(fn)
  cb.current = fn
  useEffect(() => {
    const register = (conn: string) => void ppost(project, 'ext/watch', { conn }).catch(() => undefined)
    const offConnect = events.onConnect(register)
    if (events.conn()) register(events.conn())
    const off = events.on('uekit', (d) => {
      const e = d as ExtEvent
      if (e?.project === project) cb.current(e)
    })
    return () => {
      offConnect()
      off()
    }
  }, [project, events])
}
