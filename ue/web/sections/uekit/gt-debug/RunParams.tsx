import { Play } from 'lucide-react'
import { useState } from 'react'
import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { parseScalar, scalarText } from '../gt-cond/compare.tsx'
import { useGm } from '../../gm/use-gm.ts'
import { ParamTable } from './ParamTable.tsx'

/** 上次填的值：同一个脚本再跑时接着用（每个人自己的，存浏览器） */
const LAST_KEY = 'ue.gt.lastParams'
function readLast(scenario: string): Record<string, unknown> {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, Record<string, unknown>>
    return all[scenario] ?? {}
  } catch {
    return {}
  }
}
function saveLast(scenario: string, v: Record<string, unknown>) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, unknown>
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...all, [scenario]: v }))
  } catch {
    // 存不了就下次从默认值开始
  }
}

/**
 * 运行时填参数（定稿 2.3、协议 gt.run 的 params）：脚本声明了参数时，开跑前逐个填，默认值先填好；
 * 和默认值一样的不传，UE 那边照默认值走
 */
export function RunParams({
  doc,
  scenario,
  onRun,
  onCancel,
}: {
  doc: GtScript
  scenario: string
  onRun: (params: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const { ui } = h()
  // GM 的数据（gm.json 的表格关联、表格路径换算的根）：参数关联表格时用（F3）
  const gm = useGm(0)
  const params = doc.params ?? {}
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const last = readLast(scenario)
    return Object.fromEntries(Object.entries(params).map(([k, p]) => [k, scalarText(k in last ? last[k] : p.default)]))
  })
  const submit = () => {
    const out: Record<string, unknown> = {}
    for (const [k, p] of Object.entries(params)) {
      const v = parseScalar(vals[k] ?? '')
      if (JSON.stringify(v) !== JSON.stringify(p.default ?? '')) out[k] = v
    }
    saveLast(scenario, Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, parseScalar(v)])))
    onRun(out)
  }
  return (
    <ui.Modal
      open
      size="md"
      onOpenChange={(o: boolean) => !o && onCancel()}
      title={t('运行参数')}
      description={t('这个脚本声明了参数：改了的这次运行用改的值，没改的按默认值。以 = 开头写表达式。')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onCancel}>
            {t('取消')}
          </ui.Button>
          <ui.Button onClick={submit}>
            <Play className="ue:h-3.5 ue:w-3.5" />
            {t('运行')}
          </ui.Button>
        </>
      }
    >
      <form
        className="ue:flex ue:flex-col ue:gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {Object.entries(params).map(([k, p], i) => (
          <div key={k} className="ue:grid ue:grid-cols-[140px_1fr] ue:items-center ue:gap-x-3 ue:gap-y-0.5">
            <span className="ue:flex ue:min-w-0 ue:flex-col">
              <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">${k}</span>
              {p.type && <span className="ue:text-caption ue:text-subtle">{p.type}</span>}
            </span>
            <ParamTable
              gm={gm}
              scenario={scenario}
              param={k}
              value={vals[k] ?? ''}
              onChange={(v) => setVals((cur) => ({ ...cur, [k]: v }))}
              input={
                <ui.Input
                  size="sm"
                  autoFocus={i === 0}
                  spellCheck={false}
                  className="ue:w-full ue:font-mono"
                  placeholder={scalarText(p.default) || t('空')}
                  value={vals[k] ?? ''}
                  onChange={(e: { target: { value: string } }) => setVals({ ...vals, [k]: e.target.value })}
                />
              }
            />
            {p.note && <span className="ue:col-start-2 ue:text-caption ue:text-subtle">{p.note}</span>}
          </div>
        ))}
        <button type="submit" hidden />
      </form>
    </ui.Modal>
  )
}
