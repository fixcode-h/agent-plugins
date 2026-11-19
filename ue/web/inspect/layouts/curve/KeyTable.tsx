import { Diamond } from 'lucide-react'
import { t } from '../../../host.ts'
import { Card } from '../../../ui.tsx'
import { EntryTable, type EntryCol } from '../shell/EntryTable.tsx'
import { keyId, type Curve, type CurveKey } from './model.ts'

interface Row {
  c: Curve
  k: CurveKey
  i: number
}

/** 关键帧表（效果图 B9 下方）：时间、值、插值、切线模式、到达 / 离开切线；多条曲线时多一列曲线名。点一行和图上选中联动 */
export function KeyTable({
  curves,
  picked,
  onPick,
}: {
  curves: Curve[]
  picked?: string
  onPick: (id: string) => void
}) {
  const rows: Row[] = curves.flatMap((c) => c.keys.map((k, i) => ({ c, k, i })))
  const n3 = (v: number) => v.toFixed(3)
  const cols: EntryCol<Row>[] = [
    ...(curves.length > 1 ? [{ key: 'curve', head: t('曲线'), cell: (r: Row) => r.c.label }] : []),
    { key: 'time', head: 'Time', num: true, mono: true, cell: (r) => n3(r.k.time) },
    { key: 'value', head: 'Value', num: true, mono: true, cell: (r) => n3(r.k.value) },
    { key: 'interp', head: 'Interp', cell: (r) => r.k.interp[0].toUpperCase() + r.k.interp.slice(1) },
    { key: 'tm', head: 'Tangent Mode', cell: (r) => r.k.tangentMode },
    { key: 'arrive', head: 'Arrive', num: true, mono: true, cell: (r) => r.k.arrive.toFixed(2) },
    { key: 'leave', head: 'Leave', num: true, mono: true, cell: (r) => r.k.leave.toFixed(2) },
  ]
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <Diamond className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('关键帧')}
        </>
      }
      aside={<span>{t('{n} 个', { n: rows.length })}</span>}
      bodyClass="ue:overflow-auto"
    >
      <EntryTable
        rows={rows}
        cols={cols}
        rowKey={(r) => keyId(r.c.id, r.i)}
        index={(r) => r.i}
        selected={picked}
        onSelect={onPick}
        empty={t('没有关键帧')}
      />
    </Card>
  )
}
