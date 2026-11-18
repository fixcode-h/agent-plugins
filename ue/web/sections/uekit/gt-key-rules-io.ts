import { ppost } from '../../api.ts'
import type { GtKeyRule } from './GtKeyRules.tsx'

/** 条目规则（场景根 _settings.json 的 itemKeys）直接读写磁盘：编辑器没开也能整理（server/uekit/gt-keys.ts） */
export const loadKeyRules = (project: string, root: string) =>
  ppost<{ rules: GtKeyRule[] }>(project, 'ext/gt/keyrules', { root, action: 'read' }).then((r) => r.rules)

export const writeKeyRules = (project: string, root: string, rules: GtKeyRule[]) =>
  ppost<{ rules: GtKeyRule[] }>(project, 'ext/gt/keyrules', { root, action: 'write', rules }).then((r) => r.rules)

/** 加一条：同条目类 + 容器的旧规则换掉 */
export const saveKeyRule = (project: string, root: string, rule: GtKeyRule) =>
  ppost<{ rules: GtKeyRule[] }>(project, 'ext/gt/keyrules', { root, action: 'upsert', rule }).then((r) => r.rules)
