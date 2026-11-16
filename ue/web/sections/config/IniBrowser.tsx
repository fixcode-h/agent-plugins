import { useMemo, useRef, useState } from 'react'
import type { KeyRow as KeyData } from '../../../server/editor-tools/config-layers.ts'
import { ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../split.tsx'
import { Badge, Card, ErrorText, Note, SearchBox } from '../../ui.tsx'
import { KeyRow } from './parts.tsx'

interface Live {
  pid?: number
  kind?: string
  error?: string
}
interface SectionsRes {
  layers: { label: string; file: string }[]
  sections: { name: string; layers: string[]; liveOnly?: boolean }[]
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
 */
export function IniBrowser() {
  const { project } = useUe()
  const { ui, cn } = h()
  const [file, setFile] = useKept(`cfg-file:${project.id}`, 'Engine')
  const [section, setSection] = useKept(`cfg-sec:${project.id}`, '')
  const [filter, setFilter] = useState('')
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
  const shown = useMemo(() => {
    const f = filter.toLowerCase()
    return (secs.data?.sections ?? []).filter((s) => !f || s.name.toLowerCase().includes(f))
  }, [secs.data, filter])
  const live = keys.data?.live ?? secs.data?.live

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
                  <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-muted">[{x.section}]</span>
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
        <Card
          ref={left}
          className={PANE_FIXED}
          style={pane.style('60%')}
          bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          title={file}
          aside={t('{n} 个 section', { n: shown.length })}
        >
          <div className="ue:border-b ue:border-line ue:p-3">
            <SearchBox placeholder={t('section 名包含…')} onSearch={setFilter} live />
          </div>
          <ErrorText>{secs.error}</ErrorText>
          {!secs.loading && !shown.length && !secs.error && (
            <p className="ue:p-4 ue:text-footnote ue:text-subtle">
              {secs.data?.layers.length ? t('没有匹配的 section') : t('磁盘上没找到这个配置的 ini（引擎目录没找到时只看项目里的）')}
            </p>
          )}
          <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
            {shown.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  title={s.liveOnly ? t('只在进程里有（插件的 Config 或运行中加的）') : s.layers.join('\n')}
                  onClick={() => setSection(s.name)}
                  className={cn(
                    'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:text-left ue:hover:bg-hover',
                    s.name === section && 'ue:bg-sel',
                  )}
                >
                  <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{s.name}</span>
                  <span className="ue:shrink-0 ue:text-caption ue:text-subtle">
                    {s.liveOnly ? t('进程') : s.layers.length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <SplitHandle pane={pane} paneRef={left} reserve={() => 360} />
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
                {t('左边选 section 看每个键在 Base、Default、平台、Saved 各层怎么写的，最后哪层定了值；UE 开着时进程里的值不一样会标黄（插件的 Config、命令行或运行中改过）。')}
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
