import { op, type CompareDef } from './types.ts'

/** FVector、FRotator、FVector2D、:pos / :size / :location：near 按 tol，eq 逐分量也带 tol */
export const vectorCompare: CompareDef = {
  kinds: ['vector', 'rotator', 'vector2'],
  ops: [op('near', 'one', true), op('eq', 'one', true)],
  default: 'near',
}

/** FLinearColor、FColor、FSlateColor：只比相近（每通道 tol） */
export const colorCompare: CompareDef = { kinds: ['color'], ops: [op('near', 'one', true)], default: 'near' }
