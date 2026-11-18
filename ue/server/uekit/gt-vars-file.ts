import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../util.ts'
import { insideProject } from './gt-paths.ts'

/**
 * 场景根的 _vars.json（定稿 9.5「变量目录」）：{"常用名": 判断对象}，条件里写 {"alias": "常用名"}，团队共用一套名字、进版本库。
 * 读：列出全部；save：加一条（name + check），同名覆盖；remove：删一条
 */
const FILE = '_vars.json'

export async function readAliases(projectRoot: string, scenarioRoot: string, b: Record<string, unknown>) {
  if (!scenarioRoot) throw new Error(t('不知道场景根在哪：先刷新 GameTest 页'))
  const file = path.join(insideProject(projectRoot, scenarioRoot), FILE)
  const text = await readFile(file, 'utf8').catch(() => '')
  let vars: Record<string, unknown> = {}
  if (text.trim())
    try {
      const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) vars = v as Record<string, unknown>
    } catch (e) {
      throw new Error(t('{f} 不是合法的 JSON：{e}', { f: FILE, e: (e as Error).message }))
    }
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (b.action === 'save' || b.action === 'remove') {
    if (!name) throw new Error(t('常用名不能是空的'))
    if (b.action === 'save') {
      if (!b.check || typeof b.check !== 'object') throw new Error(t('缺少要存的条件'))
      vars = { ...vars, [name]: b.check }
    } else delete vars[name]
    await writeFile(file, JSON.stringify(vars, null, '\t') + '\n', 'utf8')
  }
  return { path: path.join(scenarioRoot, FILE).replace(/\\/g, '/'), vars }
}
