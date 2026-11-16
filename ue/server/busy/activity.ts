import { open, stat } from 'node:fs/promises'

/**
 * 编辑器忙（游戏线程卡在同步加载、编译着色器、长帧里，UELink 的 /info 几秒没回应）时，从它的日志尾部认出在忙什么。
 * 用户 2026-11-16：编辑器同步加载时网页显示「1 个进程连不上」「UE 没在运行」，还提示再启动一个编辑器。
 * 进程活着、只是不回应时不是断开：网页显示「编辑器忙」，耐心等它回来；这里只负责给出「在忙什么」的线索。
 *
 * 只返回种类和原文片段，不拼中文句子：文案在网页里按种类翻译（界面文案走 t()）
 */
export type BusyKind = 'map' | 'shaders' | 'assets' | 'ddc' | 'registry' | 'compile' | 'save'

export interface BusyGuess {
  /** 认出来的事；认不出时没有，网页只显示最后一行日志 */
  kind?: BusyKind
  /** 地图名、资源路径或剩余着色器个数 */
  detail?: string
  /** 日志最后一行（去掉时间戳前缀，最多 200 字） */
  line?: string
}

/** 「[2026.11.16-07.33.15:123][  0]LogStreaming: …」开头的时间戳和帧号 */
const PREFIX = /^(?:\[[^\]]*\]){1,2}\s*/
const PKG = /(\/(?:Game|Engine|Script|[A-Z][\w-]*)\/[^\s'"(),]+)/

const RULES: { kind: BusyKind; re: RegExp; detail?: (m: RegExpExecArray, line: string) => string | undefined }[] = [
  {
    kind: 'shaders',
    re: /shaders? left to compile:?\s*(\d+)|Compiling\s+(\d+)\s+shaders?/i,
    detail: (m) => m[1] ?? m[2],
  },
  {
    kind: 'map',
    re: /LoadMap:\s*(\S+)|Bringing World\s+(\S+)|LoadMap\(|LogWorldPartition.*Load/i,
    detail: (m, l) => m[1] ?? m[2] ?? PKG.exec(l)?.[1],
  },
  { kind: 'compile', re: /LogLiveCoding|LogHotReload|Compiling game modules/i },
  { kind: 'save', re: /LogSavePackage|LogFileHelpers.*Sav|Saving package/i, detail: (_m, l) => PKG.exec(l)?.[1] },
  { kind: 'ddc', re: /LogDerivedDataCache|\bDDC\b|LogZen/i },
  { kind: 'registry', re: /LogAssetRegistry|Scanning (?:assets|paths)|Premade AssetRegistry/i },
  {
    kind: 'assets',
    re: /LogStreaming|LogLinker|LoadPackage|LogUObjectGlobals|Loading package|LogAsyncLoading|FlushAsyncLoading/i,
    detail: (_m, l) => PKG.exec(l)?.[1],
  },
]

/** 只看最后几行：太早的行和现在卡住的事未必有关 */
const RECENT = 12

/** 从日志尾部的文字认出在忙什么（纯函数，单测直接喂文本） */
export function guessBusy(text: string): BusyGuess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(PREFIX, '').trim())
    .filter(Boolean)
  if (!lines.length) return {}
  const out: BusyGuess = { line: lines[lines.length - 1].slice(0, 200) }
  for (const line of lines.slice(-RECENT).reverse()) {
    for (const r of RULES) {
      const m = r.re.exec(line)
      if (!m) continue
      out.kind = r.kind
      const d = r.detail?.(m, line)
      if (d) out.detail = d.slice(0, 160)
      return out
    }
  }
  return out
}

/** 读日志文件最后 32 KB 认一遍；quietSec 是日志多久没写新内容（卡死时一直涨，加载时偶尔会动） */
export async function busyFromLog(file: string): Promise<BusyGuess & { quietSec?: number }> {
  const st = await stat(file).catch(() => null)
  if (!st) return {}
  const size = Math.min(st.size, 32 * 1024)
  const fh = await open(file, 'r').catch(() => null)
  if (!fh) return {}
  try {
    const buf = Buffer.alloc(size)
    await fh.read(buf, 0, size, st.size - size)
    // 从第一个整行开始：截在半行中间的那段不要
    const text = buf.toString('utf8')
    const start = st.size > size ? text.indexOf('\n') + 1 : 0
    return { ...guessBusy(text.slice(start)), quietSec: Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000)) }
  } finally {
    await fh.close()
  }
}
