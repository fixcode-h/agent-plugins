import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadStyles } from '@panel/server/styles'
import { BUILTIN_STYLES } from '@panel/shared/styles'
import { styleBrief } from '@panel/shared/style/rules-text'
import type { SavedStyle } from '@panel/shared/style-types'
import type { PluginRun, PluginServerContext } from '../../sdk/server.ts'

/**
 * 模型风格（面板风格库里的「3D 模型」类，设计稿「Blender建模风格」）：建模前选一个，约束造型、拓扑、材质这些。
 *
 * 风格本身在面板的风格库（内置 12 种 + 用户复制改的），这里只记「哪个对话用哪个风格」和「交给 Agent 没有」：
 * - 模型设计对话：新建页选的风格先记成「上次选的」，对话第一次跑时认领；之后在「模型」页签里换。
 * - Blender 建模角色（对话里、工作流节点上）：角色参数「模型风格」填风格名字，没填按通用。
 * 中途换风格只管之后的步骤：下一轮用 turnNote 告诉 Agent 改了什么，已经建好的部分不推倒重来，除非用户要求。
 */

let ctx: PluginServerContext
let DIR = ''
const DEFAULT_STYLE = 'builtin-model-general'

export function initStyle(c: PluginServerContext) {
  ctx = c
  DIR = path.join(c.dataDir, 'styles')
}

/** 一个对话的风格状态：用哪个、上次交给 Agent 的是哪个（空 = 还没交过） */
interface TaskStyle {
  styleId: string
  told: string
}

const file = (name: string) => path.join(DIR, `${name.replace(/[^\w-]/g, '_')}.json`)
async function readJson<T>(name: string): Promise<Partial<T>> {
  const raw = await readFile(file(name), 'utf8').catch(() => '')
  try {
    return raw ? (JSON.parse(raw) as Partial<T>) : {}
  } catch {
    return {}
  }
}
async function writeJson(name: string, data: unknown) {
  await mkdir(DIR, { recursive: true })
  await writeFile(file(name), JSON.stringify(data, null, 2))
}

/** 风格库里的模型风格：自己存的在前，内置的在后（和面板风格选择器的顺序一致） */
export async function modelStyles(): Promise<SavedStyle[]> {
  const own = (await loadStyles()).filter((s) => s.kind === 'model')
  return [...own, ...BUILTIN_STYLES.filter((s) => s.kind === 'model')]
}

/** 按 id 找，找不到（风格被删了）按通用 */
async function styleById(id: string): Promise<SavedStyle> {
  const all = await modelStyles()
  return all.find((s) => s.id === id) ?? all.find((s) => s.id === DEFAULT_STYLE)!
}

/** 角色参数里写的是风格名字（工作流节点上填、对话里选，都是给人看的名字）；也认 id */
async function styleByName(name: string): Promise<SavedStyle> {
  const all = await modelStyles()
  const key = name.trim()
  return all.find((s) => s.name === key || s.id === key) ?? all.find((s) => s.id === DEFAULT_STYLE)!
}

/** 新建页上次选的风格：新对话第一次跑时认领它 */
export async function lastStyle(): Promise<string> {
  return (await readJson<{ styleId: string }>('_last')).styleId || DEFAULT_STYLE
}
export async function setLastStyle(styleId: string) {
  await writeJson('_last', { styleId: (await styleById(styleId)).id })
}

/** 模型对话现在的风格；还没定的按新建页上次选的 */
export async function taskStyle(taskId: string): Promise<string> {
  return (await readJson<TaskStyle>(taskId)).styleId || (await lastStyle())
}
export async function setTaskStyle(taskId: string, styleId: string): Promise<string> {
  const prev = await readJson<TaskStyle>(taskId)
  const id = (await styleById(styleId)).id
  await writeJson(taskId, { styleId: id, told: prev.told ?? '' })
  ctx?.log.info('模型风格已改', { taskId, styleId: id })
  return id
}

/**
 * 这一轮要交给 Agent 的风格说明：新会话整段放进 hint；续接的会话只在风格换过时给 turnNote（说明是「改成了」）。
 * model = 模型设计对话；否则是 Blender 角色的对话，风格看角色参数 style
 */
export async function styleNotes(run: PluginRun, model: boolean): Promise<{ hint?: string; turnNote?: string }> {
  const param = run.params?.style
  const style = model
    ? await styleById(await taskStyle(run.taskId))
    : await styleByName(typeof param === 'string' ? param : '')
  const prev = await readJson<TaskStyle>(run.taskId)
  if (run.dryRun) return { hint: styleBrief(style) }
  const fresh = !run.resume
  if (!fresh && prev.told === style.id) return {}
  await writeJson(run.taskId, { styleId: model ? style.id : (prev.styleId ?? ''), told: style.id })
  // 续接的会话里第一次交（老对话升级上来、角色参数刚改）：之前没说过风格，不说「改成了」
  return fresh ? { hint: styleBrief(style) } : { turnNote: styleBrief(style, !!prev.told) }
}
