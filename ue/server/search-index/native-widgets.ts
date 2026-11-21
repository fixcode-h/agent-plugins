import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 项目里哪些 C++ 类是 UserWidget 的子类（用户 2026-11-18：界面只按「是不是 UUserWidget 的子类」认，不按名字认）。
 * UEToVS 的索引只记蓝图的原生父类名（npc），父类是项目自己的控件基类（UMyPanelBase : UUserWidget）时光看名字认不出，
 * 所以读项目和项目插件 Source 下的头文件，按 `class X_API UFoo : public UBar` 拼出继承链。只读声明，不编译，宏包着的写法认不出就当不是
 */

/** 引擎和常见引擎插件里 UserWidget 的子类：链走到这些就算 */
const ENGINE_WIDGETS = [
  'UserWidget',
  'CommonUserWidget',
  'CommonActivatableWidget',
  'CommonButtonBase',
  'CommonTabListWidgetBase',
  'CommonBoundActionButton',
  'EditorUtilityWidget',
]

/** 不进去找头文件的目录：生成物、第三方库、资源 */
const SKIP = new Set([
  'intermediate',
  'binaries',
  'saved',
  'content',
  'thirdparty',
  'deriveddatacache',
  '.git',
  'node_modules',
])
/** 头文件太多时只读这么多，防止超大项目建索引卡住 */
const MAX_HEADERS = 30000

const DECL = /\bclass\s+(?:\w+_API\s+)?[UA]?(\w+)\s*(?:final\s*)?:\s*public\s+[UA]?(\w+)/g

async function headers(dir: string, out: string[]) {
  if (out.length >= MAX_HEADERS) return
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of ents) {
    if (out.length >= MAX_HEADERS) return
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP.has(e.name.toLowerCase())) await headers(p, out)
    } else if (/\.h$/i.test(e.name)) out.push(p)
  }
}

/** 头文件内容 → 类名到父类名（都去掉 U / A 前缀）。纯逻辑，单测用 */
export function parseDecls(text: string, into = new Map<string, string>()) {
  for (const m of text.matchAll(DECL)) into.set(m[1], m[2])
  return into
}

/** 父类表 → UserWidget 的所有子类（含引擎的那几个），链太长或绕成环的不算 */
export function widgetClasses(parents: Map<string, string>) {
  const yes = new Set(ENGINE_WIDGETS)
  const no = new Set<string>()
  const walk = (name: string) => {
    const seen: string[] = []
    let cur: string | undefined = name
    while (cur && !yes.has(cur) && !no.has(cur) && seen.length < 40 && !seen.includes(cur)) {
      seen.push(cur)
      cur = parents.get(cur)
    }
    const ok = !!cur && yes.has(cur)
    for (const s of seen) (ok ? yes : no).add(s)
  }
  for (const k of parents.keys()) walk(k)
  return yes
}

/** 项目（Source、Plugins 下各插件的 Source）里 UCLASS 的类名 → 父类名（都不带 U / A 前缀）；选对象面板的离线类树也用 */
export async function nativeParents(root: string) {
  const files: string[] = []
  await headers(path.join(root, 'Source'), files)
  await headers(path.join(root, 'Plugins'), files)
  const parents = new Map<string, string>()
  for (let i = 0; i < files.length; i += 64) {
    const texts = await Promise.all(files.slice(i, i + 64).map((f) => readFile(f, 'utf8').catch(() => '')))
    for (const t of texts) if (t.includes('UCLASS')) parseDecls(t, parents)
  }
  return parents
}

/** 项目（Source、Plugins 下各插件的 Source）里所有 UserWidget 子类的类名（不带 U 前缀） */
export async function nativeWidgetClasses(root: string) {
  return widgetClasses(await nativeParents(root))
}
