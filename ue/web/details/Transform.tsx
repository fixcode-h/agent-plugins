import { useState } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { t } from '../host.ts'
import { useDetailsApi } from './api.ts'
import { Collapse } from './controls.tsx'
import { keep, remember, type Prop } from './model.ts'
import { CategoryBar, DetailsCtx, Row, nodeOf } from './rows.tsx'

const LABELS: Record<string, () => string> = {
  RelativeLocation: () => t('位置'),
  RelativeRotation: () => t('旋转'),
  RelativeScale3D: () => t('缩放'),
}

/**
 * Actor 细节面板最上面的「变换」（UE 也是这样）：位置、旋转、缩放其实是根组件的 RelativeLocation 等，
 * 这里读根组件、改也改根组件（走同一套改值、重置）
 */
export function Transform({
  root,
  q,
  openRef,
}: {
  root: string
  q: string
  openRef: (p: string) => (() => void) | undefined
}) {
  const { project, target } = useUe()
  const [open, setOpen] = useState(() => remember('open:transform', true))
  const data = useLoad(
    () => op<{ props: Prop[] }>(project.id, 'props', { path: root, filter: 'Relative', maxChars: 400 }, target),
    [root, target.instance, target.world],
  )
  const api = useDetailsApi(root, { q: '', reload: () => void data.reload(), openRef })
  const rows = (data.data?.props ?? [])
    .filter((p) => LABELS[p.name])
    .map((p) => ({ ...nodeOf(p), label: LABELS[p.name]() }))
    .filter(
      (n) => !q || n.label.toLowerCase().includes(q.toLowerCase()) || n.path.toLowerCase().includes(q.toLowerCase()),
    )
  if (!rows.length) return null
  return (
    <DetailsCtx.Provider value={api}>
      <section>
        <CategoryBar
          title={t('变换')}
          open={open || !!q}
          q=""
          onToggle={() => {
            keep('open:transform', !open)
            setOpen(!open)
          }}
        />
        <Collapse open={open || !!q}>
          {rows.map((n) => (
            <Row key={n.key} n={n} />
          ))}
        </Collapse>
      </section>
    </DetailsCtx.Provider>
  )
}
