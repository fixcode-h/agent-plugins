import { stat } from 'node:fs/promises'
import { forgeConfigRoot, forgeRootFromSetting } from './forge-disk.ts'
import { gtRootsFromSetting, outputRoot, scenarioRoot } from './gt-disk.ts'

/**
 * 插件设置页（UE 插件页卡片上的「设置」）里的目录一节：AssetForge 的配置根、GameTest 的场景根和产物目录。
 * 这几个在 UE 的「项目设置 → 插件」里（写在项目的 Config/Default*.ini），面板只读出来显示实际用的是哪、
 * 是设置里填的还是按约定找的，不改 ini：编辑器开着时它自己也会写这份文件，两边一起写容易互相覆盖。
 */
const isDir = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  )
const slash = (p: string) => p.replace(/\\/g, '/')

async function entry(abs: string, fromSetting: boolean) {
  return { path: slash(abs), exists: await isDir(abs), fromSetting }
}

export async function extPaths(root: string) {
  const gt = await gtRootsFromSetting(root)
  return {
    forgeRoot: await entry(await forgeConfigRoot(root), !!(await forgeRootFromSetting(root))),
    gtScenarioRoot: await entry(await scenarioRoot(root), !!gt.scenarioRootDir),
    gtOutputRoot: await entry(await outputRoot(root), !!gt.outputDir),
  }
}
