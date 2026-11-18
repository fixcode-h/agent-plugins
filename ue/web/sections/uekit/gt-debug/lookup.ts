import {
  findPath,
  getAt,
  parsePath,
  type GtGuard,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { faceOf, guardFace } from '../gt-flow/faces.tsx'

/** 推送和报告里的 key（步骤 id 或路径）→ 脚本里的这一步和它的样子；脚本改过、对不上时只给 key */
export function stepOfKey(doc: GtScript | undefined, key: string): { path?: GtPath; step?: GtStep } {
  if (!doc || !key) return {}
  const byId = findPath(doc, key)
  const path = byId ?? (key.includes('.') ? parsePath(key) : undefined)
  const step = path && (getAt(doc, path) as GtStep | undefined)
  return step && typeof step === 'object' && typeof step.action === 'string' ? { path, step } : {}
}

export function titleOfKey(doc: GtScript | undefined, key: string) {
  const { path, step } = stepOfKey(doc, key)
  if (!step) return { title: key, sub: '', path: undefined }
  const f = faceOf(step)
  return { title: f.title, sub: f.sub, path, icon: f.icon, tone: f.tone }
}

/** 守护的名字：脚本里的、块上的都找；全局守护（_settings.json）脚本里没有，只给 id */
export function guardTitle(doc: GtScript | undefined, id: string) {
  const find = (list: unknown): GtGuard | undefined =>
    Array.isArray(list) ? (list as GtGuard[]).find((g) => g?.id === id) : undefined
  const g = find(doc?.guards)
  return g ? guardFace(g).when || id : id
}
