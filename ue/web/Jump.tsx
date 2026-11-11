import { Box, Cpu, Database, Search, SquareTerminal, Wand2, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { setPending } from './pending.ts'

interface Opt {
  icon: LucideIcon
  label: string
  hint?: string
  run: () => void
}

/** 引用格式 Blueprint'/Game/A/B.B_C' 去掉外壳；两头的引号去掉 */
function unwrap(s: string) {
  const m = /^\w+'(.+)'$/.exec(s)
  return (m ? m[1] : s).replace(/^["']|["']$/g, '')
}

const isDisk = (s: string) => /^[a-z]:[\\/]/i.test(s) || s.startsWith('\\\\') || s.includes('\\')
const isObjectPath = (s: string) => /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/i.test(s)

/**
 * Ctrl+K 跳转（设计稿「界面优化」第 17 条）：贴什么都认 —— 磁盘上 Content 里的路径、/Game 路径、对象路径、
 * Actor 名字开头、> 开头的控制台命令。只根据输入的样子列出能去的地方，打字时不发请求，回车才到那一页去搜
 * （用户 2026-11-10 定的「搜索点按钮才搜」，怕拖慢 UE）
 */
export function Jump({ onClose }: { onClose: () => void }) {
  const { go } = useUe()
  const { ui, cn, toast } = h()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const to = (section: string, text: string, sub?: string) => () => {
    setPending(section, text)
    go(section, sub)
    onClose()
  }
  const s = unwrap(q.trim())
  const opts: Opt[] = []
  let kind = ''
  if (s.startsWith('>')) {
    const cmd = s.slice(1).trim()
    kind = t('控制台命令')
    opts.push({
      icon: SquareTerminal,
      label: t('到控制台执行 {c}', { c: cmd }),
      hint: t('回车后还要再按一次回车'),
      run: to('console', cmd),
    })
  } else if (s && isObjectPath(s)) {
    kind = t('关卡里的对象路径')
    opts.push({
      icon: Cpu,
      label: t('在 Object 页里打开'),
      run: () => {
        go('objects', s)
        onClose()
      },
    })
  } else if (s && (isDisk(s) || s.startsWith('/'))) {
    kind = isDisk(s) ? t('磁盘上的路径') : t('UE 资源路径')
    opts.push({
      icon: Database,
      label: t('在资源里搜这个位置'),
      hint: t('磁盘路径会换成 /Game 路径'),
      run: to('assets', s),
    })
    if (s.startsWith('/'))
      opts.push({
        icon: Search,
        label: t('复制 UE 路径'),
        run: () =>
          void navigator.clipboard.writeText(s).then(() => {
            toast.success(t('已复制'))
            onClose()
          }),
      })
  } else if (s) {
    opts.push(
      { icon: Box, label: t('找名字以 {q} 开头的 Actor', { q: s }), run: to('objects', `Actor::${s}`) },
      { icon: Cpu, label: t('找类是 {q} 的对象', { q: s }), run: to('objects', `${s}::`) },
      { icon: Database, label: t('找名字以 {q} 开头的资源', { q: s }), run: to('assets', s) },
      { icon: Wand2, label: t('找名字以 {q} 开头的 GM', { q: s }), run: to('gm', s) },
      { icon: SquareTerminal, label: t('到控制台执行 {c}', { c: s }), run: to('console', s) },
    )
  }
  const cur = Math.min(sel, Math.max(0, opts.length - 1))

  return (
    <ui.Modal open onOpenChange={(o: boolean) => !o && onClose()} title={t('跳转')} size="md">
      <div className="ue:flex ue:flex-col ue:gap-2">
        <label className="ue:flex ue:h-10 ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-line-strong ue:bg-field ue:px-3 ue:focus-within:border-focus">
          <Search className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-subtle" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setSel((n) => Math.min(n + 1, opts.length - 1))
              else if (e.key === 'ArrowUp') setSel((n) => Math.max(n - 1, 0))
              else if (e.key === 'Enter') opts[cur]?.run()
              else return
              e.preventDefault()
            }}
            aria-label={t('跳转')}
            placeholder={t('贴路径、对象名、Actor 名字开头，或 > 控制台命令')}
            className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-body ue:text-fg ue:outline-none ue:placeholder:font-sans ue:placeholder:text-subtle"
          />
        </label>
        {kind && <div className="ue:px-1 ue:text-caption ue:text-subtle">{t('认出是：{k}', { k: kind })}</div>}
        <ul className="ue:flex ue:flex-col ue:gap-0.5">
          {opts.map((o, i) => (
            <li key={o.label}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={o.run}
                className={cn(
                  'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:px-3 ue:py-2 ue:text-left ue:text-body ue:text-fg',
                  i === cur && 'ue:bg-sel',
                )}
              >
                <o.icon className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-subtle" />
                <span className="ue:min-w-0 ue:truncate">{o.label}</span>
                {o.hint && <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        {!s && (
          <ul className="ue:flex ue:flex-col ue:gap-1 ue:px-1 ue:text-footnote ue:text-subtle">
            <li>{t('{p} 或 /Game/Data/DT_Items → 资源', { p: 'D:\\Proj\\Content\\Data\\DT_Items.uasset' })}</li>
            <li>{t('…:PersistentLevel.BP_Hero_C_1 → Object')}</li>
            <li>{t('BP_Hero → Actor、按类找对象、资源、GM 任选')}</li>
            <li>{t('> stat unit → 控制台')}</li>
          </ul>
        )}
        <div className="ue:flex ue:items-center ue:gap-2 ue:border-t ue:border-line ue:pt-2 ue:text-caption ue:text-subtle">
          {t('↑↓ 选择 · 回车打开 · Esc 关闭 · 打字时不查，回车才到那一页去搜')}
        </div>
      </div>
    </ui.Modal>
  )
}
