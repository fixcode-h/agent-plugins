import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createGunzip } from 'node:zlib'

/**
 * 解 npm 的 .tgz 包（ustar，可能带 pax 头）：边解压边挑，只把 `pick` 认领的文件写出来。
 * onnxruntime-node 的包带着六个平台的二进制，整包解开好几百 MB，这里只落当前平台那几个文件；
 * 不为这个拉 tar 库进插件包。条目路径带 .. 或绝对路径的直接报错，不写到目标目录外面。
 * 按块流式处理：不认领的条目直接跳过，不把整个包读进内存。
 */
export async function extractTgz(file: string, dest: string, pick: (name: string) => string | undefined) {
  const root = path.resolve(dest)
  let header = Buffer.alloc(0)
  /** 当前条目还剩多少字节（含补齐到 512 的部分）、有效内容多长、收集到哪 */
  let left = 0
  let size = 0
  let parts: Buffer[] | undefined
  let onDone: ((body: Buffer) => Promise<void>) | undefined
  let paxPath: string | undefined
  let written = 0

  const startEntry = (h: Buffer) => {
    const field = (a: number, b: number) => h.toString('utf8', a, b).replace(/\0.*$/s, '')
    size = parseInt(field(124, 136).trim() || '0', 8)
    left = Math.ceil(size / 512) * 512
    const type = String.fromCharCode(h[156] || 48)
    const prefix = field(345, 500)
    const name = (paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))).replace(/\\/g, '/')
    paxPath = undefined
    parts = undefined
    onDone = undefined
    if (type === 'x') {
      parts = []
      // pax 扩展头：「长度 path=值\n」，只认 path（长文件名）
      onDone = async (body) => {
        paxPath = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1]
      }
    } else if (type === '0' || type === '7') {
      const to = pick(name)
      if (!to) return
      const target = path.resolve(root, to)
      if (path.isAbsolute(to) || to.split(/[\\/]/).includes('..') || !target.startsWith(root + path.sep))
        throw new Error(`压缩包里的路径不安全：${name}`)
      parts = []
      onDone = async (body) => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, body)
        written++
      }
    }
  }

  const finishEntry = async () => {
    if (onDone && parts) await onDone(Buffer.concat(parts).subarray(0, size))
    parts = undefined
    onDone = undefined
  }

  const gunzip = createReadStream(file).pipe(createGunzip())
  for await (const raw of gunzip) {
    let chunk = raw as Buffer
    while (chunk.length) {
      if (left > 0) {
        const n = Math.min(left, chunk.length)
        parts?.push(chunk.subarray(0, n))
        chunk = chunk.subarray(n)
        left -= n
        if (left === 0) await finishEntry()
        continue
      }
      const need = 512 - header.length
      header = Buffer.concat([header, chunk.subarray(0, need)])
      chunk = chunk.subarray(need)
      if (header.length < 512) break
      const h = header
      header = Buffer.alloc(0)
      if (h.every((b) => b === 0)) continue
      startEntry(h)
      if (left === 0) await finishEntry()
    }
  }
  if (left > 0) throw new Error('压缩包不完整')
  return written
}
