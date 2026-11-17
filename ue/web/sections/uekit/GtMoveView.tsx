import { Fragment } from 'react'
import { ppost, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { meters, moveHintOf, pathOf, pointOf, viaLabel, type MovePayload, type MoveVia, type Vec3 } from './gt-move.ts'
import type { StepDef } from './GtStepDetail.tsx'

/**
 * 步骤详情里 move 步骤的一块（GameTest 1.3.0）：俯视轨迹图（录的轨迹、这次回放实际走的、起跳点、卡住的地方）、
 * 录制时和这次回放的数字，以及「回放怎么走」（写进步骤的 via）。轨迹原文很长，参数表里不再列 path / jumps / fly
 */
export function GtMoveView(o: {
  def?: StepDef
  payload?: Record<string, unknown>
  /** 给了才能改「回放怎么走」：场景文件的位置和这一步的下标 */
  edit?: { project: string; root: string; path: string; index: number; onChanged: () => void }
}) {
  const { def } = o
  const p = (o.payload ?? {}) as MovePayload
  const hint = moveHintOf(def)
  const recorded = pathOf(def?.path)
  const trail = pathOf(p.trail)
  const from = hint.from ?? recorded[0]
  const to = pointOf(def?.to) ?? pointOf(p.to)
  const jumps = Array.isArray(def?.jumps) ? (def.jumps as number[]).map((i) => recorded[i]).filter(Boolean) : []
  const stuck = pointOf(p.stuck)
  const rows: [string, string | undefined][] = [
    [t('录制时走了'), hint.distance !== undefined ? meters(hint.distance) : undefined],
    [
      t('录制用时'),
      hint.durationMs !== undefined ? t('{s} 秒', { s: (hint.durationMs / 1000).toFixed(1) }) : undefined,
    ],
    [t('录制时导航网格'), hint.nav === undefined ? undefined : hint.nav ? t('有') : t('没有')],
    [t('角色'), hint.pawn],
    [t('地图'), hint.map],
    [t('这次怎么走的'), p.used ? viaLabel(p.used) : undefined],
    [
      t('离目标'),
      p.distance !== undefined
        ? p.reached
          ? t('已到达（{d}）', { d: meters(p.distance) })
          : meters(p.distance)
        : undefined,
    ],
    [t('探路格数'), p.probeCells ? String(p.probeCells) : undefined],
  ]
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      {(recorded.length > 1 || trail.length > 1 || (from && to)) && (
        <TopDown recorded={recorded} trail={trail} from={from} to={to} jumps={jumps} stuck={stuck} />
      )}
      <dl className="ue:grid ue:grid-cols-[minmax(64px,auto)_1fr] ue:gap-x-3 ue:gap-y-1.5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <Fragment key={k}>
              <dt className="ue:text-subtle">{k}</dt>
              <dd className="ue:min-w-0 ue:break-all ue:text-fg">{v}</dd>
            </Fragment>
          ))}
      </dl>
      {!!p.tried?.length && (
        <div className="ue:flex ue:flex-col ue:gap-0.5">
          <span className="ue:text-subtle">{t('换过的走法')}</span>
          {p.tried.map((x, k) => (
            <span key={k} className="ue:text-muted">
              {viaLabel(x.via)}：{x.why}
            </span>
          ))}
        </div>
      )}
      {def && o.edit && <ViaPicker def={def} edit={o.edit} />}
    </div>
  )
}

const VIAS: MoveVia[] = ['auto', 'nav', 'path', 'probe', 'teleport']

function viaHelp(v: MoveVia) {
  switch (v) {
    case 'nav':
      return t('只用导航网格寻路，没有网格或找不到路就失败')
    case 'path':
      return t('只按录的轨迹走：从轨迹上离角色最近的地方接上，离太远先探路过去')
    case 'probe':
      return t('不用导航网格，运行时按碰撞一格一格探出路再走，适合没烘焙导航的关卡')
    case 'teleport':
      return t('直接瞬移到终点，不走路：只验证到了那里之后的事')
    default:
      return t('先按导航网格寻路，没有就按录的轨迹走，再不行运行时探路；运行设置里开了「到不了时瞬移」才会瞬移')
  }
}

