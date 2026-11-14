import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'

/**
 * 解压 UELink 的源码包（zip，存储或 deflate）：插件包里不带第三方解压库，UELink 的包是自己出的、格式简单，按中央目录读就够。
 * 防目录穿越：条目路径带 .. 或是绝对路径的直接报错，不写到目标目录外面。
 */
export async function unzipTo(buf: Buffer, dest: string) {
  // 中央目录结束记录在最后 22 字节（不带注释时），带注释时往前找签名
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('不是 zip 文件')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const root = path.resolve(dest)
  const files: string[] = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue
    const target = path.resolve(root, name)
    if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || !target.startsWith(root + path.sep))
      throw new Error(`zip 里的路径不安全：${name}`)
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip 文件头损坏')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + compSize)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null
    if (!data) throw new Error(`zip 用了不支持的压缩方式 ${method}：${name}`)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
    files.push(name)
  }
  return files
}
