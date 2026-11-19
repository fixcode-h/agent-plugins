import { AppWindow, SquarePlus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { VsOtherInstance } from '../../server/types.ts'
import { h, t } from '../host.ts'

/**
 * 「用 VS 打开这个项目」时已经有 VS 开着别的项目：让用户选在那个 VS 里打开（那个 VS 先关掉现在的解决方案），
 * 还是新开一个 VS。只管显示和把选择交出去，请求由 VsDebugCard 发
 */
export function OpenVsChooser({
  open,
  others,
  solution,
  canSpawn,
  onPick,
  onCancel,
}: {
  open: boolean
  others: VsOtherInstance[]
  /** 这个项目的 .sln */
  solution?: string
  /** 本机找得到 devenv 才能新开 */
  canSpawn: boolean
  /** into = 在这个 PID 的 VS 里打开；不给 = 新开一个 VS */
  onPick: (into?: number) => void
  onCancel: () => void
}) {
  const { Modal, Button } = h().ui
  return (
    <Modal
      open={open}
      onOpenChange={(o: boolean) => !o && onCancel()}
      title={t('用 VS 打开这个项目')}
      size="md"
      footer={
        <Button variant="secondary" onClick={onCancel}>
          {t('取消')}
        </Button>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <p className="ue:text-body ue:leading-relaxed ue:text-muted">
          {t('已经有 VS 开着别的项目。选在哪个 VS 里打开 {sln}：', { sln: baseName(solution) })}
        </p>
        <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:rounded-lg ue:border ue:border-line">
          {others.map((o) => (
            <Row
              key={o.pid}
              icon={<AppWindow className="ue:h-4 ue:w-4" />}
              title={t('在开着 {name} 的 VS 里打开', { name: baseName(o.solution) })}
              desc={t('VS 会先关掉 {name}，有没保存的文件会提示保存（PID {pid}）', {
                name: baseName(o.solution),
                pid: o.pid,
              })}
              action={
                <Button size="sm" variant="secondary" onClick={() => onPick(o.pid)}>
                  {t('在这个 VS 里打开')}
                </Button>
              }
            />
          ))}
          <Row
            icon={<SquarePlus className="ue:h-4 ue:w-4" />}
            title={t('新开一个 VS')}
            desc={
              canSpawn
                ? t('原来的 VS 不动，两个项目各开一个窗口')
                : t('本机没找到 Visual Studio（vswhere 没找到 devenv.exe）')
            }
            action={
              <Button size="sm" disabled={!canSpawn} onClick={() => onPick()}>
                {t('新开 VS')}
              </Button>
            }
          />
        </ul>
      </div>
    </Modal>
  )
}

const baseName = (p?: string) => (p ? p.replace(/\\/g, '/').split('/').pop() || p : '')

function Row({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action: ReactNode }) {
  return (
    <li className="ue:flex ue:items-center ue:gap-3 ue:px-3 ue:py-2.5">
      <span className="ue:shrink-0 ue:text-subtle">{icon}</span>
      <div className="ue:min-w-0 ue:flex-1">
        <div className="ue:text-body ue:text-fg">{title}</div>
        <div className="ue:mt-0.5 ue:text-footnote ue:break-all ue:text-subtle">{desc}</div>
      </div>
      <span className="ue:shrink-0">{action}</span>
    </li>
  )
}
