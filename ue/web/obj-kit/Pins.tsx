import { Pin, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GmObject } from '../../shared/gm/schema.ts'
import { h, t } from '../host.ts'
import { useRefHits } from '../sections/uekit/gt-ref/live.ts'

/** 值写成一行：字符串原样，别的 JSON，太长截断 */
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : v === undefined ? '—' : JSON.stringify(v)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/**
 * 钉住的属性（GM 页梳理 F4）：在中栏属性行尾点图钉，钉住的显示在对象头卡下面，值挂在 gt.watch（gt.resolve 带 show）上收推送，
 * 不轮询；变了闪一下。命中几个就显示第一个的值、旁边写「×N」（挑了实例时按挑的）。游戏没在跑时只列名字。
 * 钉了哪些按对象记在本机（调用方存）
 */
export function Pins({
  project,
  game,
  obj,
  pins,
  onUnpin,
}: {
  project: string
  /** 游戏在跑：才订阅值 */
  game: boolean
  /** 当前对象（挑了实例就是收窄后的） */
  obj: GmObject
  pins: string[]
  onUnpin: (prop: string) => void
}) {
  const { cn } = h()
  const refs = obj.ref && pins.length ? [{ id: 'pins', ref: obj.ref as { class: string } }] : []
  const r = useRefHits(project, game, refs, undefined, pins)
  const hit = r.hits.pins
  const first = hit?.candidates?.[0]
  const valueOf = (p: string) => first?.ident?.find((x) => x.prop === p)?.actual
  // 变了闪一下：记住上一次的值，和这次比
  const last = useRef<Record<string, string>>({})
  const [flash, setFlash] = useState<string[]>([])
  const sig = pins.map((p) => `${p}=${JSON.stringify(valueOf(p))}`).join('|')
  useEffect(() => {
    const now: Record<string, string> = {}
    const changed: string[] = []
    for (const p of pins) {
      now[p] = JSON.stringify(valueOf(p))
      if (p in last.current && last.current[p] !== now[p]) changed.push(p)
    }
    last.current = now
    if (!changed.length) return
    setFlash(changed)
    const id = setTimeout(() => setFlash([]), 900)
    return () => clearTimeout(id)
    // 只在值变了（sig）时比
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  if (!pins.length) return null
  return (
    <div className="ue:flex ue:shrink-0 ue:flex-wrap ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-4 ue:py-1.5">
      <Pin className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      {pins.map((p) => (
        <span
          key={p}
          className={cn(
            'ue:group ue:inline-flex ue:h-6 ue:max-w-72 ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:border ue:border-line ue:px-2 ue:font-mono ue:text-caption ue:transition-colors',
            flash.includes(p) ? 'ue:bg-warning/20' : 'ue:bg-card',
          )}
          title={p}
        >
          <span className="ue:truncate ue:text-muted">{p.replace(/^@[.#]/, '')}</span>
          <span className="ue:truncate ue:text-fg">{game ? short(valueOf(p)) : '—'}</span>
          <button
            type="button"
            title={t('取消钉住')}
            onClick={() => onUnpin(p)}
            className="ue:grid ue:cursor-pointer ue:text-subtle ue:opacity-0 ue:group-hover:opacity-100 ue:hover:text-fg"
          >
            <X className="ue:h-3 ue:w-3" />
          </button>
        </span>
      ))}
      {game && (hit?.count ?? 0) > 1 && (
        <span className="ue:text-caption ue:text-subtle">{t('第一个实例的值 · 共 {n} 个', { n: hit!.count })}</span>
      )}
      {!game && <span className="ue:text-caption ue:text-subtle">{t('游戏没在运行，开 PIE 后实时显示')}</span>}
      {r.error && <span className="ue:text-caption ue:text-danger">{r.error}</span>}
    </div>
  )
}
