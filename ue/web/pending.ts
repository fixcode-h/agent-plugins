/**
 * 从别处带着一句话跳到某个分区（Ctrl+K 跳转、空页面的出口）：先记下来，分区挂载时取走并自动搜一次。
 * 不放进地址：地址里的子位置已经用来记选中的对象，搜索词刷新后不需要还在
 */
const pending = new Map<string, string>()

export function setPending(section: string, q: string) {
  pending.set(section, q)
}

/** 取走（只给一次，免得切回来又搜一遍） */
export function takePending(section: string) {
  const q = pending.get(section)
  pending.delete(section)
  return q
}
