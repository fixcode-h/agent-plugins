// 把自带的 UELink 源码换成公共库（fixcode-h/UELink）发布的某一版：node ue/scripts/sync-uelink.mjs [版本]
// 不写版本就取最新正式版。从 Release 下载源码包，按 manifest.json 的 sha256 校验后解压到 ue/bridge/UELink/。
// UELink 的 C++ 只在 UELink 仓库里改，这里的副本不手改（见 bridge/VENDORED.md）。
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipTo } from '../server/unzip.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const want = process.argv[2]
const base = 'https://github.com/fixcode-h/UELink/releases'
const manifestUrl = want ? `${base}/download/v${want}/manifest.json` : `${base}/latest/download/manifest.json`

const get = async (url) => {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const manifest = JSON.parse((await get(manifestUrl)).toString('utf8'))
const zip = await get(manifest.url)
const sha = createHash('sha256').update(zip).digest('hex')
if (sha !== manifest.sha256) throw new Error(`sha256 对不上：清单 ${manifest.sha256}，下载的 ${sha}`)
const tmp = mkdtempSync(path.join(os.tmpdir(), 'uelink-'))
try {
  await unzipTo(zip, tmp)
  const src = path.join(tmp, 'UELink')
  if (!existsSync(path.join(src, 'UELink.uplugin'))) throw new Error('源码包里没有 UELink/UELink.uplugin')
  const dest = path.join(HERE, '..', 'bridge', 'UELink')
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  writeFileSync(path.join(HERE, '..', 'bridge', 'uelink.json'), `${JSON.stringify({ version: manifest.version, sha256: manifest.sha256 }, null, 2)}\n`)
  console.log(`✓ ue/bridge/UELink 换成了 UELink ${manifest.version}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
