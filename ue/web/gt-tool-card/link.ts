/**
 * 从对话里的工具卡片跳到 UE 页 GameTest 的某次运行：GameTest 页的子路径平时是脚本路径（相对场景根），
 * 带运行时写成「脚本路径?run=<runId>」。只在这一处拼和拆，卡片和 GameTest 页各用一半
 */
const SEP = '?run='

export function runSub(scenario: string, runId?: string) {
  return runId ? `${scenario}${SEP}${runId}` : scenario
}

export function parseRunSub(sub: string | undefined): { path: string | undefined; run?: string } {
  if (!sub) return { path: sub }
  const i = sub.lastIndexOf(SEP)
  return i < 0 ? { path: sub } : { path: sub.slice(0, i), run: sub.slice(i + SEP.length) || undefined }
}

/** 面板路由里 UE 页的 msg 段：<项目>/gametest/<子路径>，每段各自编码（和 UePage 的 go 一致） */
export const gametestRoute = (project: string, sub: string) =>
  [project, 'gametest', sub].map(encodeURIComponent).join('/')
