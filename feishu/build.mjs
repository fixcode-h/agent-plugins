// 飞书插件的构建钩子（scripts/build.mjs 在通用步骤之后调用 extra(out)）：
// 把 PATH 拦截垫片 bin/（lark-cli、lark-cli.cmd）原样放进包里；可执行位在插件启动时补（zip 不带权限位）
import { cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function extra(out) {
  cpSync(path.join(HERE, 'bin'), path.join(out, 'bin'), { recursive: true })
}
