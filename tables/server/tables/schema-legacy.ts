import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { writeTracked } from '../project-data/index.ts'
import { DATA_DIR } from '../store.ts'

/**
 * 结构文件挪位置（可统一能力盘点第 7 项，用户 2026-11-23 定放文档根/AgentPanel/Tables）的一次性迁移：
 * 新目录里还没有任何 .json、旧目录里有时，把旧目录的 .json 原样复制过去（P4 工作区里新文件会 p4 add）。
 * 旧文件不删：它们可能在版本控制里，删不删、什么时候提交由用户决定；新目录有了文件之后就不再读旧的。
 * 为什么不在面板的数据迁移里做：旧位置有一份在项目目录里，跟着版本控制，同事拉下来的分支里才有，只能用到时再搬
 */

/** 本进程已经确认过的新目录：每次请求都要算结构文件目录，查过一次就不再碰磁盘 */
const checked = new Set<string>() // 模块状态：只增不减，进程内有效

const jsonIn = async (dir: string) =>
  (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))

/** 旧位置：项目目录 .agentpanel/tables/，或数据目录 tables/<项目 id>/ */
export function legacySchemaDir(projectDir: string, projectId: string, store: 'project' | 'data') {
  return store === 'data' ? path.join(DATA_DIR, 'tables', projectId) : path.join(projectDir, '.agentpanel', 'tables')
}

export async function migrateLegacySchema(
  dir: string,
  projectDir: string,
  projectId: string,
  store: 'project' | 'data',
) {
  if (checked.has(dir)) return
  if (!(await jsonIn(dir)).length) {
    const old = legacySchemaDir(projectDir, projectId, store)
    for (const f of await jsonIn(old)) {
      const text = await readFile(path.join(old, f), 'utf8').catch(() => null)
      if (text !== null) await writeTracked(path.join(dir, f), text)
    }
  }
  checked.add(dir)
}
