import { BookmarkPlus, Copy, Crosshair, Plus } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { moveObject, objFolders } from '../../../../shared/gm/obj-folders.ts'
import type { GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import { LIB_DROP_KEY, libPath, objValue, type LibDrop } from '../../../../shared/obj-lib/link.ts'
import { blockOf, type GtRef, type GtStep } from '../../../../shared/gt-script/index.ts'
import type { GtScript } from '../../../../shared/gt-script/types.ts'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { HitBadge, ObjRowLabel, iconOf, objRuleTitle } from '../../gm/custom/ObjRule.tsx'
import { GT_STEPS_MIME } from '../gt-flow/dnd.ts'
import { useRefHits } from '../gt-ref/live.ts'
import { RefDialog } from '../gt-ref/RefDialog.tsx'
import { FileTree, type TreeLeaf } from '../tree.tsx'
import type { DragSrc } from '../tree-dnd.ts'
import { saveObjToLib } from '../../../obj-kit/obj-lib-actions.ts'
import { useOpenScript } from './open-script.ts'
import { useObjLib } from './use-obj-lib.ts'

/** 树里「只在这个脚本里」那一组的文件夹名（不是对象库的文件夹，拖进别的文件夹 = 存进对象库） */
const LOCAL_DIR = '\u200b' + '只在这个脚本里'

/** 名字里的 / 会被树当成分层：显示时换成长得一样的除号斜杠（和 GM 对象列表一样） */
const seg = (n: string) => n.replaceAll('/', '∕')
const pathOf = (o: GmObject) => (o.folder ? `${o.folder}/${seg(o.name)}` : seg(o.name))
/** 找对象存的变量名：名字能当变量名就用它，否则叫 obj */
const varOf = (n: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) ? n : 'obj')

/**
 * 测试页二级栏「对象」页签（第三期 U5）：对象库（objects.json，和 GM 页对象调用同一份）按文件夹排成树，
 * 每行名字 + 此刻命中几个（gt.watch 推送）+ 匹配规则。拖进画布 = 调函数，按住 Alt 拖 = 找对象存进变量；
 * 拖进去时规则拷进脚本 objects、记下来源（shared/obj-lib/link.ts），之后库里改了打开脚本会提示同步。
 * 右键：改匹配规则、复制名字；树里拖对象换文件夹。
 * 正在编辑的脚本里有、但不是从对象库来的对象（objects 里没记 objLib 来源的），排在最后一组「只在这个脚本里」：
 * 拖进画布照常用（已经在脚本里，不再拷）；右键或拖到库的文件夹上 = 存进对象库，并在脚本里记上来源
 */
export function ObjectsTab({ project, live, q }: { project: string; live: boolean; q: string }) {
  const { ui } = h()
  const lib = useObjLib(project)
  const objects = useMemo(() => lib.data?.objects ?? [], [lib.data])
  const folders = objFolders({ objects, objFolders: lib.data?.objFolders ?? [] })
  const [active, setActive] = useState<string>()
  const [dialog, setDialog] = useState<{ edit?: GmObject; folder?: string }>()
  const open = useOpenScript()
  const local = useMemo(() => localObjects(open?.doc), [open?.doc])
  const k = q.trim().toLowerCase()
  const match = (o: GmObject) => !k || `${o.name} ${o.ref?.class ?? ''} ${o.src ?? ''}`.toLowerCase().includes(k)
  const items: TreeLeaf<GmObject>[] = [
    ...objects.filter(match).map((o) => ({ path: pathOf(o), data: o })),
    ...local.filter(match).map((o) => ({ path: `${LOCAL_DIR}/${seg(o.name)}`, data: o })),
  ]
  const isLocal = (o: GmObject) => o.folder === LOCAL_DIR
  /** 脚本里的对象存进对象库（folder 给了就放那个文件夹），再在脚本 objLib 里记上来源，之后库里改了会提示同步 */
  const toLib = async (o: GmObject, folder?: string) => {
    const name = await saveObjToLib(project, { name: o.name, ref: o.ref, src: o.src, folder } as GmObject)
    const cur = open
    if (!name || !cur || cur.readOnly) return
    const links = (cur.doc.objLib ?? {}) as Record<string, string>
    cur.apply({ ...cur.doc, objLib: { ...links, [o.name]: libPath({ name, folder: folder ?? 'GameTest' }) } })
    void lib.reload()
  }
  const { hits } = useRefHits(
    project,
    live,
    [...objects, ...local]
      .filter((o) => o.ref)
      .map((o) => ({ id: (isLocal(o) ? '#' : '') + o.name, ref: o.ref as GtRef })),
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
    if (toDir === LOCAL_DIR) return void h().toast.error(t('「只在这个脚本里」只列脚本自己的对象，不能拖进去'))
    if (!toDir) return void h().toast.error(t('对象要放在文件夹里：拖到某个文件夹上'))
    if (isLocal(src.data)) return void toLib(src.data, toDir)
    void save(moveObject(store(), src.data.name, toDir).objects)
  }
  const drag = (o: GmObject, e: { altKey: boolean }): Record<string, string> => {
    // 脚本自己的对象已经在 objects 里，不带 $lib（带了会被当成库对象再拷一份）
    const from = isLocal(o) ? {} : { [LIB_DROP_KEY]: { name: o.name, path: libPath(o), value: objValue(o) } as LibDrop }
    const find = e.altKey
    const step: GtStep = find
      ? { ...blockOf('obj.find')!.make(), obj: o.name, saveAs: varOf(o.name), ...from }
      : { ...blockOf('obj.call')!.make(), obj: o.name, ...from }
    return { [GT_STEPS_MIME]: JSON.stringify([step]) }
  }
  const menu = (e: MouseEvent, o: GmObject) => {
    e.stopPropagation()
    openMenu(e, [
      isLocal(o)
        ? { label: t('存进对象库'), icon: BookmarkPlus, onClick: () => void toLib(o) }
        : o.ref && { label: t('改匹配规则…'), icon: Crosshair, onClick: () => setDialog({ edit: o }) },
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
        folders={k ? undefined : local.length ? [...folders, LOCAL_DIR] : folders}
        activeFolder={active}
        searching={!!k}
        label={t('对象库')}
        onOpen={(_p, o) => setDialog(o.ref && !isLocal(o) ? { edit: o } : undefined)}
        onFolderClick={setActive}
        leafIcon={(o) => ({ icon: iconOf(o), tone: 'ue:text-accent' })}
        leafRight={(o) => {
          const hit = hits[(isLocal(o) ? '#' : '') + o.name]
          return o.ref && live ? <HitBadge n={hit?.count} error={hit?.error} /> : null
        }}
        leafLabel={(o) => <ObjRowLabel o={o} name={o.name} />}
        leafTitle={(o) => objRuleTitle(o, o.name)}
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

/** 脚本 objects 里没记对象库来源的那些（匹配规则写成对象，来源对象写成字符串） */
function localObjects(doc: GtScript | undefined): GmObject[] {
  if (!doc?.objects) return []
  const links = (doc.objLib ?? {}) as Record<string, string>
  return Object.entries(doc.objects as Record<string, unknown>)
    .filter(([n]) => !(n in links))
    .map(([name, v]) =>
      typeof v === 'string'
        ? ({ name, src: v, folder: LOCAL_DIR } as GmObject)
        : ({ name, ref: v, folder: LOCAL_DIR } as GmObject),
    )
}
