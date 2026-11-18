import { useEffect, useRef, useState } from 'react'

/** 闪多久：比默认刷新间隔（0.2 秒）长，翻页时连着变的字段一直亮着，一眼看出谁在跟着变 */
const FLASH_MS = 900

/**
 * 值变了闪一下（定稿 9.3「字段变了会闪一下」）：传进来 键 → 值的文字，返回这一刻该亮着的键。
 * 第一次拿到的值不算变化
 */
export function useFlash(values: Map<string, string>) {
  const prev = useRef<Map<string, string>>(undefined)
  const [lit, setLit] = useState<Set<string>>(new Set())
  const sig = [...values].map(([k, v]) => `${k}=${v}`).join('\n')
  useEffect(() => {
    const old = prev.current
    prev.current = values
    if (!old) return
    const changed = [...values].filter(([k, v]) => old.has(k) && old.get(k) !== v).map(([k]) => k)
    if (!changed.length) return
    setLit(new Set(changed))
    const timer = setTimeout(() => setLit(new Set()), FLASH_MS)
    return () => clearTimeout(timer)
    // sig 是 values 的内容：Map 每次渲染都是新的
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return lit
}
