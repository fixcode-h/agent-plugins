/**
 * ue_python 的安全网（不改 UELink，只在面板这边包一层）：
 * - 用户代码放进 unreal.ScopedEditorTransaction 里执行，事务标题带「AgentPanel <id>」，
 *   和 UELink 自己的事务同一个格式，所以 ue_undo 能用 asset.undo 按 id 整次撤回（之后编辑器里又有别的修改时 UELink 会拒绝）；
 * - 执行前后各取一次没保存的包，多出来的就是这次脚本改的，记进操作记录和对话的占用。
 * 代码另存一个文件再 exec，脚本里的行号和报错位置跟 Agent 写的一致
 */

/** 和 UELink FTx 的 id 一样：8 位小写十六进制 */
export function pythonTxId() {
  return Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0')
}

/** 包一层事务的入口脚本：codeFile 是 Agent 的代码文件，路径一律正斜杠 */
export function pythonWrapper(codeFile: string, txId: string) {
  const file = JSON.stringify(codeFile.replaceAll('\\', '/'))
  return [
    'import unreal',
    `with open(${file}, encoding="utf-8") as _ap_f:`,
    '    _ap_src = _ap_f.read()',
    `with unreal.ScopedEditorTransaction("AgentPanel ${txId}: python"):`,
    `    exec(compile(_ap_src, ${file}, "exec"), {"__name__": "__main__", "__file__": ${file}})`,
    '',
  ].join('\n')
}

/** 执行后比执行前多出来的没保存的包 */
export function newlyDirty(before: string[], after: string[]) {
  const had = new Set(before)
  return after.filter((p) => !had.has(p))
}
