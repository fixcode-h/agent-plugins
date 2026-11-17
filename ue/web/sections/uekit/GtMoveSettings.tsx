import { h, t } from '../../host.ts'

/**
 * 运行设置里的「移动」一节（GameTest 1.3.0，_settings.json 的 move 段）：move 步骤走不到时要不要瞬移、怎么推角色、
 * 录制快捷键开不开。场景顶层的 move 会覆盖这里。没认的字段原样保留（新版 GameTest 加的项，旧面板保存时不该丢）
 */
export interface GtMoveConfig {
  /** 走不到时：none 失败（默认），teleport 瞬移兜底 */
  fallback?: 'none' | 'teleport'
  /** 瞬移用的控制台命令模板，{x}{y}{z}{yaw} 换成坐标；空着用 TeleportTo */
  teleportCommand?: string
  /** 到达半径（厘米），0 按角色大小 */
  radius?: number
  /** input 推摇杆（默认），keys 按住前进键并转镜头（项目只认按键输入时用） */
  drive?: 'input' | 'keys'
  forwardKey?: string
  /** 录制时 Alt+数字快捷键，默认开 */
  hotkeys?: boolean
  [k: string]: unknown
}

/** 去掉默认值和空串：文件里只留改过的项 */
export function tidyMove(m: GtMoveConfig): GtMoveConfig | undefined {
  const out: GtMoveConfig = { ...m }
  if (out.fallback !== 'teleport') delete out.fallback
  if (!out.teleportCommand?.trim()) delete out.teleportCommand
  else out.teleportCommand = out.teleportCommand.trim()
  if (!out.radius) delete out.radius
  if (out.drive !== 'keys') delete out.drive
  if (!out.forwardKey?.trim()) delete out.forwardKey
  else out.forwardKey = out.forwardKey.trim()
  if (out.hotkeys !== false) delete out.hotkeys
  return Object.keys(out).length ? out : undefined
}

export function GtMoveSettings({ value, onChange }: { value: GtMoveConfig; onChange: (v: GtMoveConfig) => void }) {
  const { ui } = h()
  const set = (p: Partial<GtMoveConfig>) => onChange({ ...value, ...p })
  return (
    <section className="ue:flex ue:flex-col ue:gap-3">
      <h3 className="ue:text-body ue:font-medium ue:text-fg">{t('移动')}</h3>
      <p className="ue:-mt-2 ue:text-footnote ue:leading-relaxed ue:text-subtle">
        {t(
          'move 步骤（录移动录出来的）让角色自己走到目标点：先按导航网格寻路，没有就按录的轨迹走，再不行运行时探路。需要 GameTest 1.3.0；场景里写的 move 覆盖这里。',
        )}
      </p>
      <ui.Field
        label={t('走不到时')}
        hint={t('瞬移兜底能让后面的步骤接着跑，但这一步就没测到「走得过去」；结果里会写明用了瞬移。')}
      >
        <ui.Select
          size="sm"
          className="ue:w-48"
          value={value.fallback ?? 'none'}
          onChange={(e: { target: { value: string } }) => set({ fallback: e.target.value as 'none' | 'teleport' })}
          options={[
            { value: 'none', label: t('这一步失败（默认）') },
            { value: 'teleport', label: t('瞬移过去') },
          ]}
        />
      </ui.Field>
      {value.fallback === 'teleport' && (
        <ui.Field
          label={t('瞬移命令')}
          hint={t('项目有自己的传送 GM 时填控制台命令，{x} {y} {z} {yaw} 换成目标坐标；空着直接设角色位置。')}
        >
          <ui.Input
            size="sm"
            className="ue:font-mono"
            placeholder="gm.Teleport {x} {y} {z}"
            value={value.teleportCommand ?? ''}
            onChange={(e: { target: { value: string } }) => set({ teleportCommand: e.target.value })}
          />
        </ui.Field>
      )}
      <ui.Field
        label={t('怎么推角色')}
        hint={t(
          '推摇杆直接给角色移动输入，不经过按键绑定；项目只认按键（Enhanced Input 上做了自己的移动逻辑）时改成按住前进键。',
        )}
      >
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Select
            size="sm"
            className="ue:w-48"
            value={value.drive ?? 'input'}
            onChange={(e: { target: { value: string } }) => set({ drive: e.target.value as 'input' | 'keys' })}
            options={[
              { value: 'input', label: t('推摇杆（默认）') },
              { value: 'keys', label: t('按住前进键') },
            ]}
          />
          {value.drive === 'keys' && (
            <ui.Input
              size="sm"
              className="ue:w-32 ue:font-mono"
              placeholder="W"
              value={value.forwardKey ?? ''}
              onChange={(e: { target: { value: string } }) => set({ forwardKey: e.target.value })}
            />
          )}
        </div>
      </ui.Field>
      <ui.Field
        label={t('录制快捷键')}
        hint={t(
          '录制时 Alt+1 录移动、Alt+2 记下位置、Alt+3 在这附近、Alt+4 断言、Alt+5 检查点、Alt+0 放弃这段；游戏自己用了 Alt+数字时关掉，改用工具栏。',
        )}
      >
        <ui.Select
          size="sm"
          className="ue:w-48"
          value={value.hotkeys === false ? 'off' : 'on'}
          onChange={(e: { target: { value: string } }) => set({ hotkeys: e.target.value !== 'off' })}
          options={[
            { value: 'on', label: t('开（默认）') },
            { value: 'off', label: t('关') },
          ]}
        />
      </ui.Field>
    </section>
  )
}
