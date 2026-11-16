/**
 * 「AI 整理」的步骤差异：原场景和整理稿按步骤对齐（最长公共子序列），看哪些步骤留着、删了、新加了。
 * 比较时不看 note 和 hint：整理主要就是给每一步补说明，录制线索 Agent 也可能精简，这两样变了不算改了这一步。
 * 录制的场景几十到几百步，O(n·m) 的表够用。
 */
export type DiffRow = { kind: 'same'; a: number; b: number } | { kind: 'del'; a: number } | { kind: 'add'; b: number }

type Step = Record<string, unknown>

/** 一步的比较键：去掉 note、hint，字段按名字排好（字段顺序不同不算改） */
export function stepKey(s: Step) {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Step)
              .sort()
              .map((k) => [k, sorted((v as Step)[k])]),
          )
        : v
  return JSON.stringify(sorted(Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'note' && k !== 'hint'))))
}

export function diffSteps(a: Step[], b: Step[]): DiffRow[] {
  const ka = a.map(stepKey)
  const kb = b.map(stepKey)
  // lcs[i][j]：a[i..]、b[j..] 的最长公共子序列长度
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) out.push({ kind: 'same', a: i++, b: j++ })
    // 删在前、加在后：同一处的「换了一步」显示成先划掉旧的再出新的
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', a: i++ })
    else out.push({ kind: 'add', b: j++ })
  }
  while (i < a.length) out.push({ kind: 'del', a: i++ })
  while (j < b.length) out.push({ kind: 'add', b: j++ })
  return out
}

/** 差异的计数：留着、删掉、新加 */
export function diffCounts(rows: DiffRow[]) {
  return {
    same: rows.filter((r) => r.kind === 'same').length,
    del: rows.filter((r) => r.kind === 'del').length,
    add: rows.filter((r) => r.kind === 'add').length,
  }
}

/**
 * 整理稿对着 gt.actions 核对：动作名不认识、字段不认识的列出来（GameTest 读到这种步骤会直接报错）。
 * actions 是 gt.actions 的 actions（params 是这个动作自己的字段），common 是公共字段名
 */
export function checkSteps(
  steps: Step[],
  catalog: { actions: { name: string; params?: string[] }[]; common: string[] },
): string[] {
  const byName = new Map(catalog.actions.map((x) => [x.name, new Set(x.params ?? [])]))
  const common = new Set(catalog.common)
  const out: string[] = []
  steps.forEach((s, i) => {
    const name = String(s.action ?? '')
    const params = byName.get(name)
    if (!params) {
      out.push(`#${i + 1} action=${name}`)
      return
    }
    const extra = Object.keys(s).filter((k) => !common.has(k) && !params.has(k))
    if (extra.length) out.push(`#${i + 1} ${name}: ${extra.join(', ')}`)
  })
  return out
}
