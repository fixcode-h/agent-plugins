import { ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { Card, ErrorText, LinkBtn } from '../../ui.tsx'
import { nameOf, type Capture } from './types.ts'

const TH = 'ue:px-3 ue:py-1.5 ue:text-left ue:text-caption ue:font-medium ue:text-subtle'
const TD = 'ue:px-3 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-fg'
const NUM = `${TD} ue:text-right ue:tabular-nums`

/** 简单的表：第一列左对齐，其余右对齐；变化列里涨了的标红（内存、耗时都是涨了不好） */
export function Rows({
  columns,
  rows,
  delta = [],
}: {
  columns: string[]
  rows: (string | number)[][]
  delta?: number[]
}) {
  return (
    <table className="ue:w-full ue:border-collapse">
      <thead>
        <tr className="ue:border-b ue:border-line">
          {columns.map((c, i) => (
            <th key={c} className={i ? `${TH} ue:text-right` : TH}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => (
          <tr key={`${r[0]}-${k}`} className="ue:border-b ue:border-line/60">
            {columns.map((c, i) => (
              <td
                key={c}
                className={
                  i
                    ? `${NUM} ${delta.includes(i) && String(r[i]).startsWith('+') ? 'ue:text-danger' : ''}`
                    : `${TD} ue:max-w-0 ue:w-full ue:truncate`
                }
                title={i ? undefined : String(r[i])}
              >
                {r[i]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface CsvDiff {
  hitches: { a: number; b: number; thresholdMs: number }
  key: { column: string; a: number; b: number; delta: number; pct: number | null }[]
  changed: { column: string; a: number; b: number; delta: number; pct: number | null }[]
}
interface MemDiff {
  totals: { countDelta: number; kbDelta: number; resKbDelta: number }
  byCount: { class: string; countA: number; countB: number; countDelta: number; kbDelta: number; resKbDelta: number }[]
}

export const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

/** 两份同类抓取的对比：先抓的当「之前」 */
export function Compare({ a, b, onClose }: { a: string; b: string; onClose?: () => void }) {
  const { project } = useUe()
  const r = useLoad(
    () =>
      ppost<{ a: Capture; b: Capture; diff: CsvDiff | MemDiff }>(project.id, 'perf/compare', { id: a, other: b }).then(
        async (x) =>
          // 列表里新的在前，勾选顺序不一定是时间顺序：按时间摆，先抓的当 A
          x.a.at <= x.b.at ? x : ppost<typeof x>(project.id, 'perf/compare', { id: b, other: a }),
      ),
    [project.id, a, b],
  )
  const d = r.data
  return (
    <Card
      title={d ? t('对比：{a} → {b}', { a: nameOf(d.a), b: nameOf(d.b) }) : t('对比')}
      aside={onClose && <LinkBtn onClick={onClose}>{t('关闭')}</LinkBtn>}
    >
      <div className="ue:flex ue:flex-col ue:gap-3 ue:py-3">
        <ErrorText>{r.error}</ErrorText>
        {!d && !r.error && <div className="ue:px-4 ue:text-footnote ue:text-subtle">{t('正在读文件…')}</div>}
        {d && 'hitches' in d.diff && (
          <>
            <div className="ue:px-4 ue:text-footnote ue:text-subtle">
              {t('卡顿帧：{a} → {b}（门槛 {ms} 毫秒）', {
                a: d.diff.hitches.a,
                b: d.diff.hitches.b,
                ms: d.diff.hitches.thresholdMs,
              })}
            </div>
            <Rows
              columns={[t('指标'), t('之前'), t('之后'), t('变化'), '%']}
              delta={[3, 4]}
              rows={[...d.diff.key, ...d.diff.changed.slice(0, 15)].map((x) => [
                x.column,
                x.a,
                x.b,
                sign(x.delta),
                x.pct === null ? '' : sign(x.pct),
              ])}
            />
          </>
        )}
        {d && 'byCount' in d.diff && (
          <>
            <div className="ue:px-4 ue:text-footnote ue:text-subtle">
              {t('对象总数 {n}，对象大小 {kb} KB，持有的资源 {res} KB', {
                n: sign(d.diff.totals.countDelta),
                kb: sign(d.diff.totals.kbDelta),
                res: sign(d.diff.totals.resKbDelta),
              })}
            </div>
            {d.diff.byCount.length ? (
              <Rows
                columns={[t('类'), t('之前'), t('之后'), t('数量变化'), t('大小变化 KB')]}
                delta={[3, 4]}
                rows={d.diff.byCount.map((x) => [x.class, x.countA, x.countB, sign(x.countDelta), sign(x.kbDelta)])}
              />
            ) : (
              <div className="ue:px-4 ue:text-footnote ue:text-subtle">{t('两份报告里各个类的对象数量一样。')}</div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
