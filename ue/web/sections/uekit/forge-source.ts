import { useEffect, useState } from 'react'
import { op, ppost } from '../../api.ts'
import type { ForgeEntry } from './Forge.tsx'

/**
 * AssetForge 页的数据：配置清单（forge.entries）、配置根（forge.health）、配置根下第一层目录对应的类型（forge.kinds）。
 * 刷新分快慢两种：快的只读同步清单，深度检查要真的演练一遍导入（慢），所以分开给入口，不让刷新按钮偷偷跑慢的。
 */
const PAGE = 1000
/** 一次最多拉这么多：再多就按目录筛（forge.entries 每页最多 1000） */
const MAX = 20000

export interface ForgeData {
  entries: ForgeEntry[]
  total: number
  background: boolean
}

export interface ForgeHealth {
  configRoot: string
  configRootExists: boolean
  /** 配置根不存在、自动建也失败了（指到项目和 ProjectDoc 以外、没权限）：空状态显示原因 */
  createError?: string
}

/**
 * 拿配置根；不存在就直接建出来（用户 2026-11-16：插件启动就默认建对应的文件夹，不再显示「配置根还不存在」）。
 * 建在面板服务端（ext/forge/root），不经 UE：UEKit 不用为这个发版，编辑器没开也能建。
 */
async function loadHealth(project: string): Promise<ForgeHealth> {
  const r = await op<{ configRoot?: string; configRootExists?: boolean }>(project, 'forge.health')
  const h: ForgeHealth = { configRoot: r.configRoot ?? '', configRootExists: r.configRootExists !== false }
  if (h.configRootExists || !h.configRoot) return h
  try {
    await ppost(project, 'ext/forge/root', { root: h.configRoot })
    return { ...h, configRootExists: true }
  } catch (e) {
    return { ...h, createError: (e as Error).message }
  }
}

async function loadAll(project: string, deep: boolean): Promise<ForgeData> {
  const all: ForgeEntry[] = []
  let total = 0
  let background = false
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const r = await op<{ entries: ForgeEntry[]; total: number; instance?: { kind: string } }>(
      project,
      'forge.entries',
      { unmanaged: false, deep, offset, limit: PAGE },
      undefined,
      deep ? 300000 : 120000,
    )
    all.push(...r.entries)
    total = r.total
    background = r.instance?.kind === 'background'
    if (all.length >= r.total || !r.entries.length) break
  }
  return { entries: all, total, background }
}

/** 类型目录名统一成不带前后斜杠的样子，和树的第一层路径对得上 */
const normDir = (d: string) => d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

export function useForgeSource(project: string, installed: boolean | undefined) {
  const [data, setData] = useState<ForgeData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'' | 'quick' | 'deep'>('')
  const [health, setHealth] = useState<ForgeHealth>()
  const [dirKinds, setDirKinds] = useState<Map<string, string>>(() => new Map())

  const reload = (deep = false) => {
    setLoading(deep ? 'deep' : 'quick')
    loadAll(project, deep)
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(''))
    // 配置根可能刚被建出来（导出了第一份配置），一起重拉
    void loadHealth(project)
      .then(setHealth)
      .catch(() => undefined)
  }

  useEffect(() => {
    if (!installed) return
    reload()
    void op<{ kinds?: { kind: string; dir?: string }[] }>(project, 'forge.kinds')
      .then((r) => setDirKinds(new Map((r.kinds ?? []).filter((k) => k.dir).map((k) => [normDir(k.dir!), k.kind]))))
      .catch(() => undefined)
    // 换项目、装好扩展时重拉；reload 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project, installed])

  return { data, error, loading, health, dirKinds, reload }
}
