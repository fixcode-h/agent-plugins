import { useState } from 'react'
import { op, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Confirm } from '../ui.tsx'

interface Dirty {
  package: string
  file: string
  readOnly: boolean
}

/**
 * 资源改了没保存的列表和保存 / 放弃（从资源页抽出来）：资源的改动只暂存在编辑器里，「保存」才写回文件（P4 先签出）。
 * 保存按钮只放在资源页的页头（用户 2026-11-15 定：对象页里改资源属性不再放一套保存，免得两处都能存、不知道存了什么），
 * 对象页里改了的数量显示在左栏「资源 · N 未存」上
 */
export function useAssetSave() {
  const { project, state, reloadBadges } = useUe()
  const { ui, toast } = h()
  const { busy, run } = useAction()
  const [confirm, setConfirm] = useState(false)
  const hasEditor = (state?.instances ?? []).some((i) => i.kind === 'editor' || i.kind === 'background')
  const dirty = useLoad(
    () => (hasEditor ? op<{ items: Dirty[] }>(project.id, 'asset.dirty').then((r) => r.items) : Promise.resolve([])),
    [project.id, (state?.instances ?? []).length],
  )
  const list = dirty.data ?? []
  const after = () => {
    void dirty.reload()
    reloadBadges()
  }
  const save = () =>
    run('save', async () => {
      setConfirm(false)
      await op(project.id, 'asset.save', { packages: list.map((d) => d.package) }, undefined, 120000)
      toast.success(t('已保存'))
      after()
    })
  const revert = () =>
    run('revert', async () => {
      await op(project.id, 'asset.revert', { packages: list.map((d) => d.package) }, undefined, 120000)
      toast.success(t('已放弃改动'))
      after()
    })
  const p4 = project.vcs === 'p4'

  /** 页头上的「N 个资源改了没保存 · 放弃改动 · 保存」，没改动时不画 */
  const head = list.length ? (
    <>
      <Badge tone="warn">{t('{n} 个资源改了没保存', { n: list.length })}</Badge>
      <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void revert()}>
        {t('放弃改动')}
      </ui.Button>
      <ui.Button size="sm" disabled={!!busy} onClick={() => setConfirm(true)}>
        {p4 ? t('签出并保存') : t('保存')}
      </ui.Button>
    </>
  ) : null

  const dialog = (
    <Confirm
      open={confirm}
      title={p4 ? t('签出并保存这些资源？') : t('保存这些资源？')}
      okText={p4 ? t('签出并保存') : t('保存')}
      onOk={() => void save()}
      onCancel={() => setConfirm(false)}
    >
      <ul className="ue:flex ue:flex-col ue:gap-1 ue:font-mono ue:text-footnote">
        {list.map((d) => (
          <li key={d.package} className="ue:break-all">
            {d.file}
            {d.readOnly ? ` · ${t('只读，会先签出')}` : ''}
          </li>
        ))}
      </ul>
      {p4 && <p className="ue:mt-2 ue:text-footnote ue:text-subtle">{t('P4 签出进默认变更列表，不会提交')}</p>}
    </Confirm>
  )

  return { dirty: list, reload: after, head, dialog }
}
