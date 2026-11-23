import { readFile } from 'node:fs/promises'
import { projectHeaders } from '../../../search-index/native-widgets.ts'
import { projectMounts } from '../../../search-index/mounts.ts'
import { searchIndex } from '../../../search-index/index.ts'
import { shortClass } from '../../../search-index/uetovs.ts'
import type { UeProject } from '../../../types.ts'
import { t } from '../../../util.ts'
import type { VarGroup, VarItem } from '../../gt-author/lua-vars.ts'
import { assetFile } from './classes.ts'
import { readBpTags } from './uasset-tags.ts'

/**
 * 不连 UE 读一个类的成员（用户 2026-11-23：编辑器没开时，GM 对象调用「只按类」的对象也要列得出成员）。
 * 只读项目和项目插件的头文件：按 `UPROPERTY(...)` / `UFUNCTION(...)` 后面的声明拼出属性和函数，顺着 `: public 父类` 往上，
 * 走到引擎类（项目里没有它的头文件）就停；蓝图读 .uasset 开头的父类标签一路找到原生父类，蓝图自己的变量和函数读不出来。
 * 只是给人看「有什么、参数是什么」，调用和改值照旧要连上 UE。宏包着、模板生成的写法认不出就当没有。
 */

/** 往上最多几层（防绕圈） */
const MAX_CHAIN = 12
/** 类名 → 头文件的表多久重建一次（和离线类树一样） */
const FRESH_MS = 30_000

const classMap = new Map<string, { at: number; map: Promise<Map<string, string>> }>()

/** 项目里 UCLASS 的类名（去掉 U / A 前缀）→ 头文件 */
function classFiles(root: string) {
  const hit = classMap.get(root)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.map
  const map = (async () => {
    const out = new Map<string, string>()
    const files = await projectHeaders(root)
    for (let i = 0; i < files.length; i += 64) {
      const batch = files.slice(i, i + 64)
      const texts = await Promise.all(batch.map((f) => readFile(f, 'utf8').catch(() => '')))
      texts.forEach((text, k) => {
        if (!text.includes('UCLASS')) return
        for (const m of text.matchAll(/\bclass\s+(?:\w+_API\s+)?[UA]?(\w+)\s*(?:final\s*)?:\s*public\s+\w+/g))
          if (!out.has(m[1])) out.set(m[1], batch[k])
      })
    }
    return out
  })()
  classMap.set(root, { at: Date.now(), map })
  return map
}

/** 注释和字符串换成等长空格：数括号时不被里面的 { ( 带偏，位置还和原文一一对应 */
function mask(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) =>
    m.replace(/[^\n]/g, ' '),
  )
}

/** 从 open 处（是 open 字符）找到配对的 close，返回 close 的位置；找不到 -1 */
function closeOf(masked: string, at: number, open: string, close: string) {
  let depth = 0
  for (let i = at; i < masked.length; i++) {
    const c = masked[i]
    if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

/** 按顶层逗号切（模板尖括号、括号里的逗号不切） */
function splitTop(s: string) {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if ('<([{'.includes(c)) depth++
    else if ('>)]}'.includes(c)) depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

/** 声明前面紧挨着的注释（/** *\/ 或连续的 //）取第一句，当说明 */
function docBefore(text: string, at: number) {
  const before = text.slice(Math.max(0, at - 2000), at).replace(/\s+$/, '')
  const block = /\/\*\*?([\s\S]*?)\*\/$/.exec(before)
  const raw = block
    ? block[1]
    : (/(?:^|\n)((?:[ \t]*\/\/[^\n]*\n?)+)$/.exec(before)?.[1] ?? '').replace(/^[ \t]*\/\/+/gm, '')
  const line = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
    .find((l) => l && !l.startsWith('@'))
  return line ? line.slice(0, 160) : undefined
}

/** UPROPERTY(...) 里的 Category */
const categoryOf = (spec: string) => /\bCategory\s*=\s*"?([^",)]+)"?/i.exec(spec)?.[1]?.trim()
const READ_ONLY = /\b(BlueprintReadOnly|VisibleAnywhere|VisibleInstanceOnly|VisibleDefaultsOnly)\b/

/** 一个参数 `const FString& Name = TEXT("x")` → 名字、类型 */
function paramOf(raw: string) {
  const noDefault = raw.replace(/=[\s\S]*$/, '').trim()
  const m = /^(.*?)([A-Za-z_]\w*)\s*$/.exec(noDefault)
  if (!m) return { name: noDefault, type: '' }
  return { name: m[2], type: m[1].trim().replace(/\s+/g, ' ') }
}

const CONSTRUCTIBLE =
  /^(const\s+)?(int\d*|uint\d*|float|double|bool|FString|FName|FText|FVector|FRotator|FLinearColor|FColor)\b/

