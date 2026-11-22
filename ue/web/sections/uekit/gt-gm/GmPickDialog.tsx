import { Boxes, FileCode, History, ListOrdered, SquareFunction, Terminal, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GmKind, GmRef } from '../../../../shared/gt-script/gm/expand.ts'
import { h, t } from '../../../host.ts'
import { SearchBox } from '../../../ui.tsx'
import { search, type GmEntry } from '../../gm/data.ts'
import { useGm } from '../../gm/use-gm.ts'
import { refOfEntry, refOfMacro, refOfRecent, refText } from './gm-ref.ts'

export const KIND_ICON: Record<GmKind, LucideIcon> = {
  cpp: SquareFunction,
  lua: FileCode,
  console: Terminal,
  custom: Boxes,
  macro: ListOrdered,
}

interface Row {
  key: string
  icon: LucideIcon
  name: string
  sub: string
  ref: GmRef
}

/**
 * 选一条 GM（测试页「执行 GM」节点、附带 GM 的「加 GM…」，分析文档 G6 / U7）：
 * 和 GM 页同一份数据（use-gm.ts：C++ 要 UE 在跑、Lua 扫描、gm.json 的自定义 GM 和宏），分「最近在 GM 页调过 · GM · 自定义 GM · 宏 · 命令」几组一起搜。
 * 最近调过的带着当时的参数，选了就是那次的调用
 */
export function GmPickDialog({ title, onClose, onPick }: { title?: string; onClose: () => void; onPick: (ref: GmRef) => void }) {
  const { ui } = h()
  const data = useGm(0)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const k = q.trim().toLowerCase()
    const hit = (s: string) => !k || s.toLowerCase().includes(k)
    const rowOf = (e: GmEntry): Row => {
      const ref = refOfEntry(e)
      return { key: e.key, icon: KIND_ICON[ref.kind], name: e.name, sub: e.group || e.desc, ref }
    }
    const found = search(data.entries, q)
    const seen = new Set<string>()
    const recent: Row[] = []
    for (const r of data.recent) {
      const ref = refOfRecent(r)
      const text = refText(ref)
      if (!ref || seen.has(text) || !hit(text)) continue
      seen.add(text)
      recent.push({ key: `recent:${text}`, icon: History, name: text, sub: r.ok ? t('上次成功') : t('上次失败'), ref })
      if (recent.length >= 8) break
    }
    return [
      { title: t('最近在 GM 页调过'), rows: recent },
      { title: 'GM', rows: found.filter((e) => e.src === 'lua' || e.src === 'cpp' || e.src === 'engine').map(rowOf) },
      { title: t('自定义 GM'), rows: found.filter((e) => e.src === 'custom' && e.custom?.kind !== 'get').map(rowOf) },
      {
        title: t('宏'),
        rows: data.gm.macros
          .filter((m) => hit(m.name))
          .map((m) => ({
            key: `macro:${m.id}`,
            icon: KIND_ICON.macro,
            name: m.name,
            sub: t('{n} 步', { n: m.steps.length }),
            ref: refOfMacro(m),
          })),
      },
      { title: t('命令'), rows: found.filter((e) => e.src === 'console').map(rowOf) },
    ].filter((g) => g.rows.length)
  }, [data.entries, data.recent, data.gm.macros, q])
  const loading = data.lua.loading || data.cpp.loading

  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={title ?? t('选一条 GM')}
      description={t('和 GM 页同一份：C++ GM 要 UE 在运行才列得出来。存的是「哪条 GM + 参数」，GM 库里改了，存盘和运行前会跟上。')}
      footer={
        <ui.Button variant="secondary" onClick={onClose}>
          {t('取消')}
        </ui.Button>
      }
    >
      <div className="ue:flex ue:h-[60vh] ue:min-h-0 ue:flex-col ue:gap-2">
        <SearchBox live placeholder={t('按名字、说明、参数搜')} onSearch={setQ} />
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line">
          {!groups.length && (
            <p className="ue:p-4 ue:text-footnote ue:text-subtle">
              {loading ? t('正在读 GM 列表…') : q ? t('没有含「{q}」的 GM', { q }) : t('还没有 GM：去 GM 页看看')}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.title}>
              <div className="ue:sticky ue:top-0 ue:bg-card ue:px-3 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-muted">
                {g.title}
              </div>
              {g.rows.slice(0, 200).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-1.5 ue:text-left ue:hover:bg-hover"
                  onClick={() => onPick(r.ref)}
                >
                  <r.icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
                  <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{r.name}</span>
                  {r.sub && <span className="ue:ml-auto ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">{r.sub}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </ui.Modal>
  )
}
