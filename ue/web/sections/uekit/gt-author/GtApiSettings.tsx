import { RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ppost } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { AddButton, SettingGroup, SettingList, SettingRow, useSettingsPage } from '../../../SettingRows.tsx'
import { ErrorText } from '../../../ui.tsx'

/**
 * GameTest 设置页「接口库」（用户 2026-11-18：插件设置里能配 Lua 函数库接口的文件夹）。
 * 项目接口按文件夹认（脚本协议 8.2）：Lua 文件夹相对 Lua 脚本根，面板扫；C++ 文件夹相对项目根，编辑器里的 GameTest 扫。
 * 存在场景根的 _settings.json（api.lua / api.cpp），全组共用；编辑器没开也能改，存完马上重扫 Lua 写 _api.json。
 */
interface Rejected {
  module?: string
  class?: string
  function: string
  file?: string
  line?: number
  why: string
}

interface Reply {
  settingsPath: string
  luaRoot: string
  lua: string[]
  luaIsDefault: boolean
  cpp: string[]
  cppIsDefault: boolean
  cppScan: { scannedAt: string; items: number; rejected: Rejected[] }
  luaScan: {
    items: number
    rejected: Rejected[]
    missing: string[]
    perFolder: Record<string, number>
    apiPath: string
    renamed: Record<string, string>
  }
}

