import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText } from '@panel/web/src/components/ui/item-menu'

/**
 * 场景（含录制出来的）导出成 JSON：用户 2026-11-16 要把录到的指令拿出去用。
 * 场景本来就是场景根里的 JSON 文件，这里取原文（服务端 ext/gt/file action=raw），复制到剪贴板或存成文件；
 * 只读文件，编辑器没开也能用
 */
async function raw(project: string, root: string, rel: string) {
  return ppost<{ path: string; text: string }>(project, 'ext/gt/file', { root, path: rel, action: 'raw' })
}

export function copyScenarioJson(project: string, root: string, rel: string) {
  raw(project, root, rel)
    .then((r) => copyText(r.text))
    .catch((e: Error) => h().toast.error(e.message))
}

/** 浏览器下载：文件名就是场景文件名，内容原样（UE 写的 tab 缩进也保留） */
export function downloadScenarioJson(project: string, root: string, rel: string) {
  raw(project, root, rel)
    .then((r) => {
      const url = URL.createObjectURL(new Blob([r.text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = r.path.split('/').pop() || 'scenario.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      h().toast.success(t('已导出 {f}', { f: a.download }))
    })
    .catch((e: Error) => h().toast.error(e.message))
}