/** 「回放怎么走」：写进步骤的 via（auto 不写），改场景文件走 ext/gt/file replace，带原步骤核对 */
function ViaPicker({ def, edit }: { def: StepDef; edit: NonNullable<Parameters<typeof GtMoveView>[0]['edit']> }) {
  const { ui } = h()
  const { busy, run } = useAction()
  const value = (VIAS.includes(def.via as MoveVia) ? def.via : 'auto') as MoveVia
  const set = (next: MoveVia) =>
    next !== value &&
    run('via', async () => {
      const step: StepDef = { ...def }
      if (next === 'auto') delete step.via
      else step.via = next
      await ppost(edit.project, 'ext/gt/file', {
        root: edit.root,
        path: edit.path,
        action: 'replace',
        index: edit.index,
        expect: [def],
        steps: [step],
      })
      h().toast.success(t('这一步回放改成：{v}', { v: viaLabel(next) }))
      edit.onChanged()
    })
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <ui.Segmented
        size="sm"
        label={t('回放怎么走')}
        value={value}
        onChange={set}
        options={VIAS.map((v) => ({ id: v, label: v === 'auto' ? t('自动') : shortVia(v), disabled: !!busy }))}
      />
      <p className="ue:text-footnote ue:text-subtle">{viaHelp(value)}</p>
    </div>
  )
}

const shortVia = (v: MoveVia) =>
  v === 'nav' ? t('寻路') : v === 'path' ? t('按轨迹') : v === 'probe' ? t('探路') : t('瞬移')

/**
 * 俯视图：UE 的 X 朝前、Y 朝右，画成 X 朝上、Y 朝右（和编辑器顶视图一样）。
 * 坐标是厘米，按所有点的范围缩放；线宽不跟着缩放
 */
function TopDown(o: { recorded: Vec3[]; trail: Vec3[]; from?: Vec3; to?: Vec3; jumps: Vec3[]; stuck?: Vec3 }) {
  const all = [...o.recorded, ...o.trail, ...[o.from, o.to, o.stuck].filter((v): v is Vec3 => !!v)]
  const xs = all.map((v) => v[1])
  const ys = all.map((v) => -v[0])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  // 只有一个点或一条直线时给个最小范围（5 米），图不至于缩成一个点
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 500)
  const pad = span * 0.08
  const r = span * 0.014
  const box = `${minX - pad} ${minY - pad} ${span + pad * 2} ${span + pad * 2}`
  const line = (pts: Vec3[]) => pts.map((v) => `${v[1]},${-v[0]}`).join(' ')
  return (
    <figure className="ue:flex ue:flex-col ue:gap-1">
      <svg
        viewBox={box}
        className="ue:aspect-square ue:w-full ue:max-w-80 ue:rounded-md ue:border ue:border-line ue:bg-field"
        role="img"
        aria-label={t('俯视轨迹图')}
      >
        {o.recorded.length > 1 && (
          <polyline
            points={line(o.recorded)}
            fill="none"
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            className="ue:stroke-subtle"
          />
        )}
        {o.trail.length > 1 && (
          <polyline
            points={line(o.trail)}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="ue:stroke-run"
          />
        )}
        {o.jumps.map((v, k) => (
          <circle key={k} cx={v[1]} cy={-v[0]} r={r * 0.7} className="ue:fill-warning" />
        ))}
        {o.from && <circle cx={o.from[1]} cy={-o.from[0]} r={r} className="ue:fill-success" />}
        {o.to && <circle cx={o.to[1]} cy={-o.to[0]} r={r} className="ue:fill-danger" />}
        {o.stuck && (
          <circle
            cx={o.stuck[1]}
            cy={-o.stuck[0]}
            r={r * 1.4}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="ue:stroke-danger"
          />
        )}
      </svg>
      <figcaption className="ue:flex ue:flex-wrap ue:gap-x-3 ue:gap-y-0.5 ue:text-caption ue:text-subtle">
        <Legend dot="ue:bg-success" text={t('录制起点')} />
        <Legend dot="ue:bg-danger" text={t('终点')} />
        {o.recorded.length > 1 && <Legend dot="ue:bg-subtle" text={t('录的轨迹（虚线）')} />}
        {o.trail.length > 1 && <Legend dot="ue:bg-run" text={t('这次走的')} />}
        {o.jumps.length > 0 && <Legend dot="ue:bg-warning" text={t('起跳')} />}
        {o.stuck && <Legend dot="ue:border ue:border-danger" text={t('卡住')} />}
        <span>{t('俯视，上方是 X 正向')}</span>
      </figcaption>
    </figure>
  )
}

function Legend({ dot, text }: { dot: string; text: string }) {
  return (
    <span className="ue:flex ue:items-center ue:gap-1">
      <span className={`ue:h-2 ue:w-2 ue:rounded-full ${dot}`} />
      {text}
    </span>
  )
}
