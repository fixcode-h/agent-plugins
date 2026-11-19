import { Search } from 'lucide-react'
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { ppost } from '../../api.ts'
import { h } from '../../host.ts'
import { DockCol, SubNavAside } from '../../nav/slot.tsx'
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
  shelf,
  children,
  footer,
  onBodyMenu,
  searchExtra,
  searchAddon,
}: {
  id: string
  title: string
  count: number | string
  extra?: ReactNode
  query: string
  onQuery: (q: string) => void
  placeholder: string
  tabs?: ReactNode
  /** 搜索框和页签之间常驻的一块（GameTest 的节点） */
  shelf?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** 右键列表空白处（行自己的右键菜单会拦下冒泡，到这里的只有空白处） */
  onBodyMenu?: (e: MouseEvent) => void
  /** 搜索框右边的按钮（AssetForge 的「新建配置」）：放这里不挤标题行 */
  searchExtra?: ReactNode
  /** 输入框里最右边的小控件（AssetForge 的同步状态筛选图标，见 FilterButton） */
  searchAddon?: ReactNode
}) {
  const pane = usePane(`list-${id}`, '316px', 240)
  const ref = useRef<HTMLElement>(null)
  const countBadge = (
    <span className="ue:shrink-0 ue:rounded-(--c-badge-radius) ue:bg-hover ue:px-1.5 ue:text-footnote ue:font-normal ue:text-muted ue:tabular-nums">
      {count}
    </span>
  )
  // docked：放进二级面板时面板标题已经是分区名，栏自己的大标题不再画
  const body = (docked: boolean) => (
    <>
      <div className="ue:flex ue:flex-col ue:gap-2.5 ue:px-4 ue:pt-4 ue:pb-2.5">
        {/* 栏拖窄时按钮整组换到下一行，不挤出栏外盖住右边的页面。
            放进二级面板时个数和按钮都挪到面板标题那一行（用户 2026-11-19：个数单独掉到标题下面一行、
            按钮又单独占一行太空），这里就不画了 */}
        {!docked && (
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-2">
            <h1 title={title} className="ue:min-w-0 ue:truncate ue:text-lg ue:font-semibold ue:text-fg">
              {title}
            </h1>
            {countBadge}
            <div className="ue:ml-auto ue:flex ue:shrink-0 ue:flex-wrap ue:items-center ue:justify-end ue:gap-1.5">
              {extra}
            </div>
          </div>
        )}
        {docked && (
          <SubNavAside>
            {countBadge}
            {extra && (
              <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:text-body ue:font-normal">
                {extra}
              </span>
            )}
          </SubNavAside>
        )}
        <div className="ue:flex ue:items-center ue:gap-1.5">
          <div className="ue:flex ue:h-8 ue:min-w-0 ue:flex-1 ue:items-center ue:gap-1 ue:rounded-(--c-input-radius) ue:border ue:border-line-strong ue:bg-field ue:pr-1 ue:focus-within:border-focus">
            <label className="ue:relative ue:flex ue:h-full ue:min-w-0 ue:flex-1 ue:items-center">
              <Search className="ue:pointer-events-none ue:absolute ue:top-1/2 ue:left-3 ue:h-4 ue:w-4 ue:-translate-y-1/2 ue:text-subtle" />
              <input
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className="ue:h-full ue:w-full ue:min-w-0 ue:bg-transparent ue:pr-2 ue:pl-9 ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle"
              />
            </label>
            {/* 放在 label 外面：点它不会把焦点抢回输入框 */}
            {searchAddon}
          </div>
          {searchExtra}
        </div>
        {shelf}
        {tabs}
      </div>
      <div
        onContextMenu={onBodyMenu}
        className="ue:flex ue:max-h-[50vh] ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-x-hidden ue:overflow-y-auto ue:px-2 ue:pb-2 ue:md:max-h-none"
      >
        {children}
      </div>
      {footer && (
        <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-1.5 ue:border-t ue:border-line ue:px-4 ue:pt-2.5 ue:pb-3 ue:text-caption ue:leading-relaxed ue:text-subtle">
          {footer}
        </div>
      )}
    </>
  )
  return (
    // 整栏放进左边二级面板（用户 2026-11-18 定：列表和二级面板并到一起）；面板太旧或二级面板收起时照旧是页里左边一栏。
    // 放进面板时抵掉面板自己的内边距，栏里的排版不用改
    <DockCol
      body={() => (
        <div className="ue:-mx-2.5 ue:-mb-2.5 ue:-mt-1 ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">{body(true)}</div>
      )}
      fallback={
        <aside
          ref={ref}
          style={pane.style('calc(100% - 420px)')}
          className="ue:relative ue:flex ue:min-h-0 ue:shrink-0 ue:flex-col ue:border-b ue:border-line ue:bg-panel ue:md:w-(--ue-w) ue:md:max-w-(--ue-max) ue:md:border-r ue:md:border-b-0"
        >
          {body(false)}
          <SplitHandle pane={pane} paneRef={ref} reserve={() => 420} edge />
        </aside>
      }
    />
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
