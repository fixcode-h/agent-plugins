import { ppost } from '../../api.ts'
import type { StepDef } from './GtStepDetail.tsx'

/**
 * 改场景里的一步：把 patch 合进原步骤（值是 undefined 的字段删掉），走 ext/gt/file replace。
 * 带上网页看到的原步骤核对，文件在这期间被重新录制或 Agent 改过就报错让刷新，不按行号硬改
 */
export function patchStep(
  o: { project: string; root: string; path: string },
  index: number,
  def: StepDef,
  patch: Record<string, unknown>,
) {
  const next: Record<string, unknown> = { ...def }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return ppost(o.project, 'ext/gt/file', {
    root: o.root,
    path: o.path,
    action: 'replace',
    index,
    expect: [def],
    steps: [next],
  })
}

/** 要等界面的步骤（对着控件的、等控件出现 / 消失的）：这些步骤的 timeoutMs 才是「等界面」的上限，值得在详情里单独给 */
export function waitsForWidget(def?: StepDef) {
  if (!def) return false
  if (typeof def.target === 'string' && def.target) return true
  return def.action === 'wait' && (def.until === 'widget' || def.until === 'widgetGone')
}
