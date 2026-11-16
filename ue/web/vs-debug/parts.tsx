import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { VsBreakpoint, VsDebugStatus } from '../../server/types.ts'
import { h, t } from '../host.ts'
import { PathText } from '../path-text.tsx'
import { Badge, LinkBtn } from '../ui.tsx'
import { bpLabel, CONFIGS, paramsSummary, type LaunchParams } from './model.ts'

/** VS 调试卡片里的几块：启动参数、停下的位置和调用栈、断点列表 */

/**
 * 启动参数（协议 start 的 map / game / args / configuration）：平时收起只显示一行摘要，
 * 每次 F5 都要改的人不多，展开占地方
 */
export function LaunchParamsForm({
  value,
  onChange,
  current,
  disabled,
}: {
  value: LaunchParams
  onChange: (p: LaunchParams) => void
  /** VS 当前的配置（status.configuration），下拉里「当前配置」后面带上 */
  current?: string
  disabled?: boolean
}) {
  const { ui } = h()
  const [open, setOpen] = useState(false)
  const sum = paramsSummary(value)
  const set = <K extends keyof LaunchParams>(k: K, v: LaunchParams[K]) => onChange({ ...value, [k]: v })
  // 记住的配置不在常用列表里（以前手填过、或 VS 当前的）也要能选回来
  const names = [...new Set([...CONFIGS, value.configuration].filter(Boolean))]
  const options = [
    { value: '', label: current ? t('当前配置（{c}）', { c: current.split('|')[0] }) : t('当前配置') },
    ...names.map((c) => ({ value: c, label: c })),
  ]
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ue:flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-left ue:text-footnote ue:text-muted ue:hover:text-fg"
      >
        {open ? <ChevronDown className="ue:h-3.5 ue:w-3.5" /> : <ChevronRight className="ue:h-3.5 ue:w-3.5" />}
        <span className="ue:shrink-0">{t('启动参数')}</span>
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
          {sum || t('默认（照 VS 里的设置）')}
        </span>
      </button>
      {open && (
        <div className="ue:grid ue:gap-2 ue:pl-4.5 ue:sm:grid-cols-2">
          <ui.Field label={t('地图')}>
            <ui.Input
              size="sm"
              value={value.map}
              disabled={disabled}
              placeholder="/Game/Maps/Test"
              onChange={(e: { target: { value: string } }) => set('map', e.target.value)}
            />
          </ui.Field>
          <ui.Field label={t('配置')}>
            <ui.Select
              size="sm"
              value={value.configuration}
              disabled={disabled}
              options={options}
              onChange={(e: { target: { value: string } }) => set('configuration', e.target.value)}
            />
          </ui.Field>
          <ui.Field label={t('额外参数')} className="ue:sm:col-span-2">
            <ui.Input
              size="sm"
              value={value.args}
              disabled={disabled}
              placeholder="-log -windowed ResX=1280 ResY=720"
              onChange={(e: { target: { value: string } }) => set('args', e.target.value)}
            />
          </ui.Field>
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-muted ue:sm:col-span-2">
            <input
              type="checkbox"
              checked={value.game}
              disabled={disabled}
              onChange={(e) => set('game', e.target.checked)}
              className="ue:accent-accent"
            />
            {t('独立游戏（-game）')}
          </label>
          <p className="ue:text-caption ue:text-subtle ue:sm:col-span-2">
            {t('只对这一次启动生效：UEToVS 临时改启动项目的命令参数，进程起来后马上改回去')}
          </p>
        </div>
      )}
    </div>
  )
}

