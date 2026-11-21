import path from 'node:path'
import { findEngine, installedEngines } from './engine-locate.ts'
import type { EngineInfo, UeProject } from './types.ts'
import { exists, readJson } from './util.ts'

/**
 * 新会话开头给 Agent 的「本项目引擎」事实（Agent 写代码能力分析 A4）：
 * 写 UE C++ 最常见的返工是凭记忆写引擎 API，Agent 在用户本机跑、能读引擎源码，但它不知道项目用哪个版本、源码在哪，
 * 只能去猜或者全盘找。插件本来就认得引擎（detect / engine-locate），这里把版本和目录写成一段事实，配合 ue-cpp-engine-api 技能。
 * 只给 C++ 项目（纯蓝图项目用不上）；发给 Agent 的提示词不翻译
 */

const SOURCE_LABEL: Record<string, string> = { launcher: 'Launcher 安装', source: '源码版', custom: '手动指定' }

/** 本机引擎列表要读注册表 / Launcher 清单：一个会话开头读一次够了，10 分钟内的新会话复用（模块状态：缓存，丢了重读） */
const ENGINES_TTL_MS = 10 * 60_000
let enginesCache: { at: number; list: Promise<{ version: string; dir: string }[]> } | undefined

function otherEngines() {
  if (!enginesCache || Date.now() - enginesCache.at > ENGINES_TTL_MS)
    enginesCache = { at: Date.now(), list: installedEngines().catch(() => []) }
  return enginesCache.list
}

/**
 * 项目现在的引擎和是不是 C++ 项目：登记时存下的可能已经过时（项目升了引擎版本、纯蓝图项目后来加了 Source），
 * 每个新会话按 .uproject 现在的内容重新判断；EngineAssociation 没变、存的目录还在时直接用存的，不再去找
 */
async function current(p: UeProject): Promise<{ engine: EngineInfo; cpp: boolean }> {
  const desc = await readJson<{ EngineAssociation?: string; Modules?: unknown[] }>(p.uproject, {})
  const association = desc.EngineAssociation ?? p.engine.association
  const cpp = p.cpp || exists(path.join(p.root, 'Source')) || (desc.Modules?.length ?? 0) > 0
  if (association === p.engine.association && p.engine.dir && exists(path.join(p.engine.dir, 'Engine')))
    return { engine: p.engine, cpp }
  const engine = await findEngine(p.uproject, association, p.engineDir).catch(() => p.engine)
  return { engine, cpp }
}

/** 本机其他引擎最多列几个：兼容多版本时一般就两三个，列多了只占提示词 */
const OTHERS_MAX = 4

export async function engineFacts(p: UeProject): Promise<string> {
  const { engine: e, cpp } = await current(p)
  if (!cpp) return ''
  const lines = ['## UE C++ 引擎']
  const src = e.dir ? path.join(e.dir, 'Engine', 'Source') : ''
  if (!e.dir) {
    lines.push(
      `没找到这个项目用的引擎目录（EngineAssociation：${e.association || '空'}${e.version ? `，推测是 ${e.version}` : ''}）。要查引擎 API 的签名而 UEToVS 也查不到时，请用户在 UE 页「权限与设置」里指定引擎目录，或贴出头文件里的声明，不要凭记忆写。`,
    )
  } else {
    const how = SOURCE_LABEL[e.source] ? `，${SOURCE_LABEL[e.source]}` : ''
    lines.push(
      exists(src)
        ? `本项目用的引擎是 ${e.version || e.association}${how}：引擎源码在 \`${src}\`，引擎插件在 \`${path.join(e.dir, 'Engine', 'Plugins')}\`。`
        : `本项目用的引擎是 ${e.version || e.association}${how}，目录 \`${e.dir}\`，但里面没有 Engine/Source（可能没装源码）：查不到签名时请用户贴出头文件里的声明。`,
    )
  }
  const others = (await otherEngines()).filter((x) => !e.dir || path.resolve(x.dir) !== path.resolve(e.dir))
  if (others.length)
    lines.push(
      `本机还装了：${others
        .slice(0, OTHERS_MAX)
        .map((x) => `${x.version} \`${x.dir}\``)
        .join('、')}（要同时兼容几个引擎版本时，每个版本的头文件都查）。`,
    )
  lines.push(
    '写或改调用引擎 API 的 C++、override 引擎虚函数、加 include 和 Build.cs 依赖之前，按 ue-cpp-engine-api 技能先查这个版本的真实签名（接了 UEToVS 就用 get_members / search_symbols scope=all / suggest_include，没有就 rg 上面的源码目录），不凭记忆写；编译报「不是成员、找不到标识符、参数不对、链接找不到符号」时也是先查定义再改，不换个名字再试。',
  )
  return lines.join('\n')
}
