import { Boxes, FileCode, History, ListOrdered, SquareFunction, Terminal, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GmCat } from '../../../../shared/gm/schema.ts'
import type { GmKind, GmRef } from '../../../../shared/gt-script/gm/expand.ts'
import { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'
import { GmNav, type GmPick, type SrcFilter } from '../../gm/nav/GmNav.tsx'
import { useGm } from '../../gm/use-gm.ts'
import { refOfEntry, refOfMacro, refOfRecent, refText } from './gm-ref.ts'

export const KIND_ICON: Record<GmKind, LucideIcon> = {
  cpp: SquareFunction,
  lua: FileCode,
  console: Terminal,
  custom: Boxes,
  macro: ListOrdered,
}

const noop = () => {}

/**
 * 选一条 GM（测试页「执行 GM」节点、附带 GM 的「加 GM…」，分析文档 G6 / U7）：
 * 左栏直接用 GM 页那棵树（GmNav：常用 · GM · 引擎命令 · 宏，下面按模块 / 分组折叠，可搜），和 GM 页同一份数据（use-gm.ts）。
 * 用户 2026-11-22：以前是一长串平铺列表，要和 GM 页一样按原本的树列。点一条就选上；底下「最近在 GM 页调过」带着当时的参数
 */
export function GmPickDialog({ title, onClose, onPick }: { title?: string; onClose: () => void; onPick: (ref: GmRef) => void }) {
  const { ui } = h()
  const data = useGm(0)
  const [askDialog, ask] = useAsk()
  const [cat, setCat] = useState<GmCat>('gm')
  const [q, setQ] = useState('')
  const [src, setSrc] = useState<SrcFilter>('all')
  const byKey = useMemo(() => new Map(data.entries.map((e) => [e.key, e])), [data.entries])

  const pick = (p: GmPick) => {
    if (p.kind === 'macro') {
      const m = data.gm.macros.find((x) => x.id === p.id)
      if (m) onPick(refOfMacro(m))
      return
    }
    const e = byKey.get(p.key)
    if (!e) return void h().toast.error(t('找不到这条 GM：UE 没在运行时 C++ GM 列不出来'))
    onPick(refOfEntry(e, p.args as GmRef['args']))
  }

  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out: { text: string; ref: GmRef; ok: boolean }[] = []
    for (const r of data.recent) {
      const ref = refOfRecent(r)
      const text = refText(ref)
      if (!ref || seen.has(text)) continue
      seen.add(text)
      out.push({ text, ref, ok: !!r.ok })
      if (out.length >= 5) break
    }
    return out
  }, [data.recent])

  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={title ?? t('选一条 GM')}
      description={t('和 GM 页同一棵树：C++ GM 要 UE 在运行才列得出来。存的是「哪条 GM + 参数」，GM 库里改了，存盘和运行前会跟上。')}
      footer={
        <ui.Button variant="secondary" onClick={onClose}>
          {t('取消')}
        </ui.Button>
      }
    >
      <div className="ue:flex ue:h-[62vh] ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
        <GmNav
          d={data}
          cat={cat}
          onCat={setCat}
          cats={['common', 'gm', 'engine', 'macro']}
          q={q}
          onQ={setQ}
          src={src}
          onSrc={setSrc}
          onPick={pick}
          onNewMacro={noop}
          onNewModule={noop}
          onGmMenu={noop}
          onModuleMenu={noop}
          onMacroMenu={noop}
          onFavMenu={() => []}
          ask={ask}
          onOpenObj={() => h().toast.error(t('对象调用不能直接加：在 GM 页把它存成 GM 再选'))}
          offline={!data.inst}
          footer={
            recent.length > 0 && (
              <div className="ue:shrink-0 ue:border-t ue:border-line ue:py-1">
                <div className="ue:flex ue:items-center ue:gap-1.5 ue:px-3 ue:py-1 ue:text-caption ue:font-medium ue:text-muted">
                  <History className="ue:h-3.5 ue:w-3.5" />
                  {t('最近在 GM 页调过（带当时的参数）')}
                </div>
                {recent.map((r) => (
                  <button
                    key={r.text}
                    type="button"
                    className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-1 ue:text-left ue:hover:bg-hover"
                    onClick={() => onPick(r.ref)}
                  >
                    {(() => {
                      const Icon = KIND_ICON[r.ref.kind]
                      return <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
                    })()}
                    <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{r.text}</span>
                    <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">
                      {r.ok ? t('上次成功') : t('上次失败')}
                    </span>
                  </button>
                ))}
              </div>
            )
          }
        />
      </div>
      {askDialog}
    </ui.Modal>
  )
}
