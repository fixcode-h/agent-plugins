import { Copy, Crosshair, Plus } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { moveObject, objFolders } from '../../../../shared/gm/obj-folders.ts'
import type { GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import { LIB_DROP_KEY, libPath, objValue, type LibDrop } from '../../../../shared/obj-lib/link.ts'
import { blockOf, type GtRef, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '../../../menu.tsx'
import { HitBadge, ObjRule, iconOf } from '../../gm/custom/ObjRule.tsx'
import { GT_STEPS_MIME } from '../gt-flow/dnd.ts'
import { useRefHits } from '../gt-ref/live.ts'
import { RefDialog } from '../gt-ref/RefDialog.tsx'
import { FileTree, type TreeLeaf } from '../tree.tsx'
import type { DragSrc } from '../tree-dnd.ts'
import { useObjLib } from './use-obj-lib.ts'

/** 名字里的 / 会被树当成分层：显示时换成长得一样的除号斜杠（和 GM 对象列表一样） */
const seg = (n: string) => n.replaceAll('/', '∕')
const pathOf = (o: GmObject) => (o.folder ? `${o.folder}/${seg(o.name)}` : seg(o.name))
/** 找对象存的变量名：名字能当变量名就用它，否则叫 obj */
const varOf = (n: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) ? n : 'obj')

/**
 * 测试页二级栏「对象」页签（第三期 U5）：对象库（objects.json，和 GM 页对象调用同一份）按文件夹排成树，
 * 每行名字 + 此刻命中几个（gt.watch 推送）+ 匹配规则。拖进画布 = 调函数，按住 Alt 拖 = 找对象存进变量；
 * 拖进去时规则拷进脚本 objects、记下来源（shared/obj-lib/link.ts），之后库里改了打开脚本会提示同步。
 * 右键：改匹配规则、复制名字；树里拖对象换文件夹
 */
export function ObjectsTab({ project, live, q }: { project: string; live: boolean; q: string }) {
  const { ui } = h()
  const lib = useObjLib(project)
  const objects = useMemo(() => lib.data?.objects ?? [], [lib.data])
  const folders = objFolders({ objects, objFolders: lib.data?.objFolders ?? [] })
  const [active, setActive] = useState<string>()
  const [dialog, setDialog] = useState<{ edit?: GmObject; folder?: string }>()
  const k = q.trim().toLowerCase()
  const shown = k
    ? objects.filter((o) => `${o.name} ${o.ref?.class ?? ''} ${o.src ?? ''}`.toLowerCase().includes(k))
    : objects
  const items: TreeLeaf<GmObject>[] = shown.map((o) => ({ path: pathOf(o), data: o }))
  const { hits } = useRefHits(
    project,
    live,
    objects.filter((o) => o.ref).map((o) => ({ id: o.name, ref: o.ref as GtRef })),
  )
  const store = () => ({ objects, objFolders: lib.data?.objFolders ?? [] }) as unknown as GmStore
  const save = async (next: GmObject[]) => {
    try {
      await lib.save(next)
    } catch (e) {
      h().toast.error((e as Error).message)
    }
  }
  const onMove = (src: DragSrc<GmObject>, toDir: string) => {
    // 对象一定要在文件夹里（和 GM 对象列表同一条规矩）；文件夹整个挪到 GM 页去做
    if (!src.data) return void h().toast.error(t('文件夹在 GM 页「对象调用」里整理'))
    if (!toDir) return void h().toast.error(t('对象要放在文件夹里：拖到某个文件夹上'))
    void save(moveObject(store(), src.data.name, toDir).objects)
  }
  const drag = (o: GmObject, e: { altKey: boolean }): Record<string, string> => {
    const $lib: LibDrop = { name: o.name, path: libPath(o), value: objValue(o) }
    const find = e.altKey
    const step: GtStep = find
      ? { ...blockOf('obj.find')!.make(), obj: o.name, saveAs: varOf(o.name), [LIB_DROP_KEY]: $lib }
      : { ...blockOf('obj.call')!.make(), obj: o.name, [LIB_DROP_KEY]: $lib }
    return { [GT_STEPS_MIME]: JSON.stringify([step]) }
  }
  const menu = (e: MouseEvent, o: GmObject) => {
    e.stopPropagation()
    openMenu(e, [
      o.ref && { label: t('改匹配规则…'), icon: Crosshair, onClick: () => setDialog({ edit: o }) },
      { label: t('复制名字'), icon: Copy, onClick: () => copyText(o.name) },
    ])
  }
  const here = active ?? folders[0] ?? 'GameTest'
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-1">
      <div className="ue:flex ue:items-center ue:gap-1 ue:px-1">
        <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">
          {t('对象库 {n} · 拖进画布调函数，按住 Alt 拖是找对象', { n: objects.length })}
        </span>
        <ui.IconButton
          icon={Plus}
          size="sm"
          className="ue:ml-auto"
          label={t('加对象到「{f}」…', { f: here })}
          onClick={() => setDialog({ folder: here })}
        />
      </div>
      {lib.error && <p className="ue:px-2 ue:text-footnote ue:text-danger">{lib.error}</p>}
      <FileTree<GmObject>
        items={items}
        folders={k ? undefined : folders}
        activeFolder={active}
        searching={!!k}
        label={t('对象库')}
        onOpen={(_p, o) => setDialog(o.ref ? { edit: o } : undefined)}
        onFolderClick={setActive}
        leafIcon={(o) => ({ icon: iconOf(o), tone: 'ue:text-accent' })}
        leafRight={(o) => (o.ref && live ? <HitBadge n={hits[o.name]?.count} error={hits[o.name]?.error} /> : null)}
        leafSub={(o) => <ObjRule o={o} small noIcon />}
        onLeafMenu={(e, _p, o) => menu(e, o)}
        onMove={onMove}
        dragData={drag}
        empty={
          <p className="ue:px-2 ue:py-2 ue:text-footnote ue:text-subtle">
            {k
              ? t('没有名字或类里含「{q}」的对象', { q })
              : t('对象库还是空的：点上面的 ＋ 抓一个，或在 GM 页「对象调用」里加。存的是匹配规则，用时按规则现找')}
          </p>
        }
      />
      {dialog && (
        <RefDialog
          project={project}
          live={live}
          withName
          name={dialog.edit?.name}
          value={dialog.edit?.ref as GtRef | undefined}
          onClose={() => setDialog(undefined)}
          onSave={(name, ref) => {
            const old = dialog.edit
            if (!old && objects.some((o) => o.name === name))
              return void h().toast.error(t('对象库里已经有「{n}」了', { n: name }))
            const next = old
              ? objects.map((o) => (o.name === old.name ? { ...o, name, ref } : o))
              : [...objects, { name, ref, folder: dialog.folder } as GmObject]
            setDialog(undefined)
            void save(next)
          }}
        />
      )}
    </div>
  )
}
