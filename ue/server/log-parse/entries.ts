/**
 * 日志文件按「条」解析：UE 写多行消息（调用栈、脚本报错、GPU 崩溃时那段多行 JSON）时只有第一行带
 * [时间][帧] 前缀，后面的续行什么前缀都没有。续行并进上一条，作为一条多行记录：时间只有一个，
 * 分类和级别沿用第一行，计数、按分类 / 级别筛选、文字搜索都按整条算（以前每个续行单独一条，网页上每行都补一遍时间）。
 */
export interface LogLine {
  seq: number
  time?: string
  category: string
  verbosity: string
  /** 多行记录的各行用 \n 连起来 */
  text: string
}

/**
 * [时间][帧] 前缀：时间可以是 UTC / 本地钟表时间（2026.11.23-11.49.53:123），也可以是 -LogTimes=SinceStart
 * 的秒数（带前导空格的 "   12.34"），都要认成前缀，不然整个文件的行全被当成续行
 */
const PREFIX = /^\[([\d.:\- ]+)\]\[\s*\d+\]/
const LINE = /^(\w+):\s(?:(Fatal|Error|Warning|Display|Log|Verbose|VeryVerbose):\s)?(.*)$/s

export function parseLine(raw: string, seq: number): LogLine {
  const p = PREFIX.exec(raw)
  const rest = p ? raw.slice(p[0].length) : raw
  const time = p?.[1].trim() || undefined
  const m = LINE.exec(rest)
  if (!m) return { seq, time, category: '', verbosity: 'Log', text: rest }
  return { seq, time, category: m[1], verbosity: m[2] ?? 'Log', text: m[3] }
}

/** 一条记录最多并多少行：几万行的大段转储并成一条网页也画不完，多的只记个数 */
const MAX_LINES = 400
const MAX_CHARS = 64 * 1024

/**
 * 逐行喂进来，凑够一条就吐出上一条（续行要等看到下一条的开头才知道上一条结束了），读完调 end() 取最后一条。
 * 判断续行：
 * - 带 [时间][帧] 前缀的一定是新的一条；
 * - 文件在用时间前缀（上一条有时间）时，没有前缀的就是续行；
 * - 没开时间前缀的日志（或文件开头还没开时间戳的那几行）按「分类: 」认：认得出是新的一条，认不出并进上一条。
 */
export function entryReader(moreNote: (n: number) => string) {
  let cur: (LogLine & { n: number; extra: number }) | undefined
  const done = () => {
    if (!cur) return undefined
    const { n: _, extra, ...l } = cur
    return extra ? { ...l, text: `${l.text}\n${moreNote(extra)}` } : l
  }
  return {
    push(raw: string, seq: number): LogLine | undefined {
      const timed = PREFIX.test(raw)
      if (cur && !timed && (cur.time || !LINE.test(raw))) {
        if (cur.n >= MAX_LINES || cur.text.length + raw.length > MAX_CHARS) cur.extra++
        else {
          cur.text += `\n${raw}`
          cur.n++
        }
        return undefined
      }
      const out = done()
      cur = { ...parseLine(raw, seq), n: 1, extra: 0 }
      return out
    },
    end() {
      const out = done()
      cur = undefined
      return out
    },
  }
}
