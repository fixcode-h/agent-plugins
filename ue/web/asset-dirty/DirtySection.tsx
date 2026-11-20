import { ExternalLink, FilePenLine, History, LocateFixed, Save, Undo2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { openAssetDiff } from '../asset-diff/store.ts'
import { h, t } from '../host.ts'
import { openMenu } from '../menu.tsx'
import { useOpenInEditor } from '../sections/assets/asset-menu.ts'
import { useDirtyActions } from './actions.tsx'
import { DirtyList } from './DirtyList.tsx'
import { setDirtyOpen, setPicked, showChanges, useDirtyList, type Dirty } from './store.ts'

const objectPath = (pkg: string) => `${pkg}.${pkg.split('/').pop() ?? ''}`

/**
 * 资源页左栏的「当前修改」整块：取列表（store.ts）、保存 / 放弃（actions.tsx）、右键菜单，交给 DirtyList 画。
 * 点一行 = 打开那个资源并切到它的「改动」页
 */
export function DirtySection({
  selected,
  onOpen,
  onReveal,
}: {
  /** 右边正在看的资源（对象路径或包路径） */
  selected?: string
  onOpen: (path: string) => void
  onReveal?: (path: string) => void
}) {
  const s = useDirtyList()
  const act = useDirtyActions()
  const { editorOn, open } = useOpenInEditor()
  const [multi, setMulti] = useState(false)
  const openItem = (d: Dirty) => {
    showChanges(d.package)
    onOpen(objectPath(d.package))
  }
  const menu = (e: MouseEvent, d: Dirty) => {
    // 勾选模式下右键勾上的行：对勾上的那几个生效；否则只对这一行
    const group = multi && s.picked.includes(d.package) ? s.items.filter((x) => s.picked.includes(x.package)) : [d]
    const n = group.length
    openMenu(e, [
      { title: n > 1 ? t('选中的 {n} 个资源', { n }) : d.package },
      {
        label: n > 1 ? (act.p4 ? t('签出并保存选中的 {n} 个', { n }) : t('保存选中的 {n} 个', { n })) : act.saveLabel,
        icon: Save,
        onClick: () => act.save(group),
      },
      {
        label: n > 1 ? t('放弃选中的 {n} 个的改动', { n }) : t('放弃改动'),
        icon: Undo2,
        danger: true,
        onClick: () => act.revert(group),
      },
      'sep',
      { label: t('看改动'), icon: FilePenLine, onClick: () => openItem(d) },
      { label: t('历史版本…'), icon: History, onClick: () => openAssetDiff(d.package) },
      {
        label: t('在 UE 编辑器打开'),
        icon: ExternalLink,
        disabled: !editorOn,
        hint: editorOn ? undefined : t('编辑器没开'),
        onClick: () => void open(objectPath(d.package)),
      },
      onReveal && {
        label: t('在文件夹里定位'),
        icon: LocateFixed,
        onClick: () => onReveal(objectPath(d.package)),
      },
    ])
  }
  return (
    <>
      <DirtyList
        items={s.items}
        sums={s.sums}
        open={s.open}
        onOpenChange={setDirtyOpen}
        selected={selected?.split('.')[0]}
        multi={multi}
        onMulti={(on) => {
          setMulti(on)
          if (!on) setPicked([])
        }}
        picked={s.picked}
        onPicked={setPicked}
        onOpenItem={openItem}
        onSave={act.save}
        onRevert={act.revert}
        saveLabel={act.saveLabel}
        saveAllLabel={act.saveAllLabel}
        onMenu={menu}
      />
      {act.dialog}
    </>
  )
}

/** 页头的「N 个没保存」：点了展开左栏的「当前修改」（保存 / 放弃挪进左栏了，页头不再放一键全存） */
export function DirtyHeadButton() {
  const { ui } = h()
  const s = useDirtyList()
  if (!s.items.length) return null
  return (
    <ui.Button
      size="sm"
      variant="secondary"
      onClick={() => setDirtyOpen(true)}
      title={t('编辑器里改了没保存的资源：在左栏「当前修改」里看改动、保存或放弃')}
    >
      <span className="ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full ue:bg-warning" />
      <span className="ue:text-warning">{t('{n} 个没保存', { n: s.items.length })}</span>
    </ui.Button>
  )
}
