/**
 * 每个进程从什么时候起不回应、上一次回应时报的日志文件（编辑器忙时 /info 拿不到日志路径，用上一次的）。
 * 只在内存里：面板重启后从下一次没回应重新计时，不影响判断
 */
const firstMiss = new Map<number, number>()
const lastLog = new Map<number, string>()

/** /info 回应了：清掉计时，记下日志路径 */
export function markOnline(pid: number, log?: string) {
  firstMiss.delete(pid)
  if (log) lastLog.set(pid, log)
}

/** /info 超时：返回第一次没回应的时间（毫秒时间戳） */
export function markBusy(pid: number) {
  const at = firstMiss.get(pid) ?? Date.now()
  firstMiss.set(pid, at)
  return at
}

/** 连接直接失败（不是超时）：不算忙，计时也清掉 */
export function markDown(pid: number) {
  firstMiss.delete(pid)
}

export const lastLogOf = (pid: number) => lastLog.get(pid)