/** 纯逻辑（单测用）：头文件里某个类的父类和 UPROPERTY / UFUNCTION；没找到这个类 undefined */
export function parseUClass(text: string, cls: string): { parent?: string; items: VarItem[] } | undefined {
  const masked = mask(text)
  const head = new RegExp(
    `\\bclass\\s+(?:\\w+_API\\s+)?[UA]?${cls}\\s*(?:final\\s*)?(?::\\s*public\\s+[UA]?(\\w+))?[^;{]*\\{`,
  )
  const m = head.exec(masked)
  if (!m) return undefined
  const open = m.index + m[0].length - 1
  const end = closeOf(masked, open, '{', '}')
  const body = end < 0 ? masked.slice(open) : masked.slice(open, end)
  const items: VarItem[] = []
  for (const mm of body.matchAll(/\b(UPROPERTY|UFUNCTION)\s*\(/g)) {
    const at = open + mm.index
    const specOpen = at + mm[0].length - 1
    const specEnd = closeOf(masked, specOpen, '(', ')')
    if (specEnd < 0) continue
    const spec = text.slice(specOpen + 1, specEnd)
    const note = docBefore(text, at)
    // 声明到分号或函数体为止
    const rest = masked.slice(specEnd + 1)
    if (mm[1] === 'UPROPERTY') {
      const stop = rest.search(/[;{]/)
      if (stop < 0) continue
      const decl = text
        .slice(specEnd + 1, specEnd + 1 + stop)
        .replace(/=[\s\S]*$/, '')
        .replace(/:\s*\d+\s*$/, '')
        .trim()
      const p = paramOf(decl)
      if (!p.type) continue
      const cat = categoryOf(spec)
      items.push({
        name: p.name,
        path: p.name,
        type: p.type,
        kind: 'prop',
        readOnly: READ_ONLY.test(spec),
        ...(note ? { note } : {}),
        ...(cat ? { cat } : {}),
      })
      continue
    }
    const paren = rest.indexOf('(')
    if (paren < 0) continue
    const pEnd = closeOf(rest, paren, '(', ')')
    if (pEnd < 0) continue
    const sig = text
      .slice(specEnd + 1, specEnd + 1 + paren)
      .replace(/\b(virtual|static|inline|FORCEINLINE|explicit)\b/g, '')
      .trim()
    const nm = /^(.*?)([A-Za-z_]\w*)\s*$/.exec(sig)
    if (!nm) continue
    const ret = nm[1].trim().replace(/\s+/g, ' ') || 'void'
    const args = splitTop(text.slice(specEnd + 2 + paren, specEnd + 1 + pEnd)).map(paramOf)
    const shown = args.map((a) => `${a.name}: ${a.type}`).join(', ')
    items.push({
      name: nm[2],
      path: nm[2],
      type: ret,
      kind: 'fn',
      readOnly: /\bBlueprintPure\b/.test(spec) || /\bconst\b/.test(rest.slice(pEnd + 1).split(/[;{]/)[0]),
      sig: `(${shown})${ret === 'void' ? '' : ` → ${ret}`}`,
      args: args.map((a) => ({
        name: a.name,
        type: a.type,
        constructible: CONSTRUCTIBLE.test(a.type),
        // 非 const 引用是 UE 的输出参数，调用时不用填
        ...(/&\s*$/.test(a.type) && !/^const\b/.test(a.type) ? { out: true } : {}),
        ...(/\*\s*$|^TObjectPtr</.test(a.type) ? { object: true } : {}),
      })),
      ...(note ? { note } : {}),
    })
  }
  return { parent: m[1], items }
}

/** 类名规整：资源路径、`_C`、U / A 前缀都去掉 */
const bare = (cls: string) => {
  const c = shortClass(cls.trim().split('/').at(-1) ?? '')
  return /^[UA][A-Z]/.test(c) ? c.slice(1) : c
}

/** 蓝图类 → 往上的蓝图名（自己在前）和第一个原生父类；不是蓝图（索引里没有）时 undefined */
async function bpChain(p: UeProject, cls: string) {
  const name = shortClass(cls.trim().split('/').at(-1) ?? '')
  const idx = await searchIndex(p)
  const mounts = await projectMounts(p.root)
  const bps: string[] = []
  let cur = name
  for (let i = 0; i < MAX_CHAIN && cur && !bps.includes(cur); i++) {
    const hit = idx.assets.find((a) => a[0].slice(a[0].lastIndexOf('.') + 1) === cur)
    if (!hit) break
    bps.push(cur)
    // UEToVS 的索引记了原生父类（第三项）；没有时读 .uasset 开头的标签，直接父类是蓝图就接着往上
    const file = assetFile(hit[0], mounts)
    const tags = file ? await readBpTags(file) : undefined
    const parent = tags?.parent ?? ''
    if (parent.startsWith('/Script/') || !parent) return { bps, native: bare(tags?.native || parent || hit[2] || '') }
    cur = shortClass(parent)
  }
  return bps.length ? { bps, native: '' } : undefined
}

export interface OfflineMembers {
  groups: VarGroup[]
  /** 给界面看的：哪些成员读不出来（蓝图自己的、引擎类的） */
  note?: string
}

/** 一个 C++ / 蓝图类离线能读到的成员：项目头文件里的那几层，一层一组（组名是类名，方法页按它分组） */
export async function cppMembers(p: UeProject, cls: string): Promise<OfflineMembers> {
  const files = await classFiles(p.root)
  let cur = bare(cls)
  const notes: string[] = []
  if (!files.has(cur)) {
    const bp = await bpChain(p, cls).catch(() => undefined)
    if (bp) {
      notes.push(t('蓝图 {names} 自己的变量和函数要连上编辑器才读得到', { names: bp.bps.join('、') }))
      cur = bp.native
    }
  }
  const groups: VarGroup[] = []
  const seen = new Set<string>()
  for (let i = 0; i < MAX_CHAIN && cur && !seen.has(cur); i++) {
    seen.add(cur)
    const file = files.get(cur)
    if (!file) {
      notes.push(t('引擎类 {name} 及以上的成员要连上编辑器才列得出', { name: cur }))
      break
    }
    const parsed = parseUClass(await readFile(file, 'utf8').catch(() => ''), cur)
    if (!parsed) break
    if (parsed.items.length) groups.push({ src: 'cpp', title: cur, class: cur, items: parsed.items })
    cur = parsed.parent ?? ''
  }
  if (!groups.length && !notes.length) notes.push(t('项目源码里没找到这个类'))
  return { groups, ...(notes.length ? { note: notes.join('；') } : {}) }
}
