import { open, stat } from 'node:fs/promises'

/**
 * 不启动 UE 读蓝图的父类（用户 2026-11-21：类树不该要求编辑器开着）。
 * .uasset 的资产注册表数据（AssetRegistryData）写在导出对象之前，里面有字符串标签 ParentClass / NativeParentClass，
 * 值形如 `/Script/CoreUObject.Class'/Script/UMG.UserWidget'` 或 `...BlueprintGeneratedClass'/Game/UI/W_Base.W_Base_C'`。
 * 不按包版本解析文件头（各引擎版本的摘要格式不同），只在开头一段里按文字找标签：
 * 先读 64KB，名字表里没有 GeneratedClass 的不是蓝图，直接跳过；是蓝图再往后读，最多 1MB。
 */

const FIRST = 64 * 1024
const MAX = 1024 * 1024

export interface BpTags {
  /** 直接父类：`/Script/UMG.UserWidget` 或 `/Game/UI/W_Base.W_Base_C` */
  parent?: string
  /** 原生父类 */
  native?: string
}

/** 在一段文字（按 latin1 解码的字节）里找某个标签后面紧跟的 '路径' 值 */
function tagValue(text: string, tag: string): string | undefined {
  const re = new RegExp(`${tag}[\\s\\S]{0,96}?'(/[^'\\x00]{1,400})'`, 'g')
  for (const m of text.matchAll(re)) {
    // NativeParentClass 里也含 ParentClass：找 ParentClass 时跳过前面紧挨着 Native 的
    if (tag === 'ParentClass' && text.slice(Math.max(0, m.index - 6), m.index) === 'Native') continue
    return m[1]
  }
  return undefined
}

/** 纯逻辑（单测用）：一段字节里的父类标签；不是蓝图返回 undefined */
export function parseBpTags(buf: Buffer): BpTags | undefined {
  const text = buf.toString('latin1')
  if (!text.includes('GeneratedClass')) return undefined
  const parent = tagValue(text, 'ParentClass')
  const native = tagValue(text, 'NativeParentClass')
  return parent || native ? { parent, native } : undefined
}

const cache = new Map<string, { key: string; tags: BpTags | null }>()

/** 读一个 .uasset 的父类标签（按修改时间和大小缓存）；读不到、不是蓝图返回 undefined */
export async function readBpTags(file: string): Promise<BpTags | undefined> {
  const st = await stat(file).catch(() => undefined)
  if (!st?.isFile()) return undefined
  const key = `${st.mtimeMs}:${st.size}`
  const hit = cache.get(file)
  if (hit?.key === key) return hit.tags ?? undefined
  let tags: BpTags | undefined
  const fh = await open(file, 'r').catch(() => undefined)
  if (fh) {
    try {
      const size = Math.min(st.size, MAX)
      const first = Buffer.alloc(Math.min(size, FIRST))
      await fh.read(first, 0, first.length, 0)
      if (first.toString('latin1').includes('GeneratedClass')) {
        tags = parseBpTags(first)
        if (!tags?.parent && size > first.length) {
          const all = Buffer.alloc(size)
          first.copy(all)
          await fh.read(all, first.length, size - first.length, first.length)
          tags = parseBpTags(all)
        }
      }
    } finally {
      await fh.close()
    }
  }
  cache.set(file, { key, tags: tags ?? null })
  return tags
}
