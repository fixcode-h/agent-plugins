import { useMemo, useState } from 'react'
import { op, pget, ppost, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { isNumberType } from './model.ts'
import type { DetailsApi, Node } from './rows.tsx'

/** 这次在网页上改过的值（对象路径 | 属性路径 → 原值），换分区、换对象再回来也保留，行尾给重置箭头 */
const changed = new Map<string, unknown>()

/** 网页上填的文字换成交给桥接的值：布尔、数字按类型转，像 JSON 的按 JSON，其余原样交给桥接按 UE 文本格式（ImportText）写 */
function toValue(n: Node, raw: string): unknown {
  if (n.type === 'bool' || typeof n.value === 'boolean') return raw === 'true'
  if ((isNumberType(n.type ?? '') || typeof n.value === 'number') && raw.trim() !== '' && !isNaN(Number(raw)))
    return Number(raw)
  if (/^[[{]/.test(raw.trim())) {
    try {
      return JSON.parse(raw)
    } catch {
      // 不是 JSON 就按 UE 的文本格式交给桥接
    }
  }
  return raw
}

/**
 * 一个对象的细节面板动作：改值（记原值好重置）、数组加删、固定到监视、展开时取完整值。
 * Actor 的「变换」三行改的是根组件，用同一套，只是 objPath 不一样
 */
export function useDetailsApi(
  objPath: string,
  {
    q,
    reload,
    onReplicatedClient,
    openRef,
    viewOnly,
  }: {
    q: string
    reload: () => void
    onReplicatedClient?: (prop: string) => void
    openRef: (p: string) => (() => void) | undefined
    viewOnly?: boolean
  },
): DetailsApi {
  const { project, target } = useUe()
  const { toast } = h()
  const { busy, run } = useAction()
  const [version, setVersion] = useState(0)
  const after = () => {
    setVersion((v) => v + 1)
    reload()
  }
  return useMemo<DetailsApi>(
    () => ({
      q,
      busy,
      version,
      changed: (p) => changed.get(`${objPath}|${p}`),
      isChanged: (p) => changed.has(`${objPath}|${p}`),
      setValue: (n, raw) =>
        void run(n.path, async () => {
          if (n.readOnly) return
          const r = await op<{ prev: unknown; replicated?: boolean; client?: boolean }>(
            project.id,
            'set',
            { path: objPath, prop: n.path, value: toValue(n, raw) },
            target,
          )
          const k = `${objPath}|${n.path}`
          if (!changed.has(k)) changed.set(k, r.prev)
          if (r.replicated && r.client) onReplicatedClient?.(n.path)
          after()
        }),
      reset: (n) =>
        void run(n.path, async () => {
          const k = `${objPath}|${n.path}`
          if (!changed.has(k)) return
          await op(project.id, 'set', { path: objPath, prop: n.path, value: changed.get(k) }, target)
          changed.delete(k)
          after()
        }),
      // 数组按钮不记原值：整体写回会丢掉实例化子对象，要撤回用操作记录或「放弃改动」
      arrayOp: (prop, action, index) =>
        void run(`${prop}#array`, async () => {
          await op(
            project.id,
            'set',
            { path: objPath, prop, array: action, ...(index !== undefined ? { index } : {}) },
            target,
          )
          after()
        }),
      pin: viewOnly
        ? undefined
        : (prop) =>
            void run('pin', async () => {
              const local = await pget<{ watch: { path: string; prop: string }[] }>(project.id, 'local')
              if (local.watch.some((w) => w.path === objPath && w.prop === prop))
                return toast.success(t('已经在监视里了'))
              await ppost(project.id, 'local', { watch: [...local.watch, { path: objPath, prop }] })
              toast.success(t('已固定到监视：{p}', { p: prop }))
            }),
      openRef,
      loadFull: async (p) =>
        (await op<{ value: unknown }>(project.id, 'get', { path: objPath, prop: p }, target)).value,
    }),
    // run、toast 每次渲染都是新的引用，按会变的值重建就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [objPath, q, busy, version, project.id, target.instance, target.world, viewOnly],
  )
}
