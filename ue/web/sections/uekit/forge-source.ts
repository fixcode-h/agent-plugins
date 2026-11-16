import { useEffect, useRef, useState } from 'react'
import { op, ppost } from '../../api.ts'
import type { ForgeEntry } from './Forge.tsx'

/**
 * AssetForge 页的数据：配置清单（forge.entries）、配置根（forge.health）、配置根下第一层目录对应的类型（forge.kinds）。
 * 刷新分快慢两种：快的只读同步清单，深度检查要真的演练一遍导入（慢），所以分开给入口，不让刷新按钮偷偷跑慢的。
 * 用户 2026-11-16：左栏一直转圈——原来配置根和清单都等 UE 回（编辑器没开时要先拉起后台编辑器）。现在分两步：
 * 配置根和 JSON 清单先从磁盘读（disk: true，服务端 uekit/forge-disk.ts，几百毫秒），同步状态再等 UE 的 forge.entries 补上。
 */
const PAGE = 1000
/** 一次最多拉这么多：再多就按目录筛（forge.entries 每页最多 1000） */
const MAX = 20000

export interface ForgeData {
  entries: ForgeEntry[]
  total: number
  background: boolean
  /** 列表是从磁盘读的，UE 的同步状态还没回来：state 为空的项显示「正在读状态」 */
  statesPending?: boolean
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
  // 配置根从磁盘算（和 UE 同一套规则），不等编辑器
  const r = await op<{ configRoot?: string; configRootExists?: boolean }>(project, 'forge.health', { disk: true })
  const h: ForgeHealth = { configRoot: r.configRoot ?? '', configRootExists: r.configRootExists !== false }
  if (h.configRootExists || !h.configRoot) return h
  try {
    await ppost(project, 'ext/forge/root', { root: h.configRoot })
    return { ...h, configRootExists: true }
  } catch (e) {
    return { ...h, createError: (e as Error).message }
  }
}

async function loadAll(project: string, deep: boolean, disk = false): Promise<ForgeData> {
  const all: ForgeEntry[] = []
  let total = 0
  let background = false
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const r = await op<{ entries: ForgeEntry[]; total: number; instance?: { kind: string } }>(
      project,
      'forge.entries',
      disk ? { disk: true, offset, limit: MAX } : { unmanaged: false, deep, offset, limit: PAGE },
      undefined,
      deep ? 300000 : 120000,
    )
    all.push(...r.entries)
    total = r.total
    background = r.instance?.kind === 'background'
    if (all.length >= r.total || !r.entries.length) break
  }
  return { entries: all, total, background, ...(disk ? { statesPending: true } : {}) }
}

/** 磁盘清单接上已知的同步状态：刷新时状态不先闪成「正在读」，UE 回来再整体换掉 */
function keepStates(disk: ForgeData, prev: ForgeData | undefined): ForgeData {
  if (!prev) return disk
  const known = new Map(prev.entries.map((e) => [e.key, e]))
  const entries = disk.entries.map((e) => {
    const p = known.get(e.key)
    return e.state || !p || p.state === 'unknown'
      ? e
      : { ...e, state: p.state, needsImport: p.needsImport, message: p.message }
  })
  return { ...disk, entries, background: prev.background }
}

/** UE 读不到同步状态（编辑器没开、连不上）：还没状态的项标成「状态未知」，不再显示「正在读状态」 */
function offline(d: ForgeData): ForgeData {
  return { ...d, statesPending: false, entries: d.entries.map((e) => (e.state ? e : { ...e, state: 'unknown' })) }
}

/** 类型目录名统一成不带前后斜杠的样子，和树的第一层路径对得上 */
const normDir = (d: string) => d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

export function useForgeSource(project: string, installed: boolean | undefined) {
  const [data, setData] = useState<ForgeData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'' | 'quick' | 'deep'>('')
  const [health, setHealth] = useState<ForgeHealth>()
  const [dirKinds, setDirKinds] = useState<Map<string, string>>(() => new Map())

  // 每次刷新一个序号：慢的 UE 回包晚到时不盖掉更新的结果，磁盘清单晚于 UE 回来时也不把状态冲掉
  const seq = useRef(0)
  const reload = (deep = false) => {
    const n = ++seq.current
    // UE 读成功了才丢掉后到的磁盘清单。编辑器没开时 UE 那边立刻失败，比磁盘还早回来：
    // 以前按「UE 回过了」就丢磁盘结果，左栏只剩一条报错、配置树一个都不显示（用户 2026-11-16）
    let ueOk = false
    let ueFailed = false
    setLoading(deep ? 'deep' : 'quick')
    if (!deep)
      loadAll(project, false, true)
        .then((d) => {
          if (n !== seq.current || ueOk) return
          setData((prev) => (ueFailed ? offline(keepStates(d, prev)) : keepStates(d, prev)))
          // UE 已经报错时留着那条报错（「UE 没在运行…」），底栏照旧提示
          if (!ueFailed) setError('')
        })
        // 磁盘读失败不算错：照旧等 UE 的
        .catch(() => undefined)
    loadAll(project, deep)
      .then((d) => {
        if (n !== seq.current) return
        ueOk = true
        setData(d)
        setError('')
      })
      .catch((e: Error) => {
        if (n !== seq.current) return
        ueFailed = true
        // 列表已经（或稍后）从磁盘出来：只是状态没读到，留着列表，错误显示在底栏（Forge.tsx）
        setData((prev) => prev && offline(prev))
        setError(e.message)
      })
      .finally(() => n === seq.current && setLoading(''))
    // 配置根可能刚被建出来（导出了第一份配置），一起重拉
    void loadHealth(project)
      .then(setHealth)
      .catch(() => undefined)
  }

  useEffect(() => {
    if (!installed) return
    // 换了项目：上一个项目的状态不能按 key 接到这个项目的清单上
    setData(undefined)
    reload()
    void op<{ kinds?: { kind: string; dir?: string }[] }>(project, 'forge.kinds')
      .then((r) => setDirKinds(new Map((r.kinds ?? []).filter((k) => k.dir).map((k) => [normDir(k.dir!), k.kind]))))
      .catch(() => undefined)
    // 换项目、装好扩展时重拉；reload 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project, installed])

  return { data, error, loading, health, dirKinds, reload }
}
