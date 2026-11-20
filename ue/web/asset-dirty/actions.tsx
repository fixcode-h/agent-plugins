import { useState } from 'react'
import { op, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Confirm } from '../ui.tsx'
import { reloadDirty, showChanges, type Dirty } from './store.ts'

/**
 * 保存 / 放弃一批没保存的资源（左栏「当前修改」整组、勾选的几个、一行，资源的「改动」页都走这里）：
 * 保存照旧先弹确认、列出要签出的文件（P4 先签出进默认变更列表，不提交）；放弃收不回，也先确认。
 * 每个用的地方自己挂 dialog
 */
export function useDirtyActions() {
  const { project, reloadBadges } = useUe()
  const { toast } = h()
  const { busy, run } = useAction()
  const [ask, setAsk] = useState<{ kind: 'save' | 'revert'; items: Dirty[] } | null>(null)
  const p4 = project.vcs === 'p4'
  const after = () => {
    reloadDirty()
    reloadBadges()
  }
  const doIt = () => {
    if (!ask) return
    const { kind, items } = ask
    setAsk(null)
    const packages = items.map((d) => d.package)
    return run(kind, async () => {
      await op(project.id, kind === 'save' ? 'asset.save' : 'asset.revert', { packages }, undefined, 120000)
      toast.success(kind === 'save' ? t('已保存') : t('已放弃改动'))
      // 保存或放弃之后这些资源没有改动了：开着的「改动」页回到原来的视图
      showChanges('')
      after()
    })
  }
  const saveLabel = p4 ? t('签出并保存') : t('保存')
  const dialog = (
    <Confirm
      open={!!ask}
      title={
        ask?.kind === 'revert'
          ? t('放弃这 {n} 个资源的改动？', { n: ask.items.length })
          : p4
            ? t('签出并保存这 {n} 个资源？', { n: ask?.items.length ?? 0 })
            : t('保存这 {n} 个资源？', { n: ask?.items.length ?? 0 })
      }
      okText={ask?.kind === 'revert' ? t('放弃改动') : saveLabel}
      danger={ask?.kind === 'revert'}
      onOk={() => void doIt()}
      onCancel={() => setAsk(null)}
    >
      <ul className="ue:flex ue:max-h-64 ue:flex-col ue:gap-1 ue:overflow-y-auto ue:font-mono ue:text-footnote">
        {(ask?.items ?? []).map((d) => (
          <li key={d.package} className="ue:break-all">
            {d.file}
            {ask?.kind === 'save' && d.readOnly ? ` · ${t('只读，会先签出')}` : ''}
          </li>
        ))}
      </ul>
      <p className="ue:mt-2 ue:text-footnote ue:text-subtle">
        {ask?.kind === 'revert'
          ? t('编辑器里重新读磁盘上的文件，这些改动收不回')
          : p4
            ? t('P4 签出进默认变更列表，不会提交')
            : t('写回磁盘上的文件')}
      </p>
    </Confirm>
  )
  return {
    busy: !!busy,
    p4,
    saveLabel,
    saveAllLabel: p4 ? t('全部签出并保存') : t('全部保存'),
    save: (items: Dirty[]) => items.length && setAsk({ kind: 'save', items }),
    revert: (items: Dirty[]) => items.length && setAsk({ kind: 'revert', items }),
    reload: after,
    dialog,
  }
}
