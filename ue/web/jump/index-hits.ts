import { FileCode2, Search, type LucideIcon } from 'lucide-react'
import { assetClassLabel, assetIcon } from '../asset-icons.ts'
import { t } from '../host.ts'
import { matchAssets, matchLua, type LoadedIndex } from './index-data.ts'

/** 跳转弹窗里索引命中的一行（和 Jump.tsx 的 Opt 同形） */
export interface IndexOpt {
  key: string
  icon: LucideIcon
  tone?: string
  label: string
  detail?: string
  hint?: string
  chat?: string
  run: () => void
}

export interface IndexGroup {
  id: 'assets' | 'lua'
  title: string
  opts: IndexOpt[]
}

/** 一次列多少条：多了弹窗要滚，用户一般再多打几个字 */
const ASSET_LIMIT = 12
const LUA_LIMIT = 6

export interface IndexActions {
  openAsset: (path: string) => void
  /** 去资源页搜（索引命中太多时的「看全部」） */
  searchAssets: () => void
  openLua: (file: string) => void
}

/** 索引里的资源、Lua 模块按输入筛出来的两组；没输入或没命中的组不给 */
export function indexGroups(idx: LoadedIndex | undefined, terms: string[], act: IndexActions): IndexGroup[] {
  if (!idx || !terms.length) return []
  const groups: IndexGroup[] = []
  const a = matchAssets(idx, terms, ASSET_LIMIT)
  if (a.total) {
    const opts: IndexOpt[] = a.rows.map((r) => {
      const ic = assetIcon(r.cls)
      const kind = r.cls ? assetClassLabel(r.cls) : ''
      return {
        key: `asset:${r.path}`,
        icon: ic.icon,
        tone: ic.tone,
        label: r.name,
        detail: r.dir,
        hint: r.parent ? `${kind} · ${r.parent}` : kind,
        chat: r.path,
        run: () => act.openAsset(r.path),
      }
    })
    if (a.total > a.rows.length)
      opts.push({
        key: 'asset:more',
        icon: Search,
        label: t('还有 {n} 个，到资源页搜', { n: a.total - a.rows.length }),
        run: act.searchAssets,
      })
    groups.push({
      id: 'assets',
      title:
        idx.source.assets === 'uetovs'
          ? t('资源（{n} 个，UEToVS 索引）', { n: a.total })
          : t('资源（{n} 个）', { n: a.total }),
      opts,
    })
  }
  const l = matchLua(idx, terms, LUA_LIMIT)
  if (l.total)
    groups.push({
      id: 'lua',
      title: t('Lua 模块（{n} 个）', { n: l.total }),
      opts: l.rows.map((r) => ({
        key: `lua:${r.file}`,
        icon: FileCode2,
        label: r.module,
        detail: r.file.replace(/\\/g, '/').split('/').slice(-3).join('/'),
        hint: t('用编辑器打开'),
        chat: t('Lua 模块 {m}（{f}）', { m: r.module, f: r.file }),
        run: () => act.openLua(r.file),
      })),
    })
  return groups
}

/** 空输入时弹窗底下那行：索引里有多少、从哪来 */
export function indexSummary(idx: LoadedIndex | undefined, loading: boolean, error: string) {
  if (error) return t('索引没建好：{msg}', { msg: error })
  if (!idx) return loading ? t('正在建索引…') : ''
  const from = idx.source.assets === 'uetovs' ? t('来自 UEToVS 的索引') : t('面板扫磁盘建的索引')
  const lua = idx.lua.length ? t('，Lua 模块 {n} 个', { n: idx.lua.length }) : ''
  return t('已索引资源 {n} 个{lua}（{from}），打字直接筛', { n: idx.assets.length, lua, from })
}
