import { Copy, ExternalLink, GitCompareArrows, LocateFixed } from 'lucide-react'
import type { MouseEvent } from 'react'
import { op } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '../../menu.tsx'
import { openAssetDiff } from '../../asset-diff/store.ts'
import { pkgOf } from './folder-data.ts'

/**
 * 在 UE 编辑器里打开资源（对应的资源编辑器：蓝图编辑器、材质编辑器……）。走 UELink 的 asset.open，
 * 只有开着窗口的编辑器能开，后台编辑器（commandlet）不行，所以目标固定是 editor 实例
 */
export function useOpenInEditor() {
  const { project, state } = useUe()
  const editorOn = (state?.instances ?? []).some((i) => i.kind === 'editor')
  const open = (path: string) =>
    op(project.id, 'asset.open', { path }, { instance: 'editor' }).then(
      () => h().toast.success(t('已在 UE 编辑器里打开')),
      (e: Error) => h().toast.error(e.message),
    )
  return { editorOn, open }
}

/**
 * 资源行的右键菜单（文件夹树、搜索结果共用）：在 UE 编辑器打开、在文件夹里定位（搜索页签才有）、复制路径。
 * 编辑器没开时「在 UE 编辑器打开」灰掉并写明原因，不替用户起编辑器
 */
export function useAssetMenu() {
  const { editorOn, open } = useOpenInEditor()
  return (e: MouseEvent, path: string, more?: { onReveal?: () => void }) =>
    openMenu(e, [
      { title: path },
      {
        label: t('在 UE 编辑器打开'),
        icon: ExternalLink,
        disabled: !editorOn,
        hint: editorOn ? undefined : t('编辑器没开'),
        onClick: () => void open(path),
      },
      more?.onReveal && { label: t('在文件夹里定位'), icon: LocateFixed, onClick: more.onReveal },
      { label: t('版本差异…'), icon: GitCompareArrows, onClick: () => openAssetDiff(path) },
      'sep',
      { label: t('复制路径'), icon: Copy, onClick: () => copyText(pkgOf(path)) },
      pkgOf(path) !== path && { label: t('复制对象路径'), icon: Copy, onClick: () => copyText(path) },
    ])
}