export function GtApiSettings() {
  const { project } = useUe()
  const { ui } = h()
  const [reply, setReply] = useState<Reply>()
  const [lua, setLua] = useState<string[]>([])
  const [cpp, setCpp] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 设置页别的页签也挂着这个组件：只有切到「接口库」时才读、才扫
  const onPage = useSettingsPage(['api'])

  const apply = (r: Reply) => {
    setReply(r)
    setLua(r.lua)
    setCpp(r.cpp)
  }
  const call = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      apply(await ppost<Reply>(project.id, 'ext/gt/api', body))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (onPage) void call({ action: 'read' })
    // 换项目、切到这一页时重读；call 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, onPage])

  const dirty = !!reply && (lua.join('\n') !== reply.lua.join('\n') || cpp.join('\n') !== reply.cpp.join('\n'))
  const save = () =>
    void call({ action: 'save', lua: lua.map((x) => x.trim()).filter(Boolean), cpp: cpp.map((x) => x.trim()).filter(Boolean) })

  const folders = (list: string[], set: (v: string[]) => void, counts?: Record<string, number>, missing?: string[]) => (
    <SettingList count={list.length}>
      {list.map((f, i) => (
        <div key={i} className="ue:flex ue:items-center ue:gap-2">
          <ui.Input
            size="sm"
            className="ue:min-w-0 ue:flex-1 ue:font-mono"
            value={f}
            placeholder="Game/**/GameTestApi"
            onChange={(e: { target: { value: string } }) => set(list.map((x, k) => (k === i ? e.target.value : x)))}
          />
          {counts && f in counts && (
            <span className="ue:shrink-0 ue:text-footnote ue:text-subtle">
              {missing?.includes(f) ? t('文件夹不存在') : t('{n} 个接口', { n: counts[f] })}
            </span>
          )}
          <ui.IconButton icon={Trash2} size="sm" label={t('删掉这个文件夹')} onClick={() => set(list.filter((_, k) => k !== i))} />
        </div>
      ))}
      <div>
        <AddButton onClick={() => set([...list, ''])} />
      </div>
    </SettingList>
  )

  const rejectedList = (list: Rejected[]) =>
    list.length ? (
      <ul className="ue:flex ue:flex-col ue:gap-1 ue:py-3.5 ue:text-footnote">
        {list.map((r, i) => (
          <li key={i} className="ue:flex ue:min-w-0 ue:flex-col ue:gap-0.5">
            <span className="ue:truncate ue:font-mono ue:text-fg">
              {(r.module ?? r.class ?? '') + '.' + r.function}
              {r.file && (
                <span className="ue:ml-2 ue:text-subtle">
                  {r.file}
                  {r.line ? `:${r.line}` : ''}
                </span>
              )}
            </span>
            <span className="ue:text-subtle">{r.why}</span>
          </li>
        ))}
      </ul>
    ) : null

  return (
    <>
      <SettingGroup
        page="api"
        title={t('Lua 接口文件夹')}
        aside={t('这个项目')}
        hint={t(
          '这些文件夹下的 Lua 模块，模块表上的函数（function M.Fn）就是测试脚本能调的项目接口，接口名是「项目.模块名.函数名」。参数和返回值照 EmmyLua 注释（---@param、---@return），标了 ---@readonly 的能当条件。写法和示例见技能 ue-gametest-authoring。',
        )}
        action={
          <ui.IconButton icon={RefreshCw} size="sm" label={t('重新扫描')} disabled={busy} onClick={() => void call({ action: 'scan' })} />
        }
      >
        <SettingRow
          title={t('相对 Lua 脚本根')}
          desc={reply ? reply.luaRoot : t('读取中…')}
          hint={t('写 **/GameTestApi 表示脚本根下任意一层叫 GameTestApi 的文件夹。一个都不留就是不认 Lua 接口；恢复默认是 GameTestApi。')}
        >
          {reply?.luaIsDefault && <span className="ue:text-footnote ue:text-subtle">{t('默认')}</span>}
        </SettingRow>
        {folders(lua, setLua, reply?.luaScan.perFolder, reply?.luaScan.missing)}
        {reply && (
          <p className="ue:pb-2 ue:text-footnote ue:text-subtle">
            {t('认出 {n} 个 Lua 接口，写在 {p}', { n: reply.luaScan.items, p: reply.luaScan.apiPath })}
          </p>
        )}
        {reply && reply.luaScan.rejected.length > 0 && (
          <SettingRow title={t('没认出来的 Lua 函数')} desc={t('改成模块函数、去掉不能构造的参数后再扫')} stack>
            {rejectedList(reply.luaScan.rejected)}
          </SettingRow>
        )}
      </SettingGroup>
      <SettingGroup
        page="api"
        title={t('C++ 接口文件夹')}
        aside={t('这个项目')}
        hint={t(
          '这些文件夹下蓝图函数库（UBlueprintFunctionLibrary）里的 static BlueprintCallable 函数是项目接口，BlueprintPure 的算只读。由编辑器里的 GameTest 在启动、编译、Live Coding 后扫，需要 GameTest 1.9.0。',
        )}
      >
        <SettingRow title={t('相对项目根')} desc={t('默认 Source/**/GameTestApi')}>
          {reply?.cppIsDefault && <span className="ue:text-footnote ue:text-subtle">{t('默认')}</span>}
        </SettingRow>
        {folders(cpp, setCpp)}
        {reply && (
          <p className="ue:pb-2 ue:text-footnote ue:text-subtle">
            {reply.cppScan.scannedAt
              ? t('编辑器上次扫到 {n} 个 C++ 接口', { n: reply.cppScan.items })
              : t('编辑器还没扫过 C++ 接口')}
          </p>
        )}
        {reply && reply.cppScan.rejected.length > 0 && (
          <SettingRow title={t('没认出来的 C++ 函数')} stack>
            {rejectedList(reply.cppScan.rejected)}
          </SettingRow>
        )}
      </SettingGroup>
      {onPage && (
      <div className="ue:sticky ue:bottom-0 ue:z-10 ue:mt-4 ue:flex ue:flex-wrap ue:items-center ue:gap-3 ue:border-t ue:border-line ue:bg-bg ue:py-2.5">
        <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-1">
          {error && <ErrorText>{error}</ErrorText>}
          {reply && (
            <p className="ue:truncate ue:text-footnote ue:text-subtle">
              {t('存在 {p}（跟着场景进版本管理，全组共用）', { p: reply.settingsPath })}
            </p>
          )}
        </div>
        <ui.Button size="sm" variant="ghost" disabled={busy} onClick={() => void call({ action: 'save', lua: null, cpp: null })}>
          {t('恢复默认')}
        </ui.Button>
        <ui.Button size="sm" disabled={!dirty || busy} onClick={save}>
          {t('保存并扫描')}
        </ui.Button>
      </div>
      )}
    </>
  )
}
