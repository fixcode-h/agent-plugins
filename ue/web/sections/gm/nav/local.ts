import { useState } from 'react'

/**
 * GM 页记在本机的小偏好（当前分类、每个分类的来源筛选、收藏区折没折起来）：规格第 6 节「切换记在本机」。
 * 只是个人习惯，不进团队共用的 gm.json；读写 localStorage 失败（隐私模式）就当没记
 */
export function useLocalPref<T>(key: string, init: T) {
  const full = `ue:gm:${key}`
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(full)
      return raw === null ? init : (JSON.parse(raw) as T)
    } catch {
      return init
    }
  })
  const set = (n: T) => {
    setV(n)
    try {
      localStorage.setItem(full, JSON.stringify(n))
    } catch {
      // 存不了只是下次打开回到默认
    }
  }
  return [v, set] as const
}
