import { Box, Cpu, Database, Search, SquareTerminal, Wand2, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GmStore } from '../server/types.ts'
import { pget } from './api.ts'
import { useToChat } from './chat.tsx'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { setPending } from './pending.ts'
import { stageNav } from './inspect/history.ts'
import { JumpFoot, JumpGroup, JumpRow } from './jump/parts.tsx'
import { matchLocal, type LocalHit } from './jump/local.ts'
import { useTargetInfo } from './ui.tsx'

interface Opt {
  key?: string
  icon: LucideIcon
  label: string
  detail?: string
  hint?: string
  /** Ctrl+回车 发给对话的文字；没有就发输入框里的原文 */
  chat?: string
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
 * Ctrl+K / 双击 Shift 跳转（设计稿「界面优化」第 17 条，designs/UE插件优化与扩展-设计稿.md 三.2）：贴什么都认 ——
 * 磁盘上 Content 里的路径、/Game 路径、对象路径、Actor 名字开头、> 开头的控制台命令。分两组：
 * 「去别的页搜」只根据输入的样子列出能去的地方，回车才到那一页去搜；「本页已有的列表里匹配」只筛网页里已经有的列表
 * （GM、控制台收藏，Lua 页挂进来的 Lua GM、Lua 模块）。两组打字时都不发请求（用户 2026-11-10 定的「搜索点按钮才搜」，怕拖慢 UE）
 */
export function Jump({ onClose }: { onClose: () => void }) {
  const { go, project } = useUe()
  const { inst } = useTargetInfo()
  const { ui, toast } = h()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [store, setStore] = useState<GmStore>()
  const chat = useToChat()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  // 控制台收藏存在本机文件里（不经过 UE），打开弹窗时读一次
  useEffect(() => {
    void pget<GmStore>(project.id, 'gm')
      .then(setStore)
      .catch(() => undefined)
  }, [project.id])

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
      label: t('在对象页里打开'),
      run: () => {
        // 进对象页、资源页共用的导航历史，「最近看过」里写「从 Ctrl+K」
        stageNav(project.id, 'objects', s, { from: 'jump' })
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
  const local: LocalHit[] = s.startsWith('>')
    ? []
    : matchLocal(s, {
        pid: inst?.pid,
        store,
        go: (section, sub) => {
          go(section, sub)
          onClose()
        },
      })
  const all: Opt[] = [...opts, ...local]
  const cur = Math.min(sel, Math.max(0, all.length - 1))
  const send = (o: Opt | undefined) => {
    const text = o?.chat ?? s
    if (text) chat.send(text)
  }

  // 选了发给哪个对话之前先只显示那个小窗：两层弹窗叠着，Esc 会先关掉跳转
  if (chat.dialog) return <>{chat.dialog}</>

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
              if (e.key === 'ArrowDown') setSel((n) => Math.min(n + 1, all.length - 1))
              else if (e.key === 'ArrowUp') setSel((n) => Math.max(n - 1, 0))
              else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                if (chat.available) send(all[cur])
              } else if (e.key === 'Enter') all[cur]?.run()
              else return
              e.preventDefault()
            }}
            aria-label={t('跳转')}
            placeholder={t('贴路径、对象名、Actor 名字开头，或 > 控制台命令')}
            className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-body ue:text-fg ue:outline-none ue:placeholder:font-sans ue:placeholder:text-subtle"
          />
        </label>
        {kind && <div className="ue:px-1 ue:text-caption ue:text-subtle">{t('认出是：{k}', { k: kind })}</div>}
        {opts.length > 0 && (
          <JumpGroup title={t('去别的页搜（回车才搜，打字不发请求）')}>
            {opts.map((o, i) => (
              <JumpRow key={o.key ?? o.label} opt={o} on={i === cur} onHover={() => setSel(i)} />
            ))}
          </JumpGroup>
        )}
        {local.length > 0 && (
          <JumpGroup title={t('本页已有的列表里匹配')}>
            {local.map((o, i) => (
              <JumpRow
                key={o.key}
                opt={o}
                on={opts.length + i === cur}
                onHover={() => setSel(opts.length + i)}
              />
            ))}
          </JumpGroup>
        )}
        {!s && (
          <ul className="ue:flex ue:flex-col ue:gap-1 ue:px-1 ue:text-footnote ue:text-subtle">
            <li>{t('{p} 或 /Game/Data/DT_Items → 资源', { p: 'D:\\Proj\\Content\\Data\\DT_Items.uasset' })}</li>
            <li>{t('…:PersistentLevel.BP_Hero_C_1 → Object')}</li>
            <li>{t('BP_Hero → Actor、按类找对象、资源、GM 任选')}</li>
            <li>{t('> stat unit → 控制台')}</li>
          </ul>
        )}
        <JumpFoot chat={chat.available} />
      </div>
    </ui.Modal>
  )
}
