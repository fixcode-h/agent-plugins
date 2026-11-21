import { createHash } from 'node:crypto'
import path from 'node:path'
import { ueDocFile } from '../doc-root.ts'
import type { UeProject } from '../types.ts'
import { c, now, readJson, t, writeJson } from '../util.ts'

/**
 * Lua 页执行页签的「片段」（设计稿四.4「已批准的片段」）：常用代码存成有名字的片段，你批准过的 Agent 按名字执行时不再逐次确认。
 * - 片段本身存在项目里（和资源收藏同一个位置设置：项目文档根的 AgentPanel/UE/），可以提交、团队共用；
 * - 批准只记在本机插件数据目录里，记的是代码的哈希：别人改了仓库里的片段（或你自己改了），批准自动失效，
 *   不会因为拉了一次代码就让 Agent 免确认跑别人写的代码。
 */
export interface Snippet {
  name: string
  code: string
  /** self 对象路径（可选，和执行页的输入框一样） */
  self?: string
  desc?: string
  updatedAt?: string
}

export interface SnippetView extends Snippet {
  approved: boolean
}

/** 名字只用来给 Agent 按名字调：不要太长，也不要有换行 */
const NAME_MAX = 60
const MAX = 200

/** 片段文件：read 是读的位置（升级前存在旧文档根的照样读得到），write 是写的位置（面板给的文档根，见 doc-root.ts） */
export const snippetFile = (p: Pick<UeProject, 'id' | 'root'>) => ueDocFile(p, 'lua-snippets.json')

const approvedFile = (id: string) => path.join(c().dataDir, 'lua-approved', `${encodeURIComponent(id)}.json`)

/** 批准认的是「代码 + self」：两者任一变了都要重新批准 */
export const snippetHash = (s: Pick<Snippet, 'code' | 'self'>) =>
  createHash('sha256')
    .update(`${s.self ?? ''}\n${s.code}`)
    .digest('hex')

function clean(list: unknown): Snippet[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: Snippet[] = []
  for (const x of list as Partial<Snippet>[]) {
    const name = String(x?.name ?? '').trim()
    if (!name || !x?.code || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      code: String(x.code),
      ...(x.self ? { self: String(x.self) } : {}),
      ...(x.desc ? { desc: String(x.desc) } : {}),
      ...(x.updatedAt ? { updatedAt: String(x.updatedAt) } : {}),
    })
  }
  return out.slice(0, MAX)
}

async function readApproved(id: string) {
  return readJson<Record<string, string>>(approvedFile(id), {})
}

export async function listSnippets(p: UeProject): Promise<{ items: SnippetView[]; file: string }> {
  const { read, write: file } = snippetFile(p)
  const items = clean((await readJson<{ snippets?: unknown }>(read, {})).snippets)
  const ok = await readApproved(p.id)
  return { items: items.map((s) => ({ ...s, approved: ok[s.name] === snippetHash(s) })), file }
}

async function writeSnippets(p: UeProject, items: Snippet[]) {
  await writeJson(snippetFile(p).write, { snippets: items })
}

/**
 * 网页上改片段：save 新建或改（oldName 是改名前的名字）；remove 删；approve 批准 / 撤销批准（on）。
 * 按动作改而不是整份覆盖：文件是团队共用的，别人刚加的不被网页上的旧列表盖掉
 */
export async function editSnippets(p: UeProject, b: Record<string, unknown>) {
  const { items } = await listSnippets(p)
  const list: Snippet[] = items.map(({ approved: _a, ...s }) => s)
  const name = String(b.name ?? '').trim()
  const ok = await readApproved(p.id)
  if (b.action === 'save') {
    if (!name) throw new Error(t('片段要有名字'))
    if (name.length > NAME_MAX || /[\r\n]/.test(name))
      throw new Error(t('片段名字不能超过 {n} 个字，也不能换行', { n: NAME_MAX }))
    const code = String(b.code ?? '')
    if (!code.trim()) throw new Error(t('片段的代码是空的'))
    const old = String(b.oldName ?? name)
    if (old !== name && list.some((s) => s.name === name)) throw new Error(t('已经有叫「{name}」的片段了', { name }))
    const next: Snippet = {
      name,
      code,
      ...(String(b.self ?? '').trim() ? { self: String(b.self).trim() } : {}),
      ...(String(b.desc ?? '').trim() ? { desc: String(b.desc).trim() } : {}),
      updatedAt: now(),
    }
    const at = list.findIndex((s) => s.name === old)
    if (at >= 0) list[at] = next
    else {
      if (list.length >= MAX) throw new Error(t('片段最多 {n} 个，先删掉不用的', { n: MAX }))
      list.push(next)
    }
    // 改名时批准跟着走（代码没变才还算批准，哈希会再核一次）
    if (old !== name && ok[old]) {
      ok[name] = ok[old]
      delete ok[old]
    }
    if (b.approve === true) ok[name] = snippetHash(next)
    await writeSnippets(p, list)
  } else if (b.action === 'remove') {
    await writeSnippets(
      p,
      list.filter((s) => s.name !== name),
    )
    delete ok[name]
  } else if (b.action === 'approve') {
    const s = list.find((x) => x.name === name)
    if (!s) throw new Error(t('没有叫「{name}」的片段', { name }))
    if (b.on === false) delete ok[name]
    else ok[name] = snippetHash(s)
  } else throw new Error(t('不认识的动作：{a}', { a: String(b.action) }))
  await writeJson(approvedFile(p.id), ok)
  return listSnippets(p)
}
