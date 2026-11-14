// 版本比较（服务端和网页共用，不依赖插件上下文）

/** 语义化版本比较：a < b 返回负数。2.0.0-beta.1 < 2.0.0（预发布比同号正式版旧） */
export function cmpVersion(a: string, b: string) {
  const split = (v: string) => {
    const [main, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2)
    return { nums: main.split('.').map((x) => parseInt(x, 10) || 0), pre }
  }
  const pa = split(a)
  const pb = split(b)
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d) return d
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true })
}


/** installed 比 available 旧，可以升级（没装、读不出版本时不算） */
export function canUpgrade(installed?: string, available?: string) {
  return !!installed && installed !== '?' && !!available && cmpVersion(installed, available) < 0
}
