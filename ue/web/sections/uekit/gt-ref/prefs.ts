import { useState } from 'react'

/**
 * 属性树的显示选项和列宽：只是看着舒不舒服的个人偏好，记在本机（不进 _settings.json，团队不共用）。
 * 设置 → GameTest →「对象与标识」里改行高和「同类里」列，控件样式里也能看到效果
 */
export interface PropTreePrefs {
  /** 行高（像素），默认 28 */
  rowH: number
  /** 显示「同类里」那一列 */
  siblings: boolean
  /** 只看能当标识的 */
  onlyIdent: boolean
}

const KEY = 'ue:gt-proptree'
const DEF: PropTreePrefs = { rowH: 28, siblings: true, onlyIdent: false }

export function readPrefs(): PropTreePrefs {
  try {
    return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PropTreePrefs>) }
  } catch {
    return DEF
  }
}

export function writePrefs(p: Partial<PropTreePrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...p }))
  } catch {
    // 存不了就只在这次打开里生效
  }
}

export function usePrefs() {
  const [p, setP] = useState(readPrefs)
  return [
    p,
    (patch: Partial<PropTreePrefs>) => {
      writePrefs(patch)
      setP((x) => ({ ...x, ...patch }))
    },
  ] as const
}

/**
 * 可拖的列宽（像素）：拖表头右边的竖线改，双击恢复默认，记在本机。
 * 分栏用 split.tsx 的 usePane；表格列一行有好几列、都要记，单独一张表
 */
export function useColWidths(key: string, defs: Record<string, number>) {
  const store = `ue:cols:${key}`
  const [w, setW] = useState<Record<string, number>>(() => {
    try {
      return { ...defs, ...(JSON.parse(localStorage.getItem(store) ?? '{}') as Record<string, number>) }
    } catch {
      return defs
    }
  })
  const save = (next: Record<string, number>) => {
    try {
      localStorage.setItem(store, JSON.stringify(next))
    } catch {
      // 存不了就只在这次打开里生效
    }
  }
  return {
    w,
    set: (col: string, px: number) => setW((x) => ({ ...x, [col]: Math.max(48, Math.round(px)) })),
    commit: () => setW((x) => (save(x), x)),
    reset: (col: string) =>
      setW((x) => {
        const next = { ...x, [col]: defs[col] }
        save(next)
        return next
      }),
  }
}
