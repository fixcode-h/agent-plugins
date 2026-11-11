import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { h, t } from './host.ts'

export interface ClassOpt {
  /** 类名（不带 U / A 前缀，和 UE 里 GetName 一样） */
  name: string
  /** 类的完整路径：同名的蓝图类靠它分得开；常用项、手输的没有，桥接按名字找 */
  path?: string
  /** 显示成别的字（「所有类型」「UObject」） */
  label?: string
  /** 右边的小字：父类、资源个数 */
  note?: string
}

const same = (a: ClassOpt, b: ClassOpt) => (a.path && b.path ? a.path === b.path : a.name === b.name)

/**
 * 选类型的可搜索下拉（Object 页选对象的类、资源页选资源类型）：收起时像普通下拉，点开变成输入框，
 * 下面先列常用的，打字后接上从 UE 里搜到的类。类有几万个，不能一次全列，所以按输入的字去搜；
 * 桥接是旧版本（搜不了类）或 UE 没开时，输入的字本身也能当类名用
 */
export function ClassPicker({
  value,
  onChange,
  common,
  load,
  placeholder,
}: {
  value: ClassOpt
  onChange: (c: ClassOpt) => void
  /** 不打字时列的常用类型 */
  common: ClassOpt[]
  /** 按输入的字从 UE 里搜；不给就只有常用的和手输的 */
  load?: (q: string) => Promise<ClassOpt[]>
  placeholder: string
}) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<ClassOpt[]>([])
  const [busy, setBusy] = useState(false)
  const [cur, setCur] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const fn = useRef(load)
  fn.current = load

  // 打字停 200 毫秒再去 UE 里搜：每个字都搜一遍会在游戏线程上白扫几次类表
  useEffect(() => {
    if (!open || !fn.current) return
    let dead = false
    setBusy(true)
    const id = setTimeout(
      () =>
        void fn.current!(q.trim())
          .catch((): ClassOpt[] => [])
          .then((r) => {
            if (dead) return
            setRemote(r)
            setBusy(false)
          }),
      q ? 200 : 0,
    )
    return () => {
      dead = true
      clearTimeout(id)
    }
  }, [open, q])

  // 点到外面收起
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  const opts = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hit = (c: ClassOpt) => !s || c.name.toLowerCase().includes(s) || !!c.label?.toLowerCase().includes(s)
    const out: ClassOpt[] = common.filter(hit)
    for (const r of remote)
      if (hit(r) && !out.some((o) => o.name === r.name && (!o.path || o.path === r.path))) out.push(r)
    // 列表里没有一模一样的名字时，输入的字自己也是一项：没加载的蓝图类、旧桥接搜不到的类照样能选
    if (s && !out.some((o) => o.name.toLowerCase() === s || o.label?.toLowerCase() === s))
      out.push({ name: q.trim(), note: t('按输入的类名') })
    return out
  }, [q, common, remote])
  const at = Math.min(cur, Math.max(0, opts.length - 1))

  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const pick = (c: ClassOpt) => {
    onChange(c)
    setOpen(false)
  }
  const field =
    'ue:flex ue:h-8 ue:w-full ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-line-strong ue:bg-field ue:px-2.5'

  return (
    <div ref={box} className="ue:relative">
      {open ? (
        <label className={cn(field, 'ue:border-focus')}>
          <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          <input
            autoFocus
            value={q}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => {
              setQ(e.target.value)
              setCur(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setCur((at + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % Math.max(1, opts.length))
              } else if (e.key === 'Enter') {
                // 在搜索表单里：回车是选类型，不是提交搜索
                e.preventDefault()
                if (opts[at]) pick(opts[at])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
            }}
            className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle"
          />
          {busy && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('找…')}</span>}
        </label>
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          onClick={() => {
            setQ('')
            setCur(0)
            setOpen(true)
          }}
          className={cn(field, 'ue:cursor-pointer ue:text-left ue:hover:border-focus')}
        >
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-body ue:text-fg">
            {value.label ?? value.name}
          </span>
          <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
        </button>
      )}
      {open && (
        <ul
          ref={list}
          role="listbox"
          className="ue:absolute ue:top-full ue:right-0 ue:left-0 ue:z-30 ue:mt-1 ue:max-h-72 ue:overflow-auto ue:rounded-xl ue:border ue:border-pop-edge ue:bg-card ue:p-1 ue:shadow-pop"
        >
          {opts.map((o, i) => (
            <li key={`${o.path ?? ''}|${o.name}|${o.note ?? ''}`} role="option" aria-selected={same(o, value)}>
              <button
                type="button"
                onMouseEnter={() => setCur(i)}
                onClick={() => pick(o)}
                className={cn(
                  'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:text-left',
                  i === at && 'ue:bg-hover',
                )}
              >
                <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-body ue:text-fg" title={o.path}>
                  {o.label ?? o.name}
                </span>
                {same(o, value) && <Check className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text" />}
                {o.note && (
                  <span className="ue:ml-auto ue:max-w-[45%] ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">
                    {o.note}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!opts.length && <li className="ue:px-2 ue:py-1.5 ue:text-footnote ue:text-subtle">{t('没有找到')}</li>}
        </ul>
      )}
    </div>
  )
}
