import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyRow as KeyData } from '../../../server/editor-tools/config-layers.ts'
import { ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { DockCol, DockHead } from '../../nav/slot.tsx'
import { PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../split.tsx'
import { TreeList } from '../../TreeList.tsx'
import { TreeSearch } from '../../tree-search.tsx'
import { Badge, Card, ErrorText, Note, SearchBox } from '../../ui.tsx'
import { KeyRow } from './parts.tsx'
import { buildFileTree, fileAncestors, fileLineKey, type SecGroup } from './file-tree.ts'
import { ancestorsOf, buildSecTree, lineKeyOf, secLines, type Sec } from './section-tree.tsx'

const GROUP_KEY = 'ue:cfg-group'

/** 分组方式存进浏览器，下次打开还是上次选的（整页刷新也记得） */
function readGroup(): SecGroup {
  try {
    return localStorage.getItem(GROUP_KEY) === 'file' ? 'file' : 'section'
  } catch {
    return 'section'
  }
}

interface Live {
  pid?: number
  kind?: string
  error?: string
}
interface SectionsRes {
  layers: { label: string; file: string }[]
  sections: Sec[]
  live: Live
}
interface KeysRes {
  keys: (KeyData & { live?: string[]; differs?: boolean })[]
  live: Live
}
interface SearchRes {
  hits: { type: string; section: string; key: string; value: string; layer: string; file: string; line: number }[]
  more: boolean
}

/**
 * 项目配置：左栏选配置（Engine、Game…）和 section，右栏看这个 section 每个键的各层写法和最终值；
 * 顶上的搜索在全部配置里按键名、值找（「这个值在哪设的」）。section 列表本地筛，边打边筛；全局搜索回车才搜。
 * section 按「/Script/模块.类」拆成文件夹树（用户 2026-11-16「也改成文件树结构」，和资源页文件夹树同一个 TreeList），展开状态按配置记住；
 * 也能切成按 ini 文件分树（用户 2026-11-19）：先看是哪个文件写的，同一 section 被几个文件覆盖一目了然
 */
export function IniBrowser() {
  const { project } = useUe()
  const { ui } = h()
  const [file, setFile] = useKept(`cfg-file:${project.id}`, 'Engine')
  const [section, setSection] = useKept(`cfg-sec:${project.id}`, '')
  const [filter, setFilter] = useState('')
  const [group, setGroupState] = useState<SecGroup>(readGroup)
  const setGroup = (g: SecGroup) => {
    setGroupState(g)
    try {
      localStorage.setItem(GROUP_KEY, g)
    } catch {
      // 存不了（隐私模式）就只在这次打开里记着
    }
  }
  // 按 section 默认展开 /Script（绝大多数 section 在它下面）；按文件默认全收起，先看有哪些文件
  const [open, setOpen] = useKept<string[]>(
    `cfg-open:${project.id}:${file}:${group}`,
    group === 'file' ? [] : ['/Script'],
  )
  // 筛选时自动展开的文件夹，用户再点收起记在这里（换关键词清掉），和资源页文件夹树一样
  const [fold, setFold] = useState<{ q: string; m: Record<string, boolean> }>({ q: '', m: {} })
  const [reveal, setReveal] = useState<{ key: string; seq: number }>()
  const [query, setQuery] = useState('')
  const pane = usePane('config', '320px', 220)
  const left = useRef<HTMLElement>(null)
  const types = useLoad(() => ppost<{ types: string[] }>(project.id, 'tools/config', {}), [project.id])
  const secs = useLoad(() => ppost<SectionsRes>(project.id, 'tools/config', { file }), [project.id, file])
  const keys = useLoad(
    () => (section ? ppost<KeysRes>(project.id, 'tools/config', { file, section }) : Promise.resolve(undefined)),
    [project.id, file, section],
  )
  const found = useLoad(
    () => (query ? ppost<SearchRes>(project.id, 'tools/config', { query }) : Promise.resolve(undefined)),
    [project.id, query],
  )
  const tree = useMemo(
    () =>
      group === 'file'
        ? buildFileTree(secs.data?.sections ?? [], secs.data?.layers ?? [])
        : buildSecTree(secs.data?.sections ?? []),
    [secs.data, group],
  )
  const folded = fold.q === filter ? fold.m : {}
  const { lines, hits } = useMemo(
    () =>
      secLines({
        tree,
        q: filter,
        open,
        folded,
        section,
        toggle: (k) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k])),
        fold: (k, wasOpen) => setFold({ q: filter, m: { ...folded, [k]: wasOpen } }),
        pick: setSection,
      }),
    // setOpen、setSection 每次渲染都是新的，按数据变化重算就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [tree, filter, open, fold, section],
  )
  const total = secs.data?.sections.length ?? 0
  // 从全局搜索结果跳过来、或换配置后记住的 section：展开到它所在的文件夹并滚过去
  useEffect(() => {
    if (!section || !secs.data) return
    const sec = secs.data.sections.find((s) => s.name === section)
    if (group === 'file' && !sec) return
    const up = group === 'file' && sec ? fileAncestors(sec) : ancestorsOf(section)
    const key = group === 'file' && sec ? fileLineKey(sec) : lineKeyOf(section)
    if (up.some((k) => !open.includes(k))) setOpen((o) => [...new Set([...o, ...up])])
    setReveal((r) => ({ key, seq: (r?.seq ?? 0) + 1 }))
    // 只在换了 section、分组方式或列表刚读到时定位一次，用户之后收起文件夹不再强行展开
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [section, secs.data, group])
  const live = keys.data?.live ?? secs.data?.live

  const col = (docked: boolean) => (
    <>
      {docked && <DockHead title={file} aside={t('{n} 个 section', { n: total })} />}
      <div className="ue:px-3 ue:pt-2">
        <ui.Segmented
          size="sm"
          label={t('section 分组方式')}
          value={group}
          onChange={setGroup}
          options={[
            { id: 'section' as const, label: t('按 section') },
            { id: 'file' as const, label: t('按 ini 文件') },
          ]}
        />
      </div>
      <TreeSearch value={filter} onChange={setFilter} placeholder={t('section 名包含…')} hits={hits} />
      <ErrorText>{secs.error}</ErrorText>
      {!secs.loading && !total && !secs.error && (
        <p className="ue:p-4 ue:text-footnote ue:text-subtle">
          {t('磁盘上没找到这个配置的 ini（引擎目录没找到时只看项目里的）')}
        </p>
      )}
      <TreeList lines={lines} label={t('section 树')} reveal={reveal} />
    </>
  )

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
        <div className="ue:w-48">
          <ui.Select
            value={file}
            aria-label={t('配置')}
            onChange={(e: { target: { value: string } }) => {
              setFile(e.target.value)
              setSection('')
            }}
            options={(types.data?.types ?? [file]).map((x) => ({ value: x, label: x }))}
          />
        </div>
        <div className="ue:min-w-60 ue:flex-1">
          <SearchBox
            placeholder={t('在全部配置里搜键名或值（如 MaxPlayers）')}
            onSearch={setQuery}
            allowEmpty
            busy={found.loading}
          />
        </div>
        {live &&
          (live.error ? (
            <Badge title={live.error}>{t('只看磁盘上的 ini')}</Badge>
          ) : (
            <Badge tone="ok">{t('带上进程 {pid} 里的最终值', { pid: live.pid ?? '' })}</Badge>
          ))}
      </div>
      {query && (
        <Card
          title={t('搜索「{q}」', { q: query })}
          aside={found.data?.more ? t('只列前 100 条') : t('{n} 条', { n: found.data?.hits.length ?? 0 })}
          className="ue:max-h-[40%] ue:border-b ue:border-line"
          bodyClass="ue:overflow-auto"
        >
          <ErrorText>{found.error}</ErrorText>
          <ul className="ue:divide-y ue:divide-line">
            {(found.data?.hits ?? []).map((x, i) => (
              <li key={i}>
                <button
                  type="button"
                  title={`${x.file}:${x.line}`}
                  onClick={() => {
                    setFile(x.type)
                    setSection(x.section)
                  }}
                  className="ue:flex ue:w-full ue:cursor-pointer ue:items-baseline ue:gap-3 ue:px-4 ue:py-1.5 ue:text-left ue:hover:bg-hover"
                >
                  <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{x.type}</span>
                  <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-muted">
                    [{x.section}]
                  </span>
                  <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                    {x.key}={x.value}
                  </span>
                  <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{x.layer}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className={SPLIT_ROW}>
        {/* section 树整栏放进左边二级面板（用户 2026-11-18 定） */}
        <DockCol
          body={col}
          fallback={
            <>
              <Card
                ref={left}
                className={PANE_FIXED}
                style={pane.style('60%')}
                bodyClass="ue:flex ue:min-h-0 ue:flex-col"
                title={file}
                aside={t('{n} 个 section', { n: total })}
              >
                {col(false)}
              </Card>
              <SplitHandle pane={pane} paneRef={left} reserve={() => 360} />
            </>
          }
        />
        <Card
          className="ue:min-w-0 ue:lg:flex-1"
          bodyClass="ue:overflow-auto"
          title={section ? <span className="ue:truncate ue:font-mono">[{section}]</span> : t('选一个 section')}
          aside={keys.data ? t('{n} 个键', { n: keys.data.keys.length }) : undefined}
        >
          <ErrorText>{keys.error}</ErrorText>
          {!section && (
            <div className="ue:p-4">
              <Note tone="info">
                {t(
                  '左边选 section 看每个键在 Base、Default、平台、Saved 各层怎么写的，最后哪层定了值；UE 开着时进程里的值不一样会标黄（插件的 Config、命令行或运行中改过）。',
                )}
              </Note>
            </div>
          )}
          <ul className="ue:divide-y ue:divide-line">
            {(keys.data?.keys ?? []).map((k) => (
              <KeyRow key={k.key} row={k} />
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
