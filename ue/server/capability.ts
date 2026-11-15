import path from 'node:path'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { findUproject } from './detect.ts'
import { bridgeVersionIn } from './instances.ts'
import { getProject, listProjects } from './registry.ts'
import { c, t } from './util.ts'

/**
 * UE 作为项目能力（面板插件接口 9，清单 activation = project）：
 * - detect：目录里（或下一层）有 .uproject 时推荐打开；
 * - ready：打开了但还没在 UE 页接入、或项目里没装 UELink 时说还缺什么；
 * - 升级到按项目生效时，把已经在 UE 页接入过的项目都打开一次，升级后行为不变；以后在 UE 页新接入时也顺手打开。
 * 接入记录在插件自己的数据目录（registry.ts），面板的迁移 0006 看不到，所以由插件自己补
 */

export async function detectUe(project: { path: string }) {
  if (!project.path) return undefined
  const u = await findUproject(project.path)
  return u ? t('找到 {name}', { name: path.basename(u) }) : undefined
}

export async function ueReady(project: { id: string }) {
  const p = await getProject(project.id)
  if (!p) return t('还要在 UE 页接入这个项目')
  if (!(await bridgeVersionIn(p.root))) return t('项目里还没装 UELink：到 UE 页「桥接与权限」安装')
  return undefined
}

/** 在面板项目里打开 UE；项目已经删了（接入记录还在）时不报错 */
export async function enableFor(id: string) {
  try {
    await c().projects.enable(id)
  } catch (e) {
    c().log.warn('UE：在项目里打开插件失败', { project: id, error: (e as Error).message })
  }
}

/**
 * 只做一次：数据目录里记一个标记。不只看 previousVersion——链接本机目录装的没有 previousVersion，
 * 从接口 8 的版本升级上来也可能已经接入过项目
 */
export async function enableRegisteredOnce() {
  const mark = path.join(c().dataDir, 'project-capability-migrated')
  if (
    await access(mark).then(
      () => true,
      () => false,
    )
  )
    return
  const list = await listProjects()
  for (const p of list) await enableFor(p.id)
  await mkdir(c().dataDir, { recursive: true })
  await writeFile(mark, `${c().version} ${c().previousVersion || '-'}\n`)
  if (list.length) c().log.info('UE：已在接入过的项目里打开插件', { projects: list.length })
}
