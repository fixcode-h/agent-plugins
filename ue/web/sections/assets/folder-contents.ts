import { useEffect, useRef, useState } from 'react'
import type { Target } from '../../../server/types.ts'
import { op } from '../../api.ts'
import { LIMIT, type Folder, type Item } from './folder-data.ts'

/** 文件夹内容表的一行资源（服务端 ue/server/asset-folders-stat.ts 的 StatItem） */
export interface StatItem extends Item {
  size?: number
  mtime?: string
  dirty?: boolean
  vcs?: { action?: string; others?: string[] }
  refs?: number
}
export interface FolderStat {
  editor: boolean
  vcsError?: string
  refsSkipped?: number
}
export interface Contents {
  path: string
  folders: Folder[]
  items: StatItem[]
  more?: boolean
  total?: number
  note?: string
  loading?: boolean
  source?: 'bridge' | 'disk'
  stat?: FolderStat
}

/**
 * 资源页右栏「文件夹内容」的数据：先要列表 + 大小 / 修改时间 / 未保存 / 签出（assets.children stat:true，快），
 * 列出来以后再单独要引用个数（refs:true，一个资源问一次编辑器，几百个要几秒），回来了并进同一张表。
 * 只在选中这个文件夹时算这一层，不往下递归（设计稿「UE 插件优化与扩展」二 P1：未被引用只算这一层）
 */
export function useFolderContents(projectId: string, target: Target, path: string, tick: number) {
  const [data, setData] = useState<Contents>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refsBusy, setRefsBusy] = useState(false)
  // 切走了文件夹，旧文件夹晚回来的结果丢掉
  const gen = useRef(0)

  useEffect(() => {
    if (!path) return
    const my = ++gen.current
    setBusy(true)
    setError('')
    setData(undefined)
    setRefsBusy(false)
    op<Contents>(projectId, 'assets.children', { path, limit: LIMIT, stat: true }, target, 60000)
      .then((r) => {
        if (my !== gen.current) return
        setData(r)
        setBusy(false)
        if (!r.stat?.editor || !r.items.length) return
        setRefsBusy(true)
        return op<Contents>(projectId, 'assets.children', { path, limit: LIMIT, refs: true }, target, 180000).then(
          (x) => {
            if (my !== gen.current) return
            const refs = new Map(x.items.filter((i) => i.refs !== undefined).map((i) => [i.path, i.refs]))
            setData(
              (d) =>
                d && {
                  ...d,
                  items: d.items.map((i) => (refs.has(i.path) ? { ...i, refs: refs.get(i.path) } : i)),
                  stat: { ...(d.stat ?? { editor: true }), refsSkipped: x.stat?.refsSkipped },
                },
            )
          },
          // 引用查不到不算错：状态列只是少了「未被引用」
          () => undefined,
        )
      })
      .catch((e: Error) => my === gen.current && setError(e.message))
      .finally(() => {
        if (my !== gen.current) return
        setBusy(false)
        setRefsBusy(false)
      })
    // target 是每次渲染新建的对象，按实例 id 判断变没变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, target.instance, path, tick])

  return { data, error, busy, refsBusy }
}
