import { Fragment } from 'react'
import { useUe } from '../ctx.tsx'
import { t } from '../host.ts'
import { setPending } from '../pending.ts'

export interface Line {
  seq: number
  category: string
  verbosity: string
  text: string
  /** 钟表时间（毫秒）：服务端按桥接的 now 换算，或从日志文件的时间戳解析；旧桥接没有 */
  at?: number
  /** 网页收到这行的时间：没有 at 时退回用它 */
  rx?: number
  /** PIE 开始 / 结束的分隔行（网页自己插的，不是日志） */
  mark?: boolean
}

/** 连续重复的行折成一行 ×N（刷屏的 Warning 一屏全是同一句时最难看） */
export interface Row extends Line {
  count: number
  /** 这一组里所有行的 seq：选中、复制按组算 */
  seqs: number[]
}

export function collapse(lines: Line[]): Row[] {
  const out: Row[] = []
  for (const l of lines) {
    const p = out[out.length - 1]
    if (p && !l.mark && !p.mark && p.text === l.text && p.category === l.category && p.verbosity === l.verbosity) {
      p.count++
      p.seqs.push(l.seq)
    } else out.push({ ...l, count: 1, seqs: [l.seq] })
  }
  return out
}

export function clock(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const lineText = (l: Line) => `${l.category}: ${l.verbosity !== 'Log' ? `${l.verbosity}: ` : ''}${l.text}`

const PATH = /(\/(?:Game|Engine|Script|Temp)\/[^\s'"(),;]+)/g
const isObject = (p: string) => /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/.test(p)

/**
 * 选中行的详情条（界面优化第 12 条）：整行完整显示（列表里一行只画得下开头），
 * 里面的 /Game 路径点了去资源、对象路径点了去运行时对象
 */
export function LineDetail({ line }: { line: Row }) {
  const { go } = useUe()
  const parts = line.text.split(PATH)
  return (
    <div className="ue:flex ue:flex-col ue:gap-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-2.5">
      <div className="ue:flex ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
        <span className="ue:font-mono">{clock(line.at ?? line.rx)}</span>
        <span className="ue:font-mono">{line.category}</span>
        <span>{line.verbosity}</span>
        {line.count > 1 && <span>{t('连续 {n} 次', { n: line.count })}</span>}
      </div>
      <div className="ue:max-h-32 ue:overflow-auto ue:font-mono ue:text-footnote ue:break-all ue:whitespace-pre-wrap ue:text-fg">
        {parts.map((p, i) =>
          i % 2 ? (
            <button
              key={i}
              type="button"
              title={isObject(p) ? t('在 Object 页里打开') : t('在资源里搜这个位置')}
              onClick={() => {
                if (isObject(p)) go('objects', p)
                else {
                  setPending('assets', p)
                  go('assets')
                }
              }}
              className="ue:cursor-pointer ue:text-accent-text ue:hover:underline"
            >
              {p}
            </button>
          ) : (
            <Fragment key={i}>{p}</Fragment>
          ),
        )}
      </div>
    </div>
  )
}
