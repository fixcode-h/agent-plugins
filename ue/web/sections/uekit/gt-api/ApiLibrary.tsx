import { ChevronDown, ChevronRight, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { SearchBox } from '../../../ui.tsx'
import { rejectedOfFile, sigOf, useApis, type ApiItem, type ApiRejected } from './model.ts'

type Src = ApiItem['src']
const SRC_ORDER: Src[] = ['builtin', 'cpp', 'lua', 'script']
const srcLabel = (s: Src) => ({ builtin: t('自带'), cpp: 'C++', lua: 'Lua', script: t('脚本') })[s]

/** 被拒的原因：面板扫 Lua 时写的是代码（private / varargs），GameTest 扫 C++ 时直接写中文 */
const whyText = (why: string) =>
  ({
    private: t('名字以下划线开头，当成内部函数'),
    varargs: t('参数里有 ...，脚本给不了不定个数的参数'),
  })[why] ?? why

/**
 * 接口库（定稿 9.8、效果图 9）：脚本里「调接口」能用的全部接口，按来源和分类列出。
 * 自带的要编辑器开着才列得出（GameTest 给）；项目的 C++ 接口由 GameTest 扫，存 _api.json，编辑器没开也看得到；
 * Lua 接口由面板扫场景设置里指定的文件夹（默认 GameTestApi），按 EmmyLua 注释认参数。没收进来的单独列出原因
 */
export function ApiLibrary({
  project,
  root,
  live,
  onClose,
}: {
  project: string
  root: string
  live: boolean
  onClose: () => void
}) {
  const { ui, cn } = h()
  const apis = useApis(project, root, live)
  const [src, setSrc] = useState<'all' | Src>('all')
  const [q, setQ] = useState('')
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [showRejected, setShowRejected] = useState(false)
  const [scanning, setScanning] = useState(false)
  const rejected = rejectedOfFile(apis.file)
  const low = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const map = new Map<string, ApiItem[]>()
    for (const it of apis.items) {
      if (src !== 'all' && it.src !== src) continue
      if (low && ![it.name, it.display, it.note, it.category].some((x) => x?.toLowerCase().includes(low))) continue
      const k = `${it.src}\u0000${it.category || t('未分类')}`
      map.set(k, [...(map.get(k) ?? []), it])
    }
    return [...map.entries()]
      .map(([k, items]) => {
        const [s, cat] = k.split('\u0000')
        return { key: k, src: s as Src, cat, items }
      })
      .sort((a, b) => SRC_ORDER.indexOf(a.src) - SRC_ORDER.indexOf(b.src) || a.cat.localeCompare(b.cat))
  }, [apis.items, src, low])
  const count = (s: Src) => apis.items.filter((x) => x.src === s).length

  const scan = async () => {
    setScanning(true)
    try {
      const r = await ppost<{ counts: Record<string, number>; written?: boolean }>(project, 'ext/gt/api', {
        root,
        action: 'scan',
      })
      const n = Object.values(r.counts).reduce((a, b) => a + b, 0)
      h().toast.success(
        r.written ? t('扫到 {n} 个 Lua 接口，已写进 _api.json', { n }) : t('扫到 {n} 个 Lua 接口，和上次一样', { n }),
      )
      apis.reload()
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const folders = apis.file?.doc.lua?.folders
  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('接口库')}
      description={t('脚本里「调接口」能用的接口：自带的、项目 C++ 里标了的、Lua 接口文件夹里的。只读的可以用在条件里。')}
      footer={
        <>
          <span className="ue:mr-auto ue:truncate ue:text-footnote ue:text-subtle">
            {apis.file?.path}
            {folders?.length ? ` · ${t('Lua 文件夹：{f}', { f: folders.join('、') })}` : ''}
          </span>
          <ui.Button variant="secondary" disabled={scanning || !root} onClick={() => void scan()}>
            {scanning ? <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" /> : <RefreshCw className="ue:h-3.5 ue:w-3.5" />}
            {t('重扫 Lua 接口')}
          </ui.Button>
          <ui.Button onClick={onClose}>{t('关闭')}</ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:h-[62vh] ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2">
          <SearchBox live onSearch={setQ} placeholder={t('搜接口名、说明、分类')} />
          <ui.Segmented
            size="sm"
            className="ue:ml-auto"
            label={t('来源')}
            value={src}
            onChange={setSrc}
            options={[
              { id: 'all' as const, label: t('全部 {n}', { n: apis.items.length }) },
              ...SRC_ORDER.filter((s) => count(s)).map((s) => ({ id: s, label: `${srcLabel(s)} ${count(s)}` })),
            ]}
          />
        </div>
        {(!live || apis.error) && (
          <p className="ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-caption ue:text-warning">
            {live ? apis.error : t('编辑器没开：只列得出 _api.json 里存着的项目接口，自带接口要编辑器开着')}
          </p>
        )}
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
          {!groups.length && (
            <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('没有接口')}</p>
          )}
          {groups.map((g) => {
            const off = folded[g.key]
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => setFolded({ ...folded, [g.key]: !off })}
                  className="ue:sticky ue:top-0 ue:z-10 ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:bg-panel ue:px-3 ue:text-left ue:text-footnote"
                >
                  {off ? (
                    <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                  ) : (
                    <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                  )}
                  <span className="ue:rounded-sm ue:bg-hover ue:px-1.5 ue:text-caption ue:text-muted">{srcLabel(g.src)}</span>
                  <span className="ue:text-fg">{g.cat}</span>
                  <span className="ue:ml-auto ue:text-caption ue:text-subtle ue:tabular-nums">{g.items.length}</span>
                </button>
                {!off &&
                  g.items.map((it) => (
                    <div
                      key={it.name}
                      className="ue:grid ue:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1.2fr)] ue:items-center ue:gap-3 ue:border-b ue:border-line/40 ue:px-3 ue:py-1.5 ue:text-footnote"
                    >
                      <div className="ue:min-w-0">
                        <div className="ue:truncate ue:font-mono ue:text-fg" title={sigOf(it)}>
                          {sigOf(it)}
                        </div>
                        {it.display && <div className="ue:truncate ue:text-caption ue:text-subtle">{it.display}</div>}
                      </div>
                      <span
                        className={cn(
                          'ue:rounded-sm ue:px-1.5 ue:text-caption',
                          it.readOnly ? 'ue:bg-success/12 ue:text-success' : 'ue:bg-warning/12 ue:text-warning',
                        )}
                      >
                        {it.readOnly ? t('只读') : t('会改东西')}
                      </span>
                      <span className="ue:truncate ue:text-subtle" title={it.note}>
                        {it.note}
                        {it.file && (
                          <span className="ue:font-mono ue:text-caption">
                            {' '}
                            · {it.file}
                            {it.line ? `:${it.line}` : ''}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            )
          })}
          {rejected.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowRejected(!showRejected)}
                className="ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:bg-panel ue:px-3 ue:text-left ue:text-footnote"
              >
                {showRejected ? (
                  <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                ) : (
                  <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                )}
                <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:text-warning" />
                <span className="ue:text-fg">{t('没收进来的 {n} 个', { n: rejected.length })}</span>
              </button>
              {showRejected && rejected.map((r, i) => <RejectedRow key={i} r={r} />)}
            </div>
          )}
        </div>
      </div>
    </ui.Modal>
  )
}

function RejectedRow({ r }: { r: ApiRejected }) {
  return (
    <div className="ue:grid ue:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] ue:gap-3 ue:border-b ue:border-line/40 ue:px-3 ue:py-1.5 ue:text-footnote">
      <span className="ue:truncate ue:font-mono ue:text-fg">
        {r.class ?? r.module}.{r.function}
      </span>
      <span className="ue:truncate ue:text-subtle">
        {whyText(r.why)}
        {r.file && (
          <span className="ue:font-mono ue:text-caption">
            {' '}
            · {r.file}
            {r.line ? `:${r.line}` : ''}
          </span>
        )}
      </span>
    </div>
  )
}
