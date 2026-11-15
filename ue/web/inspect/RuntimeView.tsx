import { useEffect, useRef } from 'react'
import { op, useLoad } from '../api.ts'
import { CompTree, type Comp } from '../CompTree.tsx'
import { useUe } from '../ctx.tsx'
import type { OpenHow } from '../details/RefChip.tsx'
import { t } from '../host.ts'
import { Inspect } from '../Inspect.tsx'
import { Props } from '../Props.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { Card } from '../ui.tsx'

/**
 * 运行时对象的检视（设计稿第 3 节的表，从原来的 Actor / Object 页抽出来）：
 * - Actor 实例：中间一栏组件树，右边选中组件（没选是 Actor 自己）的属性 / 函数 / Lua；
 * - UMG 控件：控件树 + 选中控件的参数（Inspect）；
 * - 其他对象（含类默认值，选到时醒目提示去改运行中的实例）：只有属性。
 * 先等「是不是 Actor」回来再决定布局，免得属性先按两栏读一遍、再换成三栏又读一遍
 */
export function RuntimeView({
  path,
  comp = '',
  onComp,
  onOpen,
  onGone,
}: {
  path: string
  comp?: string
  onComp: (comp: string) => void
  onOpen: (path: string, via?: string, how?: OpenHow) => void
  /** 对象已经不在了（Actor 销毁了、PIE 停了）：清掉选中 */
  onGone: () => void
}) {
  const { project, target } = useUe()
  // 选中的是不是 Actor：能读出组件的就是。不是 Actor 时桥接报错，这里当成「没有组件栏」，不显示成错误
  const comps = useLoad(
    () =>
      op<{ items: Comp[] }>(project.id, 'components', { path }, target).then(
        (r) => ({ path, items: r.items as Comp[] | null, gone: false }),
        // 「找不到对象」是桥接按路径找不到这个对象，不是「不是 Actor」
        (e: Error) => ({ path, items: null, gone: e.message.startsWith('找不到对象') }),
      ),
    [path, target.instance, target.world],
  )
  const ready = comps.data?.path === path
  useEffect(() => {
    if (!ready || !comps.data) return
    if (comps.data.gone) onGone()
    else if (comp && comps.data.items && !comps.data.items.some((c) => c.path === comp)) onComp('')
    // 只在组件读回来时判断
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [comps.data])
  const items = ready ? comps.data?.items : null
  const pane = usePane('actors.comps', '28%', 180)
  const ref = useRef<HTMLElement>(null)

  if (!ready) return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
  if (!items)
    return (
      <Card className="ue:min-h-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col">
        <Inspect key={path} path={path} cdo bar onOpen={onOpen} />
      </Card>
    )
  return (
    <div className={SPLIT_ROW}>
      <Card
        ref={ref}
        className={PANE_FIXED}
        style={pane.style('calc(100% - 352px)')}
        title={t('组件')}
        aside={<span className="ue:max-w-32 ue:truncate">{path.split('.').pop()}</span>}
        bodyClass="ue:overflow-auto"
      >
        <CompTree actor={path} items={items} selected={comp} onSelect={onComp} />
      </Card>
      <SplitHandle pane={pane} paneRef={ref} reserve={() => 352} />
      <Card className={PANE_FILL} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
        <Props key={comp || path} path={comp || path} bar onOpen={onOpen} />
      </Card>
    </div>
  )
}
