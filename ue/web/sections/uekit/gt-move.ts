import { t } from '../../host.ts'

/**
 * GameTest 1.3.0 的 move 步骤：让角色自己走到目标点（导航网格寻路 → 按录的轨迹走 → 运行时探路，都不行再看要不要瞬移）。
 * 录制时「录移动」那一段写成 to + path（简化后的轨迹）+ jumps（起跳点下标）+ hint（起点、用时、距离、录制时有没有导航网格）。
 * 坐标是 UE 世界坐标，单位厘米，点写成 [x, y, z]
 */
export type Vec3 = [number, number, number]

export type MoveVia = 'auto' | 'nav' | 'path' | 'probe' | 'teleport'

export interface MoveHint {
  from?: Vec3
  durationMs?: number
  /** 录制时走过的距离（厘米） */
  distance?: number
  nav?: boolean
  pawn?: string
  map?: string
}

/** 一次回放的结果（步骤结果的 payload） */
export interface MovePayload {
  used?: string
  reached?: boolean
  to?: Vec3
  /** 停下时离目标多远（厘米） */
  distance?: number
  ms?: number
  tried?: { via: string; why: string }[]
  stuck?: Vec3
  trail?: Vec3[]
  probeCells?: number
}

export function pointOf(v: unknown): Vec3 | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined
  const [x, y, z = 0] = v.map(Number)
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
}

export function pathOf(v: unknown): Vec3[] {
  return Array.isArray(v) ? v.map(pointOf).filter((p): p is Vec3 => !!p) : []
}

export function moveHintOf(def?: Record<string, unknown>): MoveHint {
  const h = def?.hint
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {}
  const o = h as Record<string, unknown>
  return {
    from: pointOf(o.from),
    durationMs: typeof o.durationMs === 'number' ? o.durationMs : undefined,
    distance: typeof o.distance === 'number' ? o.distance : undefined,
    nav: typeof o.nav === 'boolean' ? o.nav : undefined,
    pawn: typeof o.pawn === 'string' ? o.pawn : undefined,
    map: typeof o.map === 'string' ? o.map : undefined,
  }
}

export function viaLabel(via?: string) {
  switch (via) {
    case 'nav':
      return t('按导航网格寻路')
    case 'path':
      return t('按录的轨迹走')
    case 'probe':
      return t('运行时探路')
    case 'teleport':
      return t('瞬移')
    case 'none':
      return t('没走')
    default:
      return t('自动')
  }
}

/** 厘米 → 「12.3 米」 */
export const meters = (cm: number) => t('{m} 米', { m: (cm / 100).toFixed(1) })

const round = (n: number) => Math.round(n)

/** 步骤列表里的一句：「走到 (1200, -340)」「走到 BP_Npc」，写了 via 时带上走法 */
export function moveTitle(def: Record<string, unknown>) {
  const actor = typeof def.toActor === 'string' ? def.toActor : typeof def.toTag === 'string' ? def.toTag : ''
  const to = pointOf(def.to)
  const where = actor
    ? t('走到 {a}', { a: actor.split('/').pop()?.split('.').pop()?.replace(/_C$/, '') ?? actor })
    : to
      ? t('走到 ({x}, {y})', { x: round(to[0]), y: round(to[1]) })
      : t('走到目标点')
  const via = typeof def.via === 'string' && def.via !== 'auto' ? def.via : ''
  return via ? `${where} · ${viaLabel(via)}` : where
}

/** 录制中步骤列表里的一行：目标、录的距离和用时、轨迹点数 */
export function moveLine(def: Record<string, unknown>) {
  const h = moveHintOf(def)
  const n = pathOf(def.path).length
  return [
    moveTitle(def),
    h.distance !== undefined && meters(h.distance),
    h.durationMs !== undefined && t('{s} 秒', { s: (h.durationMs / 1000).toFixed(1) }),
    n > 0 && t('轨迹 {n} 个点', { n }),
  ]
    .filter(Boolean)
    .join(' · ')
}
