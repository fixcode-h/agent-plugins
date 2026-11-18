/**
 * 「整理成流程」的规则（定稿 9.7）：从录制步骤里认出能变成流程的模式，给出整理方案里的改动（gt-tidy-plan / gt-tidy-flow 的格式）。
 * 规则只是建议：提示词里交给 Agent，Agent 结合项目代码判断要不要用、要不要改条件，用户再逐条勾选。
 * 加一种模式 = rules/ 下加一个文件 + 在 index.ts 的 RULES 里登记，别处不用改。
 */
export type Step = Record<string, unknown>

/** 一条建议：一组一起勾的改动（例如「删掉后面几次 + 第一次包成循环」），步骤号从 1 数 */
export interface FlowHint {
  rule: string
  /** 给人和 Agent 看的一句话 */
  what: string
  /** 涉及的原步骤号（判重叠用） */
  steps: number[]
  changes: Step[]
}

export interface LibraryScript {
  /** 相对场景根，不带 .json（call 里就这么写） */
  rel: string
  steps: Step[]
}

export interface FlowCtx {
  steps: Step[]
  /** 场景根里别的脚本（同一段步骤已经有现成脚本时改成 call） */
  library: LibraryScript[]
  /** 已经被前面的规则用掉的步骤号：后面的规则不再碰，建议之间不重叠 */
  claimed: Set<number>
}

export interface FlowRule {
  name: string
  summary: string
  run(ctx: FlowCtx): FlowHint[]
}
