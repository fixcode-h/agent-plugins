import { spawn } from 'node:child_process'
import path from 'node:path'

/**
 * 在本机的资源管理器 / 访达里显示一个文件（右键菜单「在文件夹中显示」都走这里）。
 * 面板只在本机跑（127.0.0.1），打开的就是用户自己的文件管理器；Linux 没有统一的「选中文件」，只打开所在目录
 */
export function revealInFolder(file: string) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [`/select,${file}`]]
      : process.platform === 'darwin'
        ? ['open', ['-R', file]]
        : ['xdg-open', [path.dirname(file)]]
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

/** 交给系统默认程序打开文件（.lua 一般是用户设的编辑器）。打不开（没有关联程序）时静默：用户看得到没反应，再用复制路径 */
export function openWithSystem(file: string) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '""', file]]
      : process.platform === 'darwin'
        ? ['open', [file]]
        : ['xdg-open', [file]]
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)
  child.unref()
}