/** 停在断点时：位置（函数、文件:行，点路径复制）和前 5 帧调用栈 */
export function StopInfo({ status }: { status: VsDebugStatus }) {
  const loc = status.location
  const frames = (status.stack ?? []).slice(0, 5)
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-lg ue:bg-hover ue:px-3 ue:py-2">
      {loc && (
        <div className="ue:flex ue:min-w-0 ue:flex-col">
          <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={loc.function}>
            {loc.function}
          </span>
          {loc.file && (
            <PathText
              path={loc.line ? `${loc.file}:${loc.line}` : loc.file}
              tail={1}
              className="ue:text-caption ue:text-muted"
            />
          )}
        </div>
      )}
      {(status.thread || status.breakpoint) && (
        <div className="ue:flex ue:flex-wrap ue:gap-x-2 ue:text-caption ue:text-subtle">
          {status.thread && <span>{t('线程 {name}', { name: status.thread.name || String(status.thread.id) })}</span>}
          {status.breakpoint && <span>{t('命中 {bp}', { bp: status.breakpoint })}</span>}
        </div>
      )}
      {frames.length > 0 && (
        <ol className="ue:flex ue:flex-col ue:border-t ue:border-line ue:pt-1.5" aria-label={t('调用栈')}>
          {frames.map((f, n) => (
            <li
              key={n}
              className="ue:flex ue:min-w-0 ue:items-baseline ue:gap-2 ue:font-mono ue:text-caption"
              title={[f.function, f.file && `${f.file}:${f.line ?? ''}`, f.module].filter(Boolean).join('\n')}
            >
              <span className="ue:w-4 ue:shrink-0 ue:text-right ue:text-subtle">{f.i ?? n}</span>
              <span className={h().cn('ue:min-w-0 ue:flex-1 ue:truncate', n === 0 ? 'ue:text-fg' : 'ue:text-muted')}>
                {f.function}
              </span>
              {f.file && (
                <span className="ue:shrink-0 ue:text-subtle">
                  {(f.file.replace(/\\/g, '/').split('/').pop() ?? '') + (f.line ? `:${f.line}` : '')}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * 断点列表（bp.list 前 50 个，包括用户在 VS 里自己下的）：勾选启用 / 禁用，删除按编号；
 * Agent 下的带小标记，「清掉 Agent 下的」只删这些（bp.clear 默认 scope = agent），用户自己的不动
 */
export function BreakpointList({
  items,
  total,
  debugging,
  disabled,
  onToggle,
  onRemove,
  onClearAgent,
}: {
  items: VsBreakpoint[]
  /** status.breakpoints：总个数，列表只带前 50 个 */
  total?: number
  /** 在调试时才看「没绑定」：没在调试时断点本来就没绑定 */
  debugging: boolean
  disabled?: boolean
  onToggle: (b: VsBreakpoint) => void
  onRemove: (b: VsBreakpoint) => void
  onClearAgent: () => void
}) {
  const { ui } = h()
  const agent = items.filter((b) => b.byAgent).length
  const more = (total ?? items.length) - items.length
  return (
    <div className="ue:flex ue:flex-col">
      <div className="ue:flex ue:items-center ue:gap-2 ue:pb-1 ue:text-caption ue:text-subtle">
        {t('断点 {n}', { n: total ?? items.length })}
        {agent > 0 && (
          <span className="ue:ml-auto">
            <LinkBtn disabled={disabled} onClick={onClearAgent}>
              {t('清掉 Agent 下的（{n}）', { n: agent })}
            </LinkBtn>
          </span>
        )}
      </div>
      {items.length ? (
        <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:rounded-lg ue:border ue:border-line">
          {items.map((b) => (
            <li key={b.i} className="ue:group ue:flex ue:min-w-0 ue:items-start ue:gap-2 ue:px-2.5 ue:py-1.5">
              <input
                type="checkbox"
                aria-label={t('启用断点 {bp}', { bp: bpLabel(b) })}
                checked={b.enabled}
                disabled={disabled}
                onChange={() => onToggle(b)}
                className="ue:mt-0.5 ue:accent-accent"
              />
              <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-0.5">
                <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
                  <span
                    title={b.file ? `${b.file}:${b.line ?? ''}` : b.function}
                    className={h().cn(
                      'ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote',
                      b.enabled ? 'ue:text-fg' : 'ue:text-subtle ue:line-through',
                    )}
                  >
                    {bpLabel(b)}
                  </span>
                  {b.byAgent && (
                    <Badge tone="accent" title={t('Agent 下的断点')}>
                      Agent
                    </Badge>
                  )}
                  {debugging && b.enabled && b.bound === 0 && (
                    <Badge tone="warn" title={t('符号没加载或这一行没有代码，命中不了')}>
                      {t('没绑定')}
                    </Badge>
                  )}
                  {!!b.hits && (
                    <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('命中 {n}', { n: b.hits })}</span>
                  )}
                </div>
                {(b.condition || b.hitCount || b.message) && (
                  <div className="ue:flex ue:min-w-0 ue:flex-wrap ue:gap-x-2 ue:font-mono ue:text-caption ue:text-muted">
                    {b.condition && <span className="ue:truncate">{t('条件 {c}', { c: b.condition })}</span>}
                    {!!b.hitCount && <span>{t('第 {n} 次才停', { n: b.hitCount })}</span>}
                    {b.message && <span className="ue:truncate">{t('日志 {m}', { m: b.message })}</span>}
                  </div>
                )}
              </div>
              <ui.IconButton
                icon={Trash2}
                size="2xs"
                tone="danger"
                reveal="hover"
                label={t('删除断点')}
                disabled={disabled}
                onClick={() => onRemove(b)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ue:text-caption ue:text-subtle">{t('没有断点：在 VS 里下，或让 Agent 下')}</p>
      )}
      {more > 0 && (
        <p className="ue:pt-1 ue:text-caption ue:text-subtle">
          {t('还有 {n} 个没列出，到 VS 的断点窗口看', { n: more })}
        </p>
      )}
    </div>
  )
}
