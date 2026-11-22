import { useRef, useState } from 'react'
import {
  addObjFolder,
  deleteObjFolder,
  moveObjFolder,
  moveObject,
  normFolder,
  objFolders,
} from '../../../../shared/gm/obj-folders.ts'
import type { GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'
import type { DragSrc } from '../../uekit/tree-dnd.ts'
import type { GmData } from '../use-gm.ts'
import { ObjNameDialog, type ObjNameAsk } from './ObjNameDialog.tsx'

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const join = (dir: string, n: string) => (dir ? `${dir}/${n}` : n)

/**
 * 对象列表的文件夹和「名字 + 文件夹」弹窗（用户 2026-11-22）：新建 / 改名 / 删除文件夹、拖动移动、移到文件夹，
 * 以及加对象、复制、改名时问名字和文件夹的 askObj。数据变换在 shared/gm/obj-folders.ts
 */
export function useObjFolders(d: GmData) {
  const { toast } = h()
  const [dialog, ask] = useAsk()
  const g = d.gm
  const folders = objFolders(g)
  const [req, setReq] = useState<ObjNameAsk & { self?: string }>()
  const done = useRef<((v: { name: string; folder: string } | undefined) => void) | undefined>(undefined)

  /** 问名字和文件夹；取消是 undefined。self 是改名时自己原来的名字（查重时跳过） */
  const askObj = (r: ObjNameAsk & { self?: string }) =>
    new Promise<{ name: string; folder: string } | undefined>((resolve) => {
      done.current?.(undefined)
      done.current = resolve
      setReq(r)
    })
  const finish = (v: { name: string; folder: string } | undefined) => {
    done.current?.(v)
    done.current = undefined
    setReq(undefined)
  }

  /** 新名字和已有文件夹撞了就提示，返回 false */
  const free = (p: string) => {
    if (!folders.includes(p)) return true
    toast.error(t('已经有文件夹「{n}」了', { n: p }))
    return false
  }
  const save = (next: GmStore) => d.saveGm(next)

  const actions = {
    folders,
    onNewFolder: async (parent: string) => {
      const n = normFolder(
        (await ask({ title: t('新建文件夹'), label: t('文件夹的名字（a/b 建多层）'), init: '' })) ?? '',
      )
      if (!n || !free(join(parent, n))) return
      await save(addObjFolder(g, join(parent, n)))
    },
    onRenameFolder: async (path: string) => {
      const n = normFolder((await ask({ title: t('重命名文件夹'), label: t('新名字'), init: baseName(path) })) ?? '')
      const to = join(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', n)
      if (!n || to === path || !free(to)) return
      await save(moveObjFolder(g, path, to))
    },
    onDeleteFolder: async (path: string, inside: GmObject[]) => {
      const ok = await ask({
        title: t('删除文件夹「{n}」？', { n: path }),
        message: inside.length
          ? t('里面的 {n} 个对象会一起删掉：{list}', { n: inside.length, list: inside.map((o) => o.name).join('、') })
          : undefined,
        okText: t('删除'),
        danger: true,
      })
      if (ok === undefined) return
      await save(deleteObjFolder(g, path).g)
    },
    onMove: async (src: DragSrc<GmObject>, toDir: string) => {
      if (src.data) {
        // 对象一定要在文件夹里（用户 2026-11-22）：拖到最外层不算
        if (!toDir) return void toast.error(t('对象要放在文件夹里：拖到某个文件夹上'))
        return void (await save(moveObject(g, src.data.name, toDir)))
      }
      const to = join(toDir, baseName(src.path))
      if (free(to)) await save(moveObjFolder(g, src.path, to))
    },
    onMoveTo: async (o: GmObject) => {
      const r = await askObj({
        title: t('把「{n}」移到文件夹', { n: o.name }),
        name: o.name,
        folder: o.folder,
        noName: true,
      })
      if (r && r.folder !== o.folder) await save(moveObject(g, o.name, r.folder))
    },
  }

  const dialogs = (
    <>
      {dialog}
      {req && (
        <ObjNameDialog
          req={req}
          folders={folders}
          taken={(n) =>
            n !== req.self && g.objects.some((o) => o.name === n) ? t('对象列表里已经有「{n}」了', { n }) : undefined
          }
          onClose={() => finish(undefined)}
          onOk={(name, folder) => finish({ name, folder })}
        />
      )}
    </>
  )
  return { askObj, actions, dialogs }
}
