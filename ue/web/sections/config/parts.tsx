import type { IniEntry } from '../../../server/editor-tools/config-layers.ts'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'

/**
 * 配置页的一行键（配置页和设置 →「组件」的示例共用）：最终值、最后定它的那一层、进程里不一样时标黄，
 * 下面逐层列出写法（+ 追加、- 删一个、! 清空），一眼看出「这个值从哪来」。
 */
export interface KeyView {
  key: string
  values: string[]
  last: string
  live?: string[]
  differs?: boolean
  layers: { label: string; file: string; entries: IniEntry[] }[]
}

/** ini 行前缀的意思（悬停提示） */
function opHint(op: string) {
  if (op === '+') return t('追加（不重复）')
  if (op === '.') return t('追加')
  if (op === '-') return t('删掉这个值')
  if (op === '!') return t('清空')
  return ''
}

export function KeyRow({ row }: { row: KeyView }) {
  const { cn } = h()
  const value = row.values.length > 1 ? row.values.join(' · ') : (row.values[0] ?? '')
  return (
    <li className="ue:flex ue:flex-col ue:gap-1 ue:px-4 ue:py-2">
      <div className="ue:flex ue:flex-wrap ue:items-baseline ue:gap-x-3 ue:gap-y-1">
        <span className="ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">{row.key}</span>
        <span
          className={cn(
            'ue:min-w-0 ue:font-mono ue:text-footnote ue:break-all',
            row.values.length ? 'ue:text-accent-text' : 'ue:text-subtle',
          )}
        >
          {row.layers.length ? value || t('（空）') : t('（磁盘上各层都没写）')}
        </span>
        {row.last && <Badge title={t('最后改它的那一层')}>{row.last}</Badge>}
        {row.differs && (
          <Badge tone="warn" title={t('插件的 Config、命令行或运行中改过')}>
            {t('进程里：{v}', { v: (row.live ?? []).join(' · ') || t('（没有）') })}
          </Badge>
        )}
      </div>
      {row.layers.length > 0 && (
        <ul className="ue:flex ue:flex-col ue:gap-0.5">
          {row.layers.map((l) => (
            <li key={l.label} className="ue:flex ue:items-baseline ue:gap-2 ue:text-caption">
              <span className="ue:w-40 ue:shrink-0 ue:truncate ue:text-subtle" title={l.file}>
                {l.label}
              </span>
              <span className="ue:min-w-0 ue:font-mono ue:break-all ue:text-muted">
                {l.entries.map((e, i) => (
                  <span key={i} title={`${l.file}:${e.line}${e.op ? ` · ${opHint(e.op)}` : ''}`}>
                    {i > 0 && '  '}
                    {e.op}
                    {e.key}={e.value}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** 设置 →「组件」里的示例 */
export function ConfigKeySpecimen() {
  const f = 'Config/DefaultEngine.ini'
  const rows: KeyView[] = [
    {
      key: 'r.Shadow.MaxResolution',
      values: ['2048'],
      last: t('项目 {name}', { name: 'DefaultEngine' }),
      layers: [
        { label: t('引擎 {name}', { name: 'BaseEngine' }), file: 'BaseEngine.ini', entries: [{ op: '', key: 'r.Shadow.MaxResolution', value: '1024', line: 12 }] },
        { label: t('项目 {name}', { name: 'DefaultEngine' }), file: f, entries: [{ op: '', key: 'r.Shadow.MaxResolution', value: '2048', line: 3 }] },
      ],
    },
    {
      key: 'Paths',
      values: ['/Game/A'],
      last: t('项目 {name}', { name: 'DefaultEngine' }),
      live: ['/Game/A', '/Plugin/B'],
      differs: true,
      layers: [{ label: t('项目 {name}', { name: 'DefaultEngine' }), file: f, entries: [{ op: '+', key: 'Paths', value: '/Game/A', line: 8 }] }],
    },
  ]
  return (
    <ul className="ue:max-w-2xl ue:divide-y ue:divide-line ue:rounded-lg ue:border ue:border-line">
      {rows.map((r) => (
        <KeyRow key={r.key} row={r} />
      ))}
    </ul>
  )
}
