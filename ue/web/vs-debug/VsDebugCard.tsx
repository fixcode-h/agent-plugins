import { useState } from 'react'
import { useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Confirm } from '../ui.tsx'
import { openVs, vsOp } from './api.ts'
import { loadParams, saveParams, type LaunchParams } from './model.ts'
import { OpenVsChooser } from './OpenVsChooser.tsx'
import { VsDebugView } from './VsDebugView.tsx'

/**
 * UE 页的「VS 调试」卡片：显示项目状态里的 vsDebug（服务端 server/vs-debug/ 定时取，和 Agent 的 ue_vs_* 工具看同一份），
 * 按钮转成 p/<id>/vs-debug 的操作。状态本来就跟着 UE 页的状态刷新（UePage 3 秒一次），这里不另起轮询，
 * 操作完立刻 reload 一次让结果马上出来。出错 toast 原样显示，不悄悄重试。
 * 服务端还没有 vsDebug（旧服务端、项目不是 C++）时整张卡不显示
 */
export function VsDebugCard() {
  const { project, state, reload } = useUe()
  const { busy, run } = useAction()
  const [params, setParams] = useState<LaunchParams>(() => loadParams(project.id))
  const [opening, setOpening] = useState(false)
  // 停止、重启会结束 UE 进程：先确认
  const [ask, setAsk] = useState<'stop' | 'restart' | null>(null)
  // 已经有 VS 开着别的项目时，先问在那个 VS 里打开还是新开一个
  const [choose, setChoose] = useState(false)
  const vs = state?.vsDebug
  if (!vs) return null

  const exec = (op: string, args: Record<string, unknown> = {}, key = op) =>
    void run(key, async () => {
      await vsOp(project.id, op, args)
      reload()
    })
  const onOp = (op: string, args?: Record<string, unknown>, key?: string) => {
    if (op === 'stop' && (vs.status?.mode === 'run' || vs.status?.mode === 'break')) return setAsk('stop')
    if (op === 'restart') return setAsk('restart')
    exec(op, args, key)
  }
  const doOpen = (into?: number) => {
    setChoose(false)
    setOpening(true)
    void openVs(project.id, into)
      .then(() => h().toast.success(t('VS 已打开这个项目，调试控制已连上')))
      .catch((e: Error) => h().toast.error(e.message))
      .finally(() => {
        setOpening(false)
        reload()
      })
  }
  const onOpenVs = () => (vs.others?.length ? setChoose(true) : doOpen())
  return (
    <>
      <VsDebugView
        vs={vs}
        busy={busy}
        opening={opening}
        params={params}
        onParams={(p) => {
          setParams(p)
          saveParams(project.id, p)
        }}
        onOp={onOp}
        onOpenVs={onOpenVs}
      />
      <OpenVsChooser
        open={choose}
        others={vs.others ?? []}
        solution={vs.solution}
        canSpawn={!!vs.devenv}
        onPick={doOpen}
        onCancel={() => setChoose(false)}
      />
      <Confirm
        open={!!ask}
        title={ask === 'restart' ? t('重启调试') : t('停止调试')}
        okText={ask === 'restart' ? t('重启') : t('停止')}
        danger
        onOk={() => {
          const op = ask!
          setAsk(null)
          exec(op)
        }}
        onCancel={() => setAsk(null)}
      >
        {t('会结束正在调试的 UE 进程，编辑器里没保存的改动会丢。')}
        {ask === 'restart' && ` ${t('结束后 VS 会重新编译并启动。')}`}
      </Confirm>
    </>
  )
}
