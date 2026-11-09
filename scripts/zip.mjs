// 最小的 zip 写入（deflate），不引依赖：插件包就是一个普通 zip，面板的 server/plugins/zip.ts 能读 stored 和 deflate
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

/** 目录下所有文件，路径用 / 分隔，按名字排序（产物稳定） */
export function listFiles(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) listFiles(f, base, out)
    else if (e.isFile()) out.push(path.relative(base, f).split(path.sep).join('/'))
  }
  return out
}

/** 把 dir 打成 zip，条目放在 prefix 下（例如 'blender/'，空串就是包根） */
export function zipDir(dir, prefix = '') {
  const locals = []
  const centrals = []
  let offset = 0
  // 固定时间戳：同样的内容打出同样的包
  const time = 0
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const rel of listFiles(dir)) {
    const data = readFileSync(path.join(dir, rel))
    const name = Buffer.from(prefix + rel, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const useDeflate = packed.length < data.length
    const body = useDeflate ? packed : data
    const crc = crc32(data)
    const mode = statSync(path.join(dir, rel)).mode & 0o777
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // Unix，保留可执行位
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(useDeflate ? 8 : 0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const count = centrals.length / 2
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
