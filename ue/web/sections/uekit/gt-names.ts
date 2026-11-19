import { t } from '../../host.ts'

/**
 * GameTest 脚本不许同名（用户 2026-11-19）：场景名和文件名都算，不分大小写、不分文件夹。
 * 同名的脚本在场景库、call、运行记录里分不清，录制两次「11」就出了两个一样的条目。
 */
interface Named {
  name: string
  relativePath: string
}

const stemOf = (p: string) => (p.split('/').at(-1) ?? p).replace(/\.json$/i, '')
const key = (s: string) => s.trim().toLowerCase()

/** 已经有别的脚本叫这个名字（except：改名时排除自己）；有就返回提示，没有返回 undefined */
export function nameTaken(scenarios: Named[], name: string, except?: string): string | undefined {
  const k = key(name)
  if (!k) return undefined
  const hit = scenarios.find(
    (s) => s.relativePath !== except && (key(s.name) === k || key(stemOf(s.relativePath)) === k),
  )
  return hit ? t('已经有叫「{name}」的脚本了（{p}），换个名字', { name: name.trim(), p: hit.relativePath }) : undefined
}

/** 没人用的名字：base 没被占用就用 base，否则 base1、base2…… */
export function uniqueName(scenarios: Named[], base: string): string {
  if (!nameTaken(scenarios, base)) return base
  for (let i = 1; ; i++) if (!nameTaken(scenarios, `${base}${i}`)) return `${base}${i}`
}
