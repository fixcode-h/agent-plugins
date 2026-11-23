import { open, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { entryReader, isErrorLevel, isWarningLevel, type LogLine } from '../log-parse/entries.ts'

/**
 * 一个日志文件的增量读取（可统一能力盘点第 9 项）：记住读到哪，只读新写的部分、按条解析，最近的若干条留在内存里。
 * 以前日志页没开 UE 时每秒把文件尾 2 MB 整段重读重解析，判忙每次再读 32 KB 用另一套正则认行首；
 * 现在日志页、判忙共用这一份（registry.ts 按文件给同一个实例），新写的内容由 feed.ts 盯目录后推给页面。
 *
 * - 第一次读、文件换了（UE 启动时把旧日志改名成 -backup 再新建）或变短了（被清空）：从文件尾最多 initBytes 开始，epoch 加一；
 *   页面拿着旧 epoch 的游标来取时整份换掉。
 * - 一次新写的内容超过 initBytes（编译着色器时日志涨得快）：跳到最后 initBytes，中间的不解析（错误 / 警告计数也就不含那段）。
 * - 每次读到文件末尾就把最后一条结算掉：没开 UE 时文件不会再长；开着时 UE 一条多行消息是一次写进去的，很少被拆开。
 */
export interface TailOptions {
  /** 内存里最多留几条 */
  keep?: number
  /** 第一次 / 换文件后从文件尾往前读多少字节 */
  initBytes?: number
  moreNote?: (n: number) => string
}

export class LogTail {
  /** 文件换了或被清空时加一 */
  epoch = 0
  errors = 0
  warnings = 0
  size = 0
  mtimeMs = 0
  private entries: LogLine[] = []
  private offset = -1
  private ident = ''
  private line = 0
  private partial = ''
  /** 从文件中间开始读时第一行是半行，丢掉 */
  private skipHalf = false
  private decoder = new StringDecoder('utf8')
  private reader: ReturnType<typeof entryReader>
  private running?: Promise<boolean>
  private readonly keep: number
  private readonly initBytes: number

  constructor(
    readonly file: string,
    private readonly o: TailOptions = {},
  ) {
    this.keep = o.keep ?? 5000
    this.initBytes = o.initBytes ?? 2 * 1024 * 1024
    this.reader = entryReader(o.moreNote ?? ((n) => `… (+${n})`))
  }

  /** 读新写的部分；同时调用的合成一次。返回有没有新内容（或换了文件） */
  refresh(): Promise<boolean> {
    this.running ??= this.read().finally(() => (this.running = undefined))
    return this.running
  }

  private reset(start: number) {
    this.epoch++
    this.entries = []
    this.errors = 0
    this.warnings = 0
    this.jump(start)
  }

  /** 从 start 接着读：丢掉半行和半条（start > 0 时第一行是半行） */
  private jump(start: number) {
    this.offset = start
    this.partial = ''
    this.decoder = new StringDecoder('utf8')
    this.reader = entryReader(this.o.moreNote ?? ((n) => `… (+${n})`))
    this.skipHalf = start > 0
  }

  private async read(): Promise<boolean> {
    const st = await stat(this.file).catch(() => null)
    if (!st) {
      const had = this.offset > 0 || this.entries.length > 0
      if (had) this.reset(0)
      this.offset = 0
      this.size = 0
      return had
    }
    this.size = st.size
    this.mtimeMs = st.mtimeMs
    // 文件身份：改名换新文件后 ino / 创建时间会变（Windows 上 ino 也有值）
    const ident = `${st.ino}:${Math.round(st.birthtimeMs)}`
    let changed = false
    if (this.offset < 0 || ident !== this.ident || st.size < this.offset) {
      this.ident = ident
      this.reset(Math.max(0, st.size - this.initBytes))
      changed = true
    } else if (st.size - this.offset > this.initBytes) this.jump(st.size - this.initBytes)
    if (st.size <= this.offset) return changed
    const fh = await open(this.file, 'r')
    try {
      const CHUNK = 1024 * 1024
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - this.offset))
      while (this.offset < st.size) {
        const want = Math.min(buf.length, st.size - this.offset)
        const { bytesRead } = await fh.read(buf, 0, want, this.offset)
        if (!bytesRead) break
        this.offset += bytesRead
        this.feed(this.decoder.write(buf.subarray(0, bytesRead)))
      }
    } finally {
      await fh.close()
    }
    // 读到末尾：最后一条结算掉（半行留着等下次）
    this.take(this.reader.end())
    return true
  }

  private feed(text: string) {
    const parts = (this.partial + text).split('\n')
    this.partial = parts.pop() ?? ''
    for (const raw0 of parts) {
      const raw = raw0.endsWith('\r') ? raw0.slice(0, -1) : raw0
      this.line++
      if (this.skipHalf) {
        this.skipHalf = false
        continue
      }
      if (raw) this.take(this.reader.push(raw, this.line))
    }
  }

  private take(l: LogLine | undefined) {
    if (!l) return
    if (isErrorLevel(l.verbosity)) this.errors++
    else if (isWarningLevel(l.verbosity)) this.warnings++
    this.entries.push(l)
    if (this.entries.length > this.keep * 1.2) this.entries.splice(0, this.entries.length - this.keep)
  }

  /** 游标之后的条目（最多 limit 条，取最新的）；epoch 不对（换过文件）或没给游标时给最后 limit 条并标 reset */
  since(cursor: number, epoch: number | undefined, limit: number) {
    const reset = !cursor || epoch !== this.epoch
    const from = reset ? this.entries : this.entries.filter((l) => l.seq > cursor)
    const lines = from.slice(-limit)
    const last = this.entries[this.entries.length - 1]
    return { lines, cursor: last?.seq ?? cursor, epoch: this.epoch, reset }
  }

  /** 最后 n 条 */
  recent(n: number) {
    return this.entries.slice(-n)
  }
}
