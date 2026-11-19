import { useMemo } from 'react'
import { Details } from '../../../details/Details.tsx'
import { PropAnimCtx, PropMarksCtx } from '../../../details/marks.ts'
import { t } from '../../../host.ts'
import { Props } from '../../../Props.tsx'
import { previewProps } from '../../../sections/uekit/forge-preview-props.ts'
import { Card } from '../../../ui.tsx'
import type { LayoutProps } from '../types.ts'
import type { WNode } from './model.ts'
import { readOnlyApi } from './preview-api.ts'

/**
 * 右栏：选中控件的细节。
 * - 有 UE 的对象路径（umg.design 回的）：真实细节面板（Props，能改，和资源页一样）；
 * - 只有配置（近似预览、资源还没导入）：按配置的 props / slot 画只读细节，Slot 分类在最前（forge-preview-props.ts）；
 * - 什么都没选、又读不到控件树：资源本身的属性。
 * 被当前动画驱动的属性打菱形（animated：顶层属性名 → 通道）
 */
export function NodeDetails({
  node,
  parent,
  live,
  path,
  onOpen,
  hint,
  marks,
  animated,
  animName,
}: Pick<LayoutProps, 'path' | 'onOpen' | 'hint' | 'marks'> & {
  node?: WNode
  parent?: WNode
  live: boolean
  animated: Map<string, string[]>
  animName?: string
}) {
  const animCtx = useMemo(
    () =>
      new Map(
        [...animated].map(
          ([p, chs]) => [p, t('被动画 {a} 驱动：{c}', { a: animName ?? '', c: chs.join('、') })] as const,
        ),
      ),
    [animated, animName],
  )
  const why = t('按配置预览，只读：要改就改配置，导入后在真实资源上改')
  const props = useMemo(
    () =>
      node && !(live && node.path)
        ? previewProps({ class: node.cls, props: node.props, slot: node.slot }, parent?.cls, why)
        : [],
    [node, parent, live, why],
  )
  const api = useMemo(() => readOnlyApi((p) => onOpen(p)), [onOpen])

  if (!node || (live && node.path))
    return (
      <Card className="ue:min-h-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col">
        <PropAnimCtx.Provider value={animCtx}>
          <PropMarksCtx.Provider value={node ? null : (marks ?? null)}>
            <Props key={node?.path ?? path} path={node?.path ?? path} bar noFns onOpen={onOpen} readOnlyHint={hint} />
          </PropMarksCtx.Provider>
        </PropAnimCtx.Provider>
      </Card>
    )
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={<span className="ue:truncate ue:font-mono">{node.name}</span>}
      aside={
        <span className="ue:truncate">
          {node.cls}
          {parent ? ` · ${t('父：{p}', { p: `${parent.name} (${parent.cls})` })}` : ''}
        </span>
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      {props.length ? (
        <PropAnimCtx.Provider value={animCtx}>
          <Details key={node.key} props={props} api={api} />
        </PropAnimCtx.Provider>
      ) : (
        <p className="ue:p-4 ue:text-footnote ue:text-subtle">
          {node.user
            ? t('子界面：属性在它自己的配置里（{a}）', { a: node.asset ?? '' })
            : t('这个控件在配置里没写属性，导入后用默认值')}
        </p>
      )}
    </Card>
  )
}
