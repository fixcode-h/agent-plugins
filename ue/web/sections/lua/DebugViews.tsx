import { SquarePen } from 'lucide-react'
import { t } from '../../host.ts'
import { luaText } from '../../Lua.tsx'
import { Badge, Term, fmtTime, type Tone } from '../../ui.tsx'
import { shortFile, type LeakItem, type LeakKind, type OpenAt, type SnapCapture } from './debug-types.ts'

/**
 * Lua「调试」页签的结果视图（快照记录、持有的 UObject）：只吃数据不取数，
 * 页签（Debug.tsx）和设置里的组件示例（DebugSpecimen.tsx）共用
 */

/** 文件:行，点了用编辑器打开到那一行；没有完整路径（C 函数、字符串里加载的代码）时只显示文字 */
export function SrcLink({ file, src, line, onOpen }: { file?: string; src: string; line?: number; onOpen: OpenAt }) {
  const label = file ? `${shortFile(file)}${line ? `:${line}` : ''}` : src
  if (!file) return <span className="ue:font-mono ue:text-caption ue:text-subtle">{label}</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(file, line)}
      title={`${file}${line ? `:${line}` : ''} · ${t('用编辑器打开')}`}
      className="ue:inline-flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:font-mono ue:text-caption ue:text-accent-text ue:hover:underline"
    >
      <span className="ue:truncate">{label}</span>
      <SquarePen className="ue:h-3 ue:w-3 ue:shrink-0" />
    </button>
  )
}

function VarRows({ vars }: { vars: SnapCapture['locals'] }) {
  return (
    <div className="ue:divide-y ue:divide-line/60">
      {vars.map((v, i) => (
        <div key={`${v.name}-${i}`} className="ue:flex ue:gap-3 ue:px-3 ue:py-1">
          <span className="ue:w-32 ue:shrink-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={v.name}>
            {v.name}
          </span>
          <div className="ue:min-w-0 ue:flex-1">
            <div className="ue:truncate ue:font-mono ue:text-footnote ue:text-muted" title={luaText(v)}>
              {luaText(v)}
            </div>
            {!!v.fields?.length && (
              <div className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                {v.fields.map((f) => `${f.k}=${typeof f.v === 'string' ? JSON.stringify(f.v) : f.v}`).join('  ')}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 快照点的一次命中：在哪个函数哪一行、局部变量（表顺带前几项）、upvalue、调用栈 */
export function CaptureView({ cap, onOpen }: { cap: SnapCapture; onOpen: OpenAt }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:px-3">
        <span className="ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">{cap.fn}</span>
        <SrcLink file={cap.file} src={cap.src} line={cap.line} onOpen={onOpen} />
        <span className="ue:ml-auto ue:text-caption ue:text-subtle">{fmtTime(cap.at)}</span>
      </div>
      <div className="ue:px-3 ue:text-caption ue:font-medium ue:text-subtle">{t('局部变量')}</div>
      {cap.locals.length ? (
        <VarRows vars={cap.locals} />
      ) : (
        <div className="ue:px-3 ue:text-footnote ue:text-subtle">{t('没有局部变量')}</div>
      )}
      {!!cap.upvalues?.length && (
        <>
          <div className="ue:px-3 ue:text-caption ue:font-medium ue:text-subtle">upvalue</div>
          <VarRows vars={cap.upvalues} />
        </>
      )}
      <div className="ue:px-3 ue:text-caption ue:font-medium ue:text-subtle">{t('调用栈')}</div>
      <div className="ue:px-3">
        <Term className="ue:max-h-48">
          {cap.stack.map((l, i) => (
            <div key={i} className="ue:whitespace-pre-wrap">
              {l}
            </div>
          ))}
        </Term>
      </div>
    </div>
  )
}

const LEAK: Record<LeakKind, { tone: Tone; label: () => string; hint: () => string }> = {
  destroyed: {
    tone: 'danger',
    label: () => t('对象已销毁'),
    hint: () => t('Lua 还拿着这个实例表，UnLua 的对象表里已经没有它（对象多半已经销毁）'),
  },
  stale: {
    tone: 'danger',
    label: () => t('对象已不在'),
    hint: () => t('UnLua 的对象表里还有这一项，UObject 已经不在了'),
  },
  garbage: { tone: 'warn', label: () => t('已标记销毁'), hint: () => t('UObject 已标记销毁，还在 UnLua 的对象表里') },
  noworld: { tone: 'warn', label: () => t('世界已关'), hint: () => t('Actor、组件或控件所在的世界已经关了') },
}

/** 持有的已销毁 UObject：种类、模块、Lua 里从哪拿着它（照这条路径去把引用清掉） */
export function LeakList({ items }: { items: LeakItem[] }) {
  return (
    <div className="ue:divide-y ue:divide-line/60">
      {items.map((x, i) => {
        const k = LEAK[x.kind] ?? LEAK.destroyed
        return (
          <div key={i} className="ue:flex ue:items-start ue:gap-3 ue:px-3 ue:py-2 ue:hover:bg-hover">
            <Badge tone={k.tone} title={k.hint()}>
              {k.label()}
            </Badge>
            <div className="ue:min-w-0 ue:flex-1">
              <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
                <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                  {x.module || x.class || t('（没认出模块）')}
                </span>
                {x.object && (
                  <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={x.object}>
                    {x.object}
                  </span>
                )}
              </div>
              <div className="ue:truncate ue:font-mono ue:text-caption ue:text-muted" title={x.path}>
                {x.path ? `${t('拿着它的')}：${x.path}` : t('只有 UnLua 的对象表拿着它')}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
