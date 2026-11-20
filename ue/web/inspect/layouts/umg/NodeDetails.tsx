import { useMemo } from 'react'
import { valueAt } from '../../../../shared/forge-doc/edit.ts'
import { Details } from '../../../details/Details.tsx'
import { PropAnimCtx, PropMarksCtx } from '../../../details/marks.ts'
import { h, t } from '../../../host.ts'
import { Props } from '../../../Props.tsx'
import { Card, ErrorText } from '../../../ui.tsx'
import type { LayoutProps } from '../types.ts'
import type { UmgConfig } from './config.ts'
import { useConfigEdit } from './edit/ctx.ts'
import { nodeProps } from './edit/node-props.ts'
import { useNodeEdit } from './edit/use-node-edit.ts'
import type { WNode } from './model.ts'

/**
 * 右栏：选中控件的细节。
 * - 有 UE 的对象路径（umg.design 回的）：真实细节面板（Props，能改，和资源页一样）；
 * - 只有配置（近似预览、资源还没导入，或编辑器没开）：照 UE 细节面板按配置画，没写的属性显示 UE 默认值（标灰），
 *   在 AssetForge 页里能直接改，改了写回配置文件（edit/，用户 2026-11-20「修改直接改对应的 json 文件」）；资源页里只读；
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
  doc,
}: Pick<LayoutProps, 'path' | 'onOpen' | 'hint' | 'marks'> & {
  node?: WNode
  parent?: WNode
  live: boolean
  animated: Map<string, string[]>
  animName?: string
  /** 解析好的配置：按节点路径取没套样式的原节点和 styles */
  doc?: UmgConfig
}) {
  const { ui } = h()
  const edit = useConfigEdit()
  const animCtx = useMemo(
    () =>
      new Map(
        [...animated].map(
          ([p, chs]) => [p, t('被动画 {a} 驱动：{c}', { a: animName ?? '', c: chs.join('、') })] as const,
        ),
      ),
    [animated, animName],
  )
  const byConfig = !!node && !(live && node.path)
  // 配置里的原节点（没套样式）：UE 回的树里配置没有的控件找不到，就只按树上挂的属性画
  const raw = useMemo(
    () => (byConfig && node?.at ? valueAt(doc, node.at) : undefined) ?? { props: node?.props, slot: node?.slot },
    [byConfig, node, doc],
  )
  const canEdit = !!edit && !!node?.at && byConfig
  // 子界面里的控件来自另一份配置（subref/），这里不改它，免得改到父配置里去
  const why = node?.src
    ? t('来自子界面配置 {f}，只读：双击控件树里的子界面打开它自己的配置改', { f: node.src })
    : t('按配置预览，只读：要改就在 AssetForge 页改，或导入后在真实资源上改')
  const np = useMemo(
    () =>
      nodeProps({
        node: raw,
        styles: doc?.styles,
        cls: node?.cls,
        parentClass: parent?.cls,
        fromStyle: (s) => t('来自样式 {s}', { s }),
        readOnlyWhy: canEdit ? undefined : why,
      }),
    [raw, doc?.styles, node?.cls, parent?.cls, canEdit, why],
  )
  const { api, error, clearError } = useNodeEdit({
    edit: canEdit ? edit : null,
    at: node?.at,
    node: raw,
    styles: doc?.styles,
    np,
    onOpen,
  })

  if (!node || !byConfig)
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
      {node.user && (
        <p className="ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">
          {t('子界面：它自己的属性在它自己的配置里（{a}），这里只有插槽和通用属性', {
            a: node.subFile ?? node.asset ?? '',
          })}
          {node.refError && <span className="ue:mt-0.5 ue:block ue:text-warning">{node.refError}</span>}
        </p>
      )}
      {node.src && <p className="ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">{why}</p>}
      {error && (
        <div className="ue:flex ue:flex-col ue:gap-1.5 ue:border-b ue:border-line ue:px-3 ue:py-2">
          <ErrorText>{error}</ErrorText>
          <div className="ue:flex ue:gap-1.5">
            {edit?.openConfig && (
              <ui.Button size="sm" variant="ghost" onClick={edit.openConfig}>
                {t('打开配置原文')}
              </ui.Button>
            )}
            <ui.Button size="sm" variant="ghost" onClick={clearError}>
              {t('知道了')}
            </ui.Button>
          </div>
        </div>
      )}
      <PropAnimCtx.Provider value={animCtx}>
        <Details key={node.key} props={np.props} api={api} />
      </PropAnimCtx.Provider>
    </Card>
  )
}
