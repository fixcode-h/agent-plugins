import { ChevronDown, ChevronUp, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fitArgs, rankQuick, splitQuick } from '../../../../shared/gm/quick.ts'
import { h, t } from '../../../host.ts'

/** 补全里的一条：一条 GM（含控制台命令、自定义 GM）或一个宏 */
export interface QuickTarget {
  name: string
  kind: string
  /** 参数名，补全里提示「名字 参数1 参数2」 */
  params: string[]
  run: (args: string[]) => void
}

/**
 * 快速执行栏（GM 页梳理 F6）：会打字的人不用点树，直接敲「名字 参数 参数」回车执行，结果进最近执行。
 * 补全 Lua / C++ / 自定义 GM、宏和控制台命令；名字找不到时整行当控制台命令执行。Ctrl+G 展开并聚焦，能收起（记在本机）。
 * 只管输入和补全，执行由调用方给（targets、onConsole）
 */
export function QuickRun({
  targets,
  canRun,
  onConsole,
  open,
  onOpen,
}: {
  targets: QuickTarget[]
  /** 现在不能执行的原因（UE 没在运行），空串是能执行 */
  canRun: string
  /** 名字对不上任何条目：整行当控制台命令 */
  onConsole: (line: string) => void
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const { cn } = h()
  const [line, setLine] = useState('')
  const [hi, setHi] = useState(0)
  const [focus, setFocus] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const { name, args } = splitQuick(line)
  // 只在还在写名字（没打空格）时给补全
  const typingName = !/\s/.test(line.trimStart())
  const list = useMemo(() => (typingName ? rankQuick(targets, name) : []), [targets, name, typingName])
  const exact = targets.find((x) => x.name.toLowerCase() === name.toLowerCase())

  // Ctrl+G：展开并聚焦（浏览器的「查找下一个」在这页让给它）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'g' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      e.preventDefault()
      onOpen(true)
      setTimeout(() => ref.current?.focus(), 0)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onOpen])

  const submit = () => {
    if (!name || canRun) return
    if (exact) exact.run(fitArgs(args, exact.params.length))
    else onConsole(line.trim())
    setLine('')
  }
  const pick = (x: QuickTarget) => {
    setLine(x.params.length ? `${x.name} ` : x.name)
    setHi(0)
    ref.current?.focus()
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          onOpen(true)
          setTimeout(() => ref.current?.focus(), 0)
        }}
        className="ue:flex ue:h-7 ue:w-full ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-4 ue:text-caption ue:text-subtle ue:hover:text-fg"
      >
        <Zap className="ue:h-3.5 ue:w-3.5" />
        {t('快速执行')}
        <kbd className="ue:font-mono">Ctrl+G</kbd>
        <ChevronDown className="ue:ml-auto ue:h-3.5 ue:w-3.5" />
      </button>
    )
  const hint = exact
    ? [exact.name, ...exact.params].join(' ')
    : name && !list.length
      ? t('找不到叫「{n}」的 GM 或宏，回车当控制台命令执行', { n: name })
      : ''
  return (
    <div className="ue:relative ue:flex ue:h-10 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4">
      <Zap className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text" />
      <input
        ref={ref}
        value={line}
        spellCheck={false}
        aria-label={t('快速执行')}
        placeholder={t('快速执行：输入 GM、宏或控制台命令和参数，回车执行')}
        onChange={(e) => {
          setLine(e.target.value)
          setHi(0)
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 120)}
        onKeyDown={(e) => {
          if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
          } else if (e.key === 'Tab' && list.length) {
            e.preventDefault()
            pick(list[hi])
          } else if (e.key === 'Enter') {
            e.preventDefault()
            // 补全开着、选中的不是已经写全的名字：先补全
            if (list.length && list[hi].name.toLowerCase() !== name.toLowerCase()) pick(list[hi])
            else submit()
          } else if (e.key === 'Escape') setLine('')
        }}
        className="ue:h-7 ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none ue:placeholder:font-sans ue:placeholder:text-subtle"
      />
      <span className="ue:max-w-[45%] ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={canRun || hint}>
        {canRun || hint}
      </span>
      <button
        type="button"
        title={t('收起')}
        onClick={() => onOpen(false)}
        className="ue:grid ue:shrink-0 ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
      >
        <ChevronUp className="ue:h-3.5 ue:w-3.5" />
      </button>
      {focus && list.length > 0 && (
        <div
          role="listbox"
          className="ue:absolute ue:top-full ue:right-4 ue:left-9 ue:z-20 ue:mt-1 ue:overflow-hidden ue:rounded-(--c-menu-radius) ue:border ue:border-line ue:bg-card ue:py-1 ue:shadow-lg"
        >
          {list.map((x, i) => (
            <button
              key={`${x.kind}:${x.name}`}
              type="button"
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(x)
              }}
              onMouseEnter={() => setHi(i)}
              className={cn(
                'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:text-left ue:text-footnote',
                i === hi ? 'ue:bg-sel' : '',
              )}
            >
              <span className="ue:w-14 ue:shrink-0 ue:text-caption ue:text-subtle">{x.kind}</span>
              <span className="ue:truncate ue:font-mono ue:text-fg">{x.name}</span>
              {x.params.length > 0 && (
                <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{x.params.join(' ')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
